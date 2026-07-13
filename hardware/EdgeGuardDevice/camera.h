#ifndef EDGEGUARD_CAMERA_H
#define EDGEGUARD_CAMERA_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

bool cameraReady = false;
unsigned long lastCameraPublish = 0;

void camera_setup() {
  camera_config_t c = {};
  // Keep the camera away from the low LEDC channels used by ESP32Servo/tone.
  c.ledc_channel = LEDC_CHANNEL_7; c.ledc_timer = LEDC_TIMER_3;
  c.pin_d0 = CAM_PIN_D0; c.pin_d1 = CAM_PIN_D1; c.pin_d2 = CAM_PIN_D2; c.pin_d3 = CAM_PIN_D3;
  c.pin_d4 = CAM_PIN_D4; c.pin_d5 = CAM_PIN_D5; c.pin_d6 = CAM_PIN_D6; c.pin_d7 = CAM_PIN_D7;
  c.pin_xclk = CAM_PIN_XCLK; c.pin_pclk = CAM_PIN_PCLK; c.pin_vsync = CAM_PIN_VSYNC;
  c.pin_href = CAM_PIN_HREF; c.pin_sccb_sda = CAM_PIN_SIOD; c.pin_sccb_scl = CAM_PIN_SIOC;
  c.pin_pwdn = CAM_PIN_PWDN; c.pin_reset = CAM_PIN_RESET;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA;
  c.jpeg_quality = psramFound() ? 12 : 16;
  c.fb_count = psramFound() ? 2 : 1;
  c.grab_mode = CAMERA_GRAB_LATEST;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  esp_err_t result = esp_camera_init(&c);
  cameraReady = result == ESP_OK;
  Serial.printf("[Camera] %s (0x%x)\n", cameraReady ? "Ready" : "Initialization failed", result);
}

void camera_loop() {
  unsigned long now = millis();
  if (!cameraReady || !mqttClient.connected() || now - lastCameraPublish < CAMERA_INTERVAL_MS) return;
  lastCameraPublish = now;
  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) { Serial.println("[Camera] Capture failed"); return; }

  String topic = mqtt_topic("/image");
  bool ok = mqttClient.beginPublish(topic.c_str(), frame->len, false);
  if (ok) ok = mqttClient.write(frame->buf, frame->len) == frame->len;
  if (ok) ok = mqttClient.endPublish();
  Serial.printf("[Camera] JPEG %u bytes: %s\n", frame->len, ok ? "published" : "publish failed");
  esp_camera_fb_return(frame);
}

#endif
