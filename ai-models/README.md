# EdgeGuard AI Models

This workspace is for model datasets, experiments, trained artifacts, and MQTT inference workers.

## Layout

- `src/edgeguard_models`: Python package for training/inference utilities.
- `data/raw`: source telemetry exports or captures.
- `data/processed`: cleaned datasets ready for training.
- `artifacts`: trained model files such as `.joblib`, `.onnx`, or `.tflite`.
- `notebooks`: exploratory notebooks.

## MQTT Inference Worker

The starter worker subscribes to telemetry and publishes an inference result:

```bash
pip install -r requirements.txt
python -m edgeguard_models.mqtt_inference
```

Environment variables:

- `MQTT_HOST`: broker host, default `broker.hivemq.com`
- `MQTT_PORT`: broker port, default `1883`
- `MQTT_TOPIC_BASE`: topic base, default `/EdgeGuard/device_001`
- `EDGEGUARD_MODEL_PATH`: optional path to a `joblib` model

If no model path is configured, the worker uses a small heuristic scorer so the MQTT loop can be tested immediately.
