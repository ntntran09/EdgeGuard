#ifndef EDGEGUARD_SENSORS_H
#define EDGEGUARD_SENSORS_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"
#include "device.h"
#include "fomo.h"

unsigned long lastSystemPublish = 0;

void sensors_setup() { Serial.println("[System] Telemetry initialized"); }

void sensors_publishDoorState() {
  if (!doorStateDirty || !mqttClient.connected()) return;

  JsonDocument doc;
  doc["door_open"] = doorOpenState;
  doc["state"] = doorOpenState ? "open" : "closed";
  doc["reason"] = doorStateReason;
  doc["changed_at_ms"] = doorStateChangedAt;
  doc["auto_lock_pending"] = doorLockPending;
  if (doorLockPending) {
    long remaining = static_cast<long>(doorLockAt - millis());
    doc["auto_lock_remaining_ms"] = remaining > 0 ? remaining : 0;
  }

  if (mqtt_publishJson("/telemetry/security", doc)) {
    doorStateDirty = false;
  }
}

void sensors_loop() {
  unsigned long now = millis();
  if (!mqttClient.connected()) return;
  sensors_publishDoorState();
  if (!publish_system_metrics) return;
  if (now - lastSystemPublish < SYSTEM_INTERVAL_MS) return;

  JsonDocument doc;
  doc["uptime_ms"] = now;
  doc["rssi_dbm"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["psram_free"] = ESP.getFreePsram();
  doc["pn532_ready"] = pn532Ready;
  doc["camera_ready"] = cameraReady;
  doc["camera_last_success_ms"] = lastCameraSuccessAt;
  doc["camera_last_frame_bytes"] = lastCameraFrameBytes;
  doc["camera_publish_failures"] = cameraPublishFailures;
  doc["camera_publish_enabled"] = deviceCameraPublishEnabled;
  doc["ai_detection_enabled"] = deviceAiDetectionEnabled;
  doc["fomo_ready"] = fomoReady;
  doc["fomo_inference_count"] = fomoInferenceCount;
  doc["fomo_inference_failures"] = fomoInferenceFailures;
  doc["fomo_last_inference_ms"] = lastFomoInferenceMs;
  doc["fomo_last_detection_count"] = lastFomoDetectionCount;
  doc["fomo_people_count"] = lastFomoPeopleCount;
  doc["fomo_bag_count"] = lastFomoBagCount;
  doc["fomo_package_count"] = lastFomoPackageCount;
  doc["door_open"] = doorOpenState;
  doc["door_state_reason"] = doorStateReason;
  doc["auto_lock_enabled"] = deviceAutoLockEnabled;
  doc["auto_lock_ms"] = deviceAutoLockMs;
  doc["offline_rfid_count"] = deviceRfidAllowlistCount;
  if (lastNfcUid.length() > 0) {
    doc["last_nfc_uid"] = lastNfcUid;
    doc["last_nfc_seen_ms"] = lastNfcSeenAt;
  }

  if (mqtt_publishJson("/telemetry/system", doc)) {
    lastSystemPublish = now;
  }
}

#endif
