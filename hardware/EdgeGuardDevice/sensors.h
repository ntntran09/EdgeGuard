#ifndef EDGEGUARD_SENSORS_H
#define EDGEGUARD_SENSORS_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

unsigned long lastSamplePublish = 0;
unsigned long lastSecurityPublish = 0;
unsigned long lastSystemPublish = 0;

void sensors_setup() {
  pinMode(MOTION_PIN, INPUT);
  pinMode(DOOR_PIN, INPUT_PULLUP);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH);
  Serial.println("[Sensors] Initialized");
}

void sensors_publishEnvironment() {
  int analogValue = analogRead(ANALOG_SENSOR_PIN);
  float normalized = analogValue / 1023.0;

  StaticJsonDocument<256> doc;
  doc["temperature_c"] = 24.0 + (normalized * 12.0);
  doc["humidity_pct"] = 45.0 + (normalized * 20.0);
  doc["heat_index_c"] = doc["temperature_c"].as<float>() + 1.5;
  doc["analog_raw"] = analogValue;

  mqtt_publishJson("/telemetry/environment", doc, false);
}

void sensors_publishSecurity() {
  StaticJsonDocument<256> doc;
  doc["motion"] = digitalRead(MOTION_PIN) == HIGH;
  doc["door_open"] = digitalRead(DOOR_PIN) == HIGH;
  doc["distance_mm"] = map(analogRead(ANALOG_SENSOR_PIN), 0, 1023, 1200, 80);

  mqtt_publishJson("/telemetry/security", doc, false);
}

void sensors_publishPower() {
  StaticJsonDocument<128> doc;
  doc["battery_pct"] = 100;
  doc["charging"] = false;

  mqtt_publishJson("/telemetry/power", doc, false);
}

void sensors_publishSystem() {
  StaticJsonDocument<256> doc;
  doc["uptime_ms"] = millis();
  doc["rssi_dbm"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();

  mqtt_publishJson("/telemetry/system", doc, false);
}

void sensors_loop() {
  unsigned long now = millis();

  if (now - lastSamplePublish >= sample_interval_ms) {
    lastSamplePublish = now;
    sensors_publishEnvironment();
    sensors_publishPower();
  }

  if (now - lastSecurityPublish >= security_interval_ms) {
    lastSecurityPublish = now;
    sensors_publishSecurity();
  }

  if (publish_system_metrics && now - lastSystemPublish >= SYSTEM_INTERVAL_MS) {
    lastSystemPublish = now;
    sensors_publishSystem();
  }
}

#endif
