#ifndef EDGEGUARD_SENSORS_H
#define EDGEGUARD_SENSORS_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

unsigned long lastSystemPublish = 0;

void sensors_setup() { Serial.println("[System] Telemetry initialized"); }

void sensors_loop() {
  unsigned long now = millis();
  if (!publish_system_metrics || !mqttClient.connected()) return;
  if (now - lastSystemPublish < SYSTEM_INTERVAL_MS) return;

  StaticJsonDocument<256> doc;
  doc["uptime_ms"] = now;
  doc["rssi_dbm"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["psram_free"] = ESP.getFreePsram();
  doc["pn532_ready"] = pn532Ready;
  if (lastNfcUid.length() > 0) {
    doc["last_nfc_uid"] = lastNfcUid;
    doc["last_nfc_seen_ms"] = lastNfcSeenAt;
  }

  if (mqtt_publishJson("/telemetry/system", doc)) {
    lastSystemPublish = now;
  }
}

#endif
