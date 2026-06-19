# EdgeGuard Hardware

The `EdgeGuardDevice` sketch is a starting firmware package for an ESP8266 device using WiFi, MQTT, PubSubClient, and ArduinoJson.

## Arduino Libraries

Install these from Arduino Library Manager:

- PubSubClient
- ArduinoJson

## Setup

1. Open `hardware/EdgeGuardDevice/EdgeGuardDevice.ino`.
2. Update WiFi credentials and MQTT identity in `config.h`.
3. Select an ESP8266 board such as NodeMCU 1.0.
4. Upload the sketch.

The firmware publishes telemetry to `/EdgeGuard/device_001/...` and subscribes to `/EdgeGuard/device_001/command/#`.
