from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv()

MQTT_HOST = os.getenv("MQTT_HOST", "broker.hivemq.com")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_BASE = os.getenv("MQTT_TOPIC_BASE", "/EdgeGuard/device_001").rstrip("/")
MODEL_PATH = os.getenv("EDGEGUARD_MODEL_PATH")

TELEMETRY_TOPIC = f"{MQTT_TOPIC_BASE}/telemetry/#"
INFERENCE_TOPIC = f"{MQTT_TOPIC_BASE}/model/inference"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_model() -> Any | None:
    if not MODEL_PATH:
      return None

    path = Path(MODEL_PATH)
    if not path.exists():
      raise FileNotFoundError(f"Model file not found: {path}")

    return joblib.load(path)


def features_from_payload(topic: str, payload: dict[str, Any]) -> np.ndarray:
    values = [
        float(payload.get("temperature_c", 0) or 0),
        float(payload.get("humidity_pct", 0) or 0),
        float(payload.get("distance_mm", 0) or 0),
        float(bool(payload.get("motion", False))),
        float(bool(payload.get("door_open", False))),
    ]

    if topic.endswith("/system"):
        values.extend([
            float(payload.get("rssi_dbm", 0) or 0),
            float(payload.get("free_heap", 0) or 0),
        ])
    else:
        values.extend([0.0, 0.0])

    return np.array([values], dtype=float)


def heuristic_score(topic: str, payload: dict[str, Any]) -> float:
    score = 0.0

    temperature = float(payload.get("temperature_c", 0) or 0)
    humidity = float(payload.get("humidity_pct", 0) or 0)
    distance = float(payload.get("distance_mm", 0) or 0)

    if temperature > 38 or temperature < 0:
        score += 0.45
    if humidity > 85:
        score += 0.2
    if topic.endswith("/security") and payload.get("motion"):
        score += 0.35
    if topic.endswith("/security") and payload.get("door_open"):
        score += 0.5
    if distance and distance < 120:
        score += 0.25

    return min(score, 1.0)


def predict(model: Any | None, topic: str, payload: dict[str, Any]) -> tuple[str, float]:
    if model is None:
        score = heuristic_score(topic, payload)
    elif hasattr(model, "predict_proba"):
        probability = model.predict_proba(features_from_payload(topic, payload))[0]
        score = float(max(probability))
    elif hasattr(model, "decision_function"):
        raw_score = float(model.decision_function(features_from_payload(topic, payload))[0])
        score = 1.0 / (1.0 + np.exp(-raw_score))
    else:
        prediction = model.predict(features_from_payload(topic, payload))[0]
        score = float(prediction)

    label = "alert" if score >= 0.7 else "watch" if score >= 0.35 else "normal"
    return label, round(score, 4)


def main() -> None:
    model = load_model()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="edgeguard-ai-worker")

    def on_connect(client: mqtt.Client, _userdata: Any, _flags: Any, reason_code: Any, _properties: Any) -> None:
        print(f"[MQTT] Connected with reason code {reason_code}")
        client.subscribe(TELEMETRY_TOPIC, qos=0)
        print(f"[MQTT] Subscribed to {TELEMETRY_TOPIC}")

    def on_message(client: mqtt.Client, _userdata: Any, message: mqtt.MQTTMessage) -> None:
        raw = message.payload.decode("utf-8")

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            print(f"[MQTT] Skipping non-JSON payload on {message.topic}: {raw}")
            return

        label, score = predict(model, message.topic, payload)
        result = {
            "label": label,
            "anomaly_score": score,
            "source": "edgeguard-ai-worker",
            "observed_topic": message.topic,
            "inferred_at": utc_now(),
        }

        client.publish(INFERENCE_TOPIC, json.dumps(result), qos=1, retain=False)
        print(f"[AI] {message.topic} -> {result}")

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=90)
    client.loop_forever()


if __name__ == "__main__":
    main()
