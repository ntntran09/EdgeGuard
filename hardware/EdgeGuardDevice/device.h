#ifndef EDGEGUARD_DEVICE_H
#define EDGEGUARD_DEVICE_H

#include "libs.h"
#include "config.h"
#include "actuators.h"

void device_applyConfig(JsonDocument &doc) {
  JsonVariant source = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) source = doc["payload"];
  if (source["publish_system_metrics"].is<bool>()) publish_system_metrics = source["publish_system_metrics"];
  Serial.println("[Device] Config updated");
}

void device_handleCommand(String topic, String payload) {
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.printf("[Device] Invalid JSON: %s\n", error.c_str());
    return;
  }

  if (topic.endsWith("/command/buzzer")) buzzer_command(doc);
  else if (topic.endsWith("/command/servo")) servo_command(doc);
  else if (topic.endsWith("/command/config")) device_applyConfig(doc);
  else if (topic.endsWith("/command/scan")) Serial.println("[Device] PN532 scans continuously");
  else if (topic.endsWith("/command/reboot")) {
    Serial.println("[Device] Rebooting");
    delay(250);
    ESP.restart();
  }
}

void device_loop() {
  digitalWrite(STATUS_LED_PIN, WiFi.status() == WL_CONNECTED ? LOW : HIGH);
}

#endif
