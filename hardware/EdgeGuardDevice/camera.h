#ifndef EDGEGUARD_CAMERA_H
#define EDGEGUARD_CAMERA_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

extern bool deviceCameraPublishEnabled;

bool cameraReady = false;
unsigned long lastCameraPublish = 0;
unsigned long lastCameraInitAttempt = 0;
unsigned long lastCameraSuccessAt = 0;
unsigned long cameraPublishInterval = CAMERA_INTERVAL_MS;
size_t lastCameraFrameBytes = 0;
uint32_t cameraPublishFailures = 0;
uint8_t cameraCaptureFailures = 0;

void camera_setup() {
  lastCameraInitAttempt = millis();
  camera_config_t c = {};
  // Keep the camera away from the low LEDC channels used by ESP32Servo/tone.
  c.ledc_channel = LEDC_CHANNEL_7; c.ledc_timer = LEDC_TIMER_3;
  c.pin_d0 = CAM_PIN_D0; c.pin_d1 = CAM_PIN_D1; c.pin_d2 = CAM_PIN_D2; c.pin_d3 = CAM_PIN_D3;
  c.pin_d4 = CAM_PIN_D4; c.pin_d5 = CAM_PIN_D5; c.pin_d6 = CAM_PIN_D6; c.pin_d7 = CAM_PIN_D7;
  c.pin_xclk = CAM_PIN_XCLK; c.pin_pclk = CAM_PIN_PCLK; c.pin_vsync = CAM_PIN_VSYNC;
  c.pin_href = CAM_PIN_HREF; c.pin_sccb_sda = CAM_PIN_SIOD; c.pin_sccb_scl = CAM_PIN_SIOC;
  c.pin_pwdn = CAM_PIN_PWDN; c.pin_reset = CAM_PIN_RESET;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  // QVGA keeps each MQTT PUBLISH safely below PubSubClient's 16-bit packet
  // length and is fast enough for a two-frame-per-second live preview.
  c.frame_size = FRAMESIZE_QVGA;
  c.jpeg_quality = psramFound() ? 12 : 16;
  c.fb_count = psramFound() ? 2 : 1;
  c.grab_mode = CAMERA_GRAB_LATEST;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  esp_err_t result = esp_camera_init(&c);
  cameraReady = result == ESP_OK;
  if (cameraReady) {
    cameraCaptureFailures = 0;
    cameraPublishInterval = CAMERA_INTERVAL_MS;
  }
  Serial.printf("[Camera] %s (0x%x)\n", cameraReady ? "Ready" : "Initialization failed", result);
}

void camera_restartAfterCaptureFailures(unsigned long now) {
  Serial.println("[Camera] Too many capture failures; scheduling reinitialization");
  esp_camera_deinit();
  cameraReady = false;
  cameraCaptureFailures = 0;
  lastCameraInitAttempt = now;
}

void camera_loop() {
  unsigned long now = millis();
  if (!cameraReady) {
    if (now - lastCameraInitAttempt >= CAMERA_INIT_RETRY_MS) {
      Serial.println("[Camera] Retrying initialization");
      camera_setup();
    }
    return;
  }
  if (!deviceCameraPublishEnabled) return;
  if (!mqttClient.connected() || now - lastCameraPublish < cameraPublishInterval) return;
  lastCameraPublish = now;
  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) {
    cameraCaptureFailures++;
    cameraPublishFailures++;
    cameraPublishInterval = CAMERA_FAILURE_RETRY_MS;
    Serial.printf("[Camera] Capture failed (%u/%u)\n", cameraCaptureFailures, CAMERA_CAPTURE_FAILURES_BEFORE_RESTART);
    if (cameraCaptureFailures >= CAMERA_CAPTURE_FAILURES_BEFORE_RESTART) {
      camera_restartAfterCaptureFailures(now);
    }
    return;
  }

  cameraCaptureFailures = 0;
  if (frame->len == 0 || frame->len > CAMERA_MAX_MQTT_FRAME_BYTES) {
    cameraPublishFailures++;
    cameraPublishInterval = CAMERA_FAILURE_RETRY_MS;
    Serial.printf("[Camera] JPEG %u bytes is outside MQTT limit; frame skipped\n", frame->len);
    esp_camera_fb_return(frame);
    return;
  }

  String topic = mqtt_topic("/image");
  bool ok = mqttClient.beginPublish(topic.c_str(), frame->len, false);
  size_t written = 0;
  while (ok && written < frame->len) {
    size_t chunkSize = min(CAMERA_MQTT_CHUNK_BYTES, frame->len - written);
    size_t chunkWritten = mqttClient.write(frame->buf + written, chunkSize);
    ok = chunkWritten == chunkSize;
    written += chunkWritten;
    delay(0);
  }
  if (ok) ok = mqttClient.endPublish() == 1;

  if (ok) {
    lastCameraSuccessAt = now;
    lastCameraFrameBytes = frame->len;
    cameraPublishInterval = CAMERA_INTERVAL_MS;
  } else {
    cameraPublishFailures++;
    cameraPublishInterval = CAMERA_FAILURE_RETRY_MS;
    // A partial streaming PUBLISH leaves the MQTT byte stream unusable.
    // Reconnect before sending telemetry or the next image.
    mqttClient.disconnect();
  }
  Serial.printf("[Camera] JPEG %u bytes: %s\n", frame->len, ok ? "published" : "publish failed");
  esp_camera_fb_return(frame);
}

#endif
