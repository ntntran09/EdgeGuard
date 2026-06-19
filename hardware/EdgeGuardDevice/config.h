#ifndef EDGEGUARD_CONFIG_H
#define EDGEGUARD_CONFIG_H

// WiFi
const char *WIFI_SSID = "EdgeGuard";
const char *WIFI_PASSWORD = "edgeguard-password";

// MQTT
const char *MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *MQTT_DEVICE_ID = "device_001";
const char *MQTT_TOPIC_BASE = "/EdgeGuard/device_001";

// Pins. Adjust for your board and sensors.
#define MOTION_PIN D5
#define DOOR_PIN D6
#define STATUS_LED_PIN LED_BUILTIN
#define ANALOG_SENSOR_PIN A0

// Publish intervals.
const unsigned long DEFAULT_SAMPLE_INTERVAL_MS = 5000;
const unsigned long DEFAULT_SECURITY_INTERVAL_MS = 1000;
const unsigned long SYSTEM_INTERVAL_MS = 10000;

extern unsigned long sample_interval_ms;
extern unsigned long security_interval_ms;
extern bool publish_system_metrics;

#endif
