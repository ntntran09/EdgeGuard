#ifndef EDGEGUARD_SENSORS_H
#define EDGEGUARD_SENSORS_H

#include "libs.h"
#include "config.h"
#include "http_transport.h"
#include "device.h"
#include "fomo.h"

unsigned long lastSystemPublish = 0;

void sensors_setup() { Serial.println("[System] Telemetry initialized"); }

void sensors_publishDoorState() {
  if ((!doorStateDirty && !alarmStateDirty)
      || (!transport_httpAvailable() && !mqttClient.connected())) return;

  JsonDocument doc;
  doc["door_open"] = doorOpenState;
  doc["state"] = doorOpenState ? "open" : "closed";
  doc["reason"] = doorStateReason;
  doc["changed_at_ms"] = doorStateChangedAt;
  doc["auto_lock_pending"] = doorLockPending;
  doc["alarm_active"] = alarmActive;
  doc["alarm_source"] = !alarmActive
    ? "none"
    : (alarmManualOverrideActive ? "manual" : "vision");
  if (doorLockPending) {
    long remaining = static_cast<long>(doorLockAt - millis());
    doc["auto_lock_remaining_ms"] = remaining > 0 ? remaining : 0;
  }

  if (transport_publishJson("/telemetry/security", doc)) {
    doorStateDirty = false;
    alarmStateDirty = false;
  }
}

void sensors_loop() {
  unsigned long now = millis();
  sensors_publishDoorState();
  if (!publish_system_metrics) return;
  if (now - lastSystemPublish < SYSTEM_INTERVAL_MS) return;
  if (!transport_httpAvailable() && !mqttClient.connected()) return;

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
  doc["camera_transport"] = "http";
  doc["ai_detection_enabled"] = deviceAiDetectionEnabled;
  doc["camera_blocked_alert_enabled"] = deviceCameraBlockedAlertEnabled;
  doc["object_left_alert_enabled"] = deviceObjectLeftAlertEnabled;
  doc["stranger_alert_enabled"] = deviceStrangerAlertEnabled;
  doc["vision_stable_alert_ms"] = deviceVisionStableAlertMs;
  doc["camera_blocked"] = static_cast<bool>(fomoCameraBlocked);
  doc["alarm_active"] = alarmActive;
  doc["alarm_source"] = !alarmActive
    ? "none"
    : (alarmManualOverrideActive ? "manual" : "vision");
  doc["fomo_ready"] = static_cast<bool>(fomoReady);
  doc["fomo_inference_count"] = static_cast<uint32_t>(fomoInferenceCount);
  doc["fomo_inference_failures"] = static_cast<uint32_t>(fomoInferenceFailures);
  doc["fomo_last_inference_ms"] = static_cast<unsigned long>(lastFomoInferenceMs);
  doc["fomo_http_last_status"] = static_cast<int>(lastFomoHttpStatus);
  doc["fomo_http_last_success_ms"] = static_cast<unsigned long>(lastFomoHttpSuccessAt);
  doc["fomo_http_failures"] = static_cast<uint32_t>(fomoHttpFailures);
  doc["telemetry_http_last_status"] = transportLastHttpStatus;
  doc["telemetry_http_last_success_ms"] = transportLastHttpSuccessAt;
  doc["telemetry_http_failures"] = transportHttpFailures;
  doc["fomo_last_detection_count"] = static_cast<uint16_t>(lastFomoDetectionCount);
  doc["fomo_people_count"] = static_cast<uint16_t>(lastFomoPeopleCount);
  doc["fomo_bag_count"] = static_cast<uint16_t>(lastFomoBagCount);
  doc["fomo_package_count"] = static_cast<uint16_t>(lastFomoPackageCount);
  doc["control_core"] = EDGEGUARD_CONTROL_CORE;
  doc["fomo_core"] = EDGEGUARD_FOMO_CORE;
  doc["fomo_http_core"] = EDGEGUARD_CONTROL_CORE;
  doc["door_open"] = doorOpenState;
  doc["door_state_reason"] = doorStateReason;
  doc["auto_lock_enabled"] = deviceAutoLockEnabled;
  doc["auto_lock_ms"] = deviceAutoLockMs;
  doc["offline_rfid_count"] = deviceRfidAllowlistCount;
  if (lastNfcUid.length() > 0) {
    doc["last_nfc_uid"] = lastNfcUid;
    doc["last_nfc_seen_ms"] = lastNfcSeenAt;
  }

  transport_publishJson("/telemetry/system", doc);
  lastSystemPublish = now;
}

#endif
