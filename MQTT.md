# MQTT bootstrap and fallback in EdgeGuard

## Overview

HTTP is the primary device/server transport. MQTT is retained for initial IP
and backend URL bootstrap, presence/LWT, and automatic fallback when an HTTP
request cannot be delivered.

- The device announces its control/camera IP through retained MQTT.
- Telemetry, RFID, FOMO and vision alerts use HTTP first, then MQTT fallback.
- Commands and operational config use device HTTP first, then MQTT fallback.
- Retained MQTT config provides the backend/FOMO URLs needed to bootstrap HTTP.
- AI workers can subscribe to telemetry and publish inference results.
- Camera-capable devices can publish image payloads, and the API server saves them locally.

## Broker

Development defaults:

- Broker: `broker.hivemq.com`
- Port: `1883`
- Protocol: MQTT over TCP
- QoS: `0` for subscriptions, `1` for command publications
- Keep alive: `90` seconds

For production, use a private broker with TLS and credentials.

## Topic Base

All topics are prefixed with:

```text
/EdgeGuard/{device_id}
```

The default device id is `device_001`, so the default base topic is:

```text
/EdgeGuard/device_001
```

## Telemetry Topics

Hardware to server:

```text
{base}/status
{base}/telemetry/environment
{base}/telemetry/security
{base}/telemetry/power
{base}/telemetry/system
{base}/telemetry/nfc
{base}/telemetry/endpoints
{base}/telemetry/vision-alert
```

Image topics:

```text
{base}/image
{base}/image/json
```

Example environment payload:

```json
{
  "temperature_c": 28.4,
  "humidity_pct": 58.2,
  "heat_index_c": 31.0
}
```

Example security payload:

```json
{
  "motion": true,
  "door_open": false,
  "distance_mm": 950
}
```

Example system payload:

```json
{
  "uptime_ms": 120044,
  "rssi_dbm": -61,
  "free_heap": 41832
}
```

Raw image payloads can be published directly to `{base}/image` as JPEG, PNG, GIF, BMP, or WebP bytes. The server detects the image type from the first bytes and saves the payload in `server/data/images`.

JSON image payloads can be published to `{base}/image/json`:

```json
{
  "image_base64": "/9j/4AAQSkZJRgABAQAAAQABAAD...",
  "content_type": "image/jpeg",
  "filename": "front-door.jpg",
  "device_id": "device_001",
  "captured_at": "2026-06-17T10:00:00.000Z"
}
```

The JSON format is easier to test from API clients. The raw binary format is better for camera firmware.

The main device serves JPEG/MJPEG over HTTP and announces its current URLs through retained MQTT telemetry. Image topics remain supported for backward compatibility, but the dashboard no longer requires camera frames to be transported through MQTT.

Dynamic camera endpoint discovery:

```text
{base}/telemetry/endpoints
```

```json
{
  "device_id": "device_001",
  "base_url": "http://192.168.1.50:82",
  "capture_url": "http://192.168.1.50:82/capture",
  "event_frame_url": "http://192.168.1.50:82/event-frame",
  "stream_url": "http://192.168.1.50:81/stream",
  "health_url": "http://192.168.1.50:82/health",
  "live_mode": "mjpeg"
}
```

The standalone `hardware/CameraCapture` firmware is intentionally not part of
MQTT. It hosts its own UI/API, caches pending JPEGs in LittleFS, and uploads
directly to Supabase. This document only describes the main EdgeGuard device
and legacy MQTT image topics.

## AI transport

The ESP32 sends FOMO inference JSON directly to the backend:

```text
POST /api/fomo/inference
X-EdgeGuard-Device-Id: device_001
Content-Type: application/json
```

The inference uses `{base}/telemetry/inference` only when its HTTP POST fails.
The exact cached JPEG is not sent through MQTT. After the inference is
accepted, the backend retrieves
`GET /event-frame?event_id=<id>` from the device. For person detections, the
backend returns the AWS Rekognition result through `POST :82/api/command`.
Its MQTT fallback topic is:

```text
{base}/command/vision-result
```

The device ignores a result whose `event_id` is no longer current. Stable
stranger/object alerts and camera-occlusion alerts are posted to
`POST /api/device/telemetry`; `{base}/telemetry/vision-alert` is the fallback.

`camera_blocked_alert_enabled` is synchronized in the retained device config
independently from `ai_detection_enabled`. Camera-tamper analysis continues when
FOMO AI is disabled; the setting controls publication of the confirmed alert.

The endpoint announcement includes `event_frame_url`. For every model inference
or vision alert, the backend requests `GET /event-frame?event_id=<id>` and accepts
the JPEG only when `X-EdgeGuard-Event-Id` matches. The detection event is stored
before face recognition starts; recognition results are therefore logged after
the original detection and reuse the same source frame.

Example inference payload:

```json
{
  "label": "normal",
  "anomaly_score": 0.12,
  "source": "edgeguard-ai-worker",
  "observed_topic": "/EdgeGuard/device_001/telemetry/security",
  "inferred_at": "2026-06-17T10:00:00.000Z"
}
```

## MQTT fallback command topics

Server to hardware:

```text
{base}/command/reboot
{base}/command/config
{base}/command/scan
{base}/command/buzzer
{base}/command/servo
```

Payload chi tiết cho buzzer, servo, PN532 và camera ESP32-CAM được mô tả tại [`hardware/MQTT-PERIPHERALS.md`](hardware/MQTT-PERIPHERALS.md).

Generic command payload:

```json
{
  "requested_at": "2026-06-17T10:00:00.000Z",
  "source": "web",
  "payload": {}
}
```

Only bootstrap network configuration is retained during normal operation. Full
operational config may be retained temporarily when HTTP delivery fails:

```json
{
  "backend_url": "http://192.168.1.10:3000",
  "fomo_inference_url": "http://192.168.1.10:3000/api/fomo/inference"
}
```

## API Server

- `GET /health`: API and MQTT health.
- `GET /api/device/status`: physical-device state and latest telemetry snapshot.
- `POST /api/device/telemetry`: receive HTTP telemetry from the device.
- `POST /api/device/command`: send an HTTP-first command with MQTT fallback.
- `POST /api/device/config`: send HTTP-first config with MQTT fallback.
- `POST /api/device/sync-access`: synchronize settings and RFID allowlist.
- `GET/POST /api/mqtt/*`: compatibility and MQTT development endpoints.
- `POST /api/mqtt/send`: publish a custom MQTT message for development.
- `POST /api/fomo/inference`: accept FOMO inference JSON from the ESP32 over HTTP.
- `GET /api/fomo/status`: show the current inference URL and latest received FOMO event.
- `GET /api/images`: list locally saved images.
- `GET /api/images/:filename`: download a saved image.
- `POST /api/images`: save a JSON base64 image through HTTP for testing.

Future Telegram forwarding should plug into the image-saved event in `server/src/services/telegram.js`.

## Security Notes

The public HiveMQ broker is only for development. Do not publish private device data or production commands on public MQTT topics.
