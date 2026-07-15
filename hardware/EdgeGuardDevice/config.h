#ifndef EDGEGUARD_CONFIG_H
#define EDGEGUARD_CONFIG_H

// Network settings.
const char *WIFI_SSID = "Nguyen";
const char *WIFI_PASSWORD = "127127127";
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

// Two JPEG frames per second gives a responsive preview without starving PN532/MQTT work.
const unsigned long CAMERA_INTERVAL_MS = 500;
const unsigned long CAMERA_FAILURE_RETRY_MS = 2000;
const unsigned long CAMERA_INIT_RETRY_MS = 10000;
const size_t CAMERA_MQTT_CHUNK_BYTES = 1024;
const size_t CAMERA_MAX_MQTT_FRAME_BYTES = 60000;
const uint8_t CAMERA_CAPTURE_FAILURES_BEFORE_RESTART = 5;
const unsigned long NFC_CARD_RELEASE_MS = 500;
const unsigned long PN532_INIT_RETRY_MS = 10000;
const uint16_t PN532_POLL_TIMEOUT_MS = 50;
const unsigned long SYSTEM_INTERVAL_MS = 10000;
const unsigned long DEFAULT_AUTO_LOCK_MS = 10000;
const unsigned long MAX_AUTO_LOCK_MS = 3600000;
const size_t MAX_OFFLINE_RFID_CARDS = 32;
const int SERVO_LOCK_ANGLE = 0;
const int SERVO_UNLOCK_ANGLE = 90;
const int SERVO_START_ANGLE = SERVO_LOCK_ANGLE;
const unsigned int ALARM_TONE_LOW_HZ = 1600;
const unsigned int ALARM_TONE_HIGH_HZ = 2800;
const unsigned long ALARM_TONE_STEP_MS = 180;
const unsigned int RFID_READ_TONE_HZ = 2200;
const unsigned long RFID_READ_TONE_MS = 100;

extern bool publish_system_metrics;

#endif
