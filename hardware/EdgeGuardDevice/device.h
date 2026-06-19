#ifndef EDGEGUARD_DEVICE_H
#define EDGEGUARD_DEVICE_H

#include "libs.h"
#include "config.h"

void device_applyConfig(JsonDocument &doc) {
  if (doc["payload"]["sample_interval_ms"].is<unsigned long>()) {
    sample_interval_ms = doc["payload"]["sample_interval_ms"];
  } else if (doc["sample_interval_ms"].is<unsigned long>()) {
    sample_interval_ms = doc["sample_interval_ms"];
  }

  if (doc["payload"]["security_interval_ms"].is<unsigned long>()) {
    security_interval_ms = doc["payload"]["security_interval_ms"];
  } else if (doc["security_interval_ms"].is<unsigned long>()) {
    security_interval_ms = doc["security_interval_ms"];
  }

  if (doc["payload"]["publish_system_metrics"].is<bool>()) {
    publish_system_metrics = doc["payload"]["publish_system_metrics"];
  } else if (doc["publish_system_metrics"].is<bool>()) {
    publish_system_metrics = doc["publish_system_metrics"];
  }

  Serial.println("[Device] Config updated");
}

void device_handleCommand(String topic, String payload) {
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    Serial.print("[Device] Invalid JSON command: ");
    Serial.println(error.c_str());
    return;
  }

  if (topic.endsWith("/command/config")) {
    device_applyConfig(doc);
    return;
  }

  if (topic.endsWith("/command/scan")) {
    Serial.println("[Device] Scan command received");
    return;
  }

  if (topic.endsWith("/command/reboot")) {
    Serial.println("[Device] Reboot command received");
    delay(250);
    ESP.restart();
  }
}

void device_loop() {
  digitalWrite(STATUS_LED_PIN, WiFi.status() == WL_CONNECTED ? LOW : HIGH);
}

#endif
