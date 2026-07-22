#ifndef EDGEGUARD_CONFIG_H
#define EDGEGUARD_CONFIG_H

// Network settings.
const char *WIFI_SSID = "Ai đó";
const char *WIFI_PASSWORD = "012345678";
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

// Keep the buzzer away from ESP32Servo's first LEDC channel (channel 0,
// timer 0). Arduino tone() otherwise changes the servo PWM frequency and
// noTone() clears its duty cycle, leaving the servo without a valid signal.
const uint8_t BUZZER_LEDC_CHANNEL = 2; // LEDC timer 1

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

const unsigned long CAMERA_INIT_RETRY_MS = 10000;
const uint8_t CAMERA_CAPTURE_FAILURES_BEFORE_RESTART = 5;
const uint16_t CAMERA_HTTP_PORT = 81;
const unsigned long CAMERA_MUTEX_TIMEOUT_MS = 2500;
const unsigned long CAMERA_ENDPOINT_RETRY_MS = 5000;
const unsigned long FOMO_INIT_RETRY_MS = 10000;
// Lightweight frame analysis gates the expensive FOMO classifier. A sampled
// pixel counts as changed when its grayscale value moves by this amount.
const unsigned long CAMERA_ANALYSIS_INTERVAL_MS = 400;
const uint8_t CAMERA_BASELINE_WARMUP_FRAMES = 5;
const uint8_t CAMERA_CHANGE_SAMPLE_WIDTH = 20;
const uint8_t CAMERA_CHANGE_SAMPLE_HEIGHT = 15;
const uint8_t CAMERA_PIXEL_CHANGE_THRESHOLD = 24;
const float CAMERA_FOMO_TRIGGER_CHANGE_PERCENT = 50.0f;
const float CAMERA_FOMO_RECHECK_CHANGE_PERCENT = 60.0f;
const unsigned long VISION_STABLE_ALERT_MS = 5000;
// Occlusion is confirmed across several samples to avoid one-frame exposure
// changes. Extreme darkness/brightness or a nearly textureless frame counts.
const uint8_t CAMERA_BLOCKED_CONFIRM_SAMPLES = 3;
const uint8_t CAMERA_BLOCKED_DARK_LUMA = 18;
const uint8_t CAMERA_BLOCKED_BRIGHT_LUMA = 245;
const float CAMERA_BLOCKED_EXTREME_PIXEL_PERCENT = 90.0f;
const float CAMERA_BLOCKED_MAX_STDDEV = 8.0f;
const float CAMERA_BLOCKED_MAX_EDGE_PERCENT = 2.0f;
// Keep latency-sensitive device/network work on Core 0 and reserve Core 1 for
// the synchronous Edge Impulse classifier. The Arduino loop task starts on
// Core 1 for this board, then deletes itself after the control task is ready.
const BaseType_t EDGEGUARD_CONTROL_CORE = 0;
const BaseType_t EDGEGUARD_FOMO_CORE = 1;
const uint32_t EDGEGUARD_CONTROL_TASK_STACK_BYTES = 8192;
const uint32_t EDGEGUARD_FOMO_TASK_STACK_BYTES = 8192;
const UBaseType_t EDGEGUARD_CONTROL_TASK_PRIORITY = 2;
const UBaseType_t EDGEGUARD_FOMO_TASK_PRIORITY = 1;
const unsigned long EDGEGUARD_CONTROL_TASK_DELAY_MS = 1;
// Only treat predictions strictly above 70% as detections.
const float FOMO_MIN_CONFIDENCE = 0.70f;
const size_t FOMO_MAX_PUBLISHED_DETECTIONS = 3;
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
