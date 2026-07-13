#ifndef EDGEGUARD_CONFIG_H
#define EDGEGUARD_CONFIG_H

// Network settings.
const char *WIFI_SSID = "EdgeGuard";
const char *WIFI_PASSWORD = "edgeguard-password";
const char *MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *MQTT_DEVICE_ID = "device_001";
const char *MQTT_TOPIC_BASE = "/EdgeGuard/device_001";

// Peripheral pins from the supplied ESP32-CAM wiring diagram.
#define PN532_SDA_PIN 13
#define PN532_SCL_PIN 14
#define SERVO_PIN 12
#define BUZZER_PIN 15
#define STATUS_LED_PIN 33

// AI Thinker ESP32-CAM camera pins.
#define CAM_PIN_PWDN 32
#define CAM_PIN_RESET -1
#define CAM_PIN_XCLK 0
#define CAM_PIN_SIOD 26
#define CAM_PIN_SIOC 27
#define CAM_PIN_D7 35
#define CAM_PIN_D6 34
#define CAM_PIN_D5 39
#define CAM_PIN_D4 36
#define CAM_PIN_D3 21
#define CAM_PIN_D2 19
#define CAM_PIN_D1 18
#define CAM_PIN_D0 5
#define CAM_PIN_VSYNC 25
#define CAM_PIN_HREF 23
#define CAM_PIN_PCLK 22

const unsigned long CAMERA_INTERVAL_MS = 10000;
const unsigned long NFC_REPEAT_DELAY_MS = 1500;
const unsigned long SYSTEM_INTERVAL_MS = 10000;
const int SERVO_START_ANGLE = 0;

extern bool publish_system_metrics;

#endif
