#ifndef EDGEGUARD_SENSORS_H
#define EDGEGUARD_SENSORS_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

unsigned long lastSystemPublish = 0;

void sensors_setup() { Serial.println("[System] Telemetry initialized"); }

void sensors_loop() {
  unsigned long now = millis();
  if (!publish_system_metrics || now - lastSystemPublish < SYSTEM_INTERVAL_MS) return;
  lastSystemPublish = now;
  StaticJsonDocument<256> doc;
  doc["uptime_ms"] = now;
  doc["rssi_dbm"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["psram_free"] = ESP.getFreePsram();
  mqtt_publishJson("/telemetry/system", doc);
}

#endif
