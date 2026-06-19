# MQTT in EdgeGuard

## Overview

MQTT is the realtime message layer between the EdgeGuard web server, IoT hardware, and optional AI model workers.

- The IoT device publishes telemetry and subscribes to commands.
- The web server subscribes to telemetry and publishes commands/configuration.
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

## AI Topics

AI worker to server and hardware:

```text
{base}/model/inference
```

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

## Command Topics

Server to hardware:

```text
{base}/command/reboot
{base}/command/config
{base}/command/scan
```

Generic command payload:

```json
{
  "requested_at": "2026-06-17T10:00:00.000Z",
  "source": "web",
  "payload": {}
}
```

Configuration messages are retained so devices can receive the latest config after reconnecting:

```json
{
  "sample_interval_ms": 5000,
  "security_interval_ms": 1000,
  "publish_system_metrics": true
}
```

## API Server

- `GET /health`: API and MQTT health.
- `GET /api/mqtt/status`: MQTT connection state and latest telemetry snapshot.
- `POST /api/mqtt/command`: publish a named command to the device.
- `POST /api/mqtt/config`: publish retained device configuration.
- `POST /api/mqtt/send`: publish a custom MQTT message for development.
- `GET /api/images`: list locally saved images.
- `GET /api/images/:filename`: download a saved image.
- `POST /api/images`: save a JSON base64 image through HTTP for testing.

Future Telegram forwarding should plug into the image-saved event in `server/src/services/telegram.js`.

## Security Notes

The public HiveMQ broker is only for development. Do not publish private device data or production commands on public MQTT topics.
