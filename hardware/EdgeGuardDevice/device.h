#ifndef EDGEGUARD_DEVICE_H
#define EDGEGUARD_DEVICE_H

#include "libs.h"
#include "config.h"
#include "actuators.h"

bool deviceAutoLockEnabled = true;
volatile bool deviceCameraPublishEnabled = true;
volatile bool deviceAiDetectionEnabled = true;
unsigned long deviceAutoLockMs = DEFAULT_AUTO_LOCK_MS;
int deviceLockAngle = SERVO_LOCK_ANGLE;
int deviceUnlockAngle = SERVO_UNLOCK_ANGLE;
String deviceRfidAllowlist[MAX_OFFLINE_RFID_CARDS];
size_t deviceRfidAllowlistCount = 0;
String deviceRfidAllowlistCsv;

String device_normalizeUid(const String &value) {
  String normalized;
  normalized.reserve(value.length());

  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    if (c >= '0' && c <= '9') normalized += c;
    else if (c >= 'a' && c <= 'f') normalized += static_cast<char>(c - 'a' + 'A');
    else if (c >= 'A' && c <= 'F') normalized += c;
  }

  return normalized;
}

void device_loadRfidCsv(const String &csv) {
  deviceRfidAllowlistCount = 0;
  deviceRfidAllowlistCsv = csv;
  size_t start = 0;

  while (start < csv.length() && deviceRfidAllowlistCount < MAX_OFFLINE_RFID_CARDS) {
    int separator = csv.indexOf(',', start);
    size_t end = separator < 0 ? csv.length() : static_cast<size_t>(separator);
    String uid = device_normalizeUid(csv.substring(start, end));
    if (uid.length() == 8 || uid.length() == 14) {
      deviceRfidAllowlist[deviceRfidAllowlistCount++] = uid;
    }
    if (separator < 0) break;
    start = end + 1;
  }
}

bool device_isRfidAuthorized(const String &uid) {
  String normalized = device_normalizeUid(uid);
  for (size_t i = 0; i < deviceRfidAllowlistCount; i++) {
    if (deviceRfidAllowlist[i] == normalized) return true;
  }
  return false;
}

void device_printRfidAllowlist(const char *label) {
  Serial.printf(
    "[Device] %s RFID cache (%u card(s)):",
    label,
    static_cast<unsigned int>(deviceRfidAllowlistCount)
  );
  if (deviceRfidAllowlistCount == 0) {
    Serial.println(" empty");
    return;
  }

  for (size_t i = 0; i < deviceRfidAllowlistCount; i++) {
    Serial.printf(" %s", deviceRfidAllowlist[i].c_str());
  }
  Serial.println();
}

String device_buildRfidCsv(JsonArrayConst allowlist) {
  String normalizedCards[MAX_OFFLINE_RFID_CARDS];
  size_t count = 0;

  for (JsonVariantConst item : allowlist) {
    if (count >= MAX_OFFLINE_RFID_CARDS) break;
    String uid = device_normalizeUid(item.as<String>());
    if (uid.length() != 8 && uid.length() != 14) continue;

    bool duplicate = false;
    for (size_t i = 0; i < count; i++) {
      if (normalizedCards[i] == uid) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) normalizedCards[count++] = uid;
  }

  String csv;
  for (size_t i = 0; i < count; i++) {
    if (i > 0) csv += ',';
    csv += normalizedCards[i];
  }
  return csv;
}

void device_setup() {
  Preferences preferences;
  if (preferences.begin("edgeguard", true)) {
    deviceAutoLockEnabled = preferences.getBool("autolock", true);
    deviceCameraPublishEnabled = preferences.getBool("campub", true);
    deviceAiDetectionEnabled = preferences.getBool("aienabled", true);
    deviceAutoLockMs = preferences.getULong("lockms", DEFAULT_AUTO_LOCK_MS);
    deviceLockAngle = preferences.getInt("lockang", SERVO_LOCK_ANGLE);
    deviceUnlockAngle = preferences.getInt("unlockang", SERVO_UNLOCK_ANGLE);
    device_loadRfidCsv(preferences.getString("rfiduids", ""));
    preferences.end();
  }

  actuators_lockDoor(deviceLockAngle, "startup");
  Serial.printf(
    "[Device] Loaded config: auto-lock %s after %lu ms, camera live view %s, AI detection %s, %u offline RFID card(s)\n",
    deviceAutoLockEnabled ? "on" : "off",
    deviceAutoLockMs,
    deviceCameraPublishEnabled ? "on" : "off",
    deviceAiDetectionEnabled ? "on" : "off",
    static_cast<unsigned int>(deviceRfidAllowlistCount)
  );
  device_printRfidAllowlist("Loaded");
}

bool device_unlockForCachedRfid(const String &uid) {
  if (!device_isRfidAuthorized(uid)) return false;

  actuators_unlockDoor(
    deviceUnlockAngle,
    deviceLockAngle,
    deviceAutoLockEnabled ? deviceAutoLockMs : 0,
    "rfid_cache"
  );
  return true;
}

void device_applyConfig(JsonDocument &doc) {
  JsonVariant source = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) source = doc["payload"];
  if (source["publish_system_metrics"].is<bool>()) publish_system_metrics = source["publish_system_metrics"];

  bool persistAutoLock = false;
  bool persistCameraPublish = false;
  bool persistAiDetection = false;
  bool persistAutoLockMs = false;
  bool persistLockAngle = false;
  bool persistUnlockAngle = false;
  bool persistRfidAllowlist = false;

  if (source["auto_lock_enabled"].is<bool>()) {
    bool next = source["auto_lock_enabled"].as<bool>();
    persistAutoLock = next != deviceAutoLockEnabled;
    deviceAutoLockEnabled = next;
    if (!deviceAutoLockEnabled) doorLockPending = false;
  }

  if (source["camera_publish_enabled"].is<bool>()) {
    bool next = source["camera_publish_enabled"].as<bool>();
    persistCameraPublish = next != deviceCameraPublishEnabled;
    deviceCameraPublishEnabled = next;
  }

  if (source["ai_detection_enabled"].is<bool>()) {
    bool next = source["ai_detection_enabled"].as<bool>();
    persistAiDetection = next != deviceAiDetectionEnabled;
    deviceAiDetectionEnabled = next;
  }

  if (!source["auto_lock_ms"].isNull()) {
    unsigned long next = constrain(
      source["auto_lock_ms"].as<unsigned long>(),
      1000UL,
      MAX_AUTO_LOCK_MS
    );
    persistAutoLockMs = next != deviceAutoLockMs;
    deviceAutoLockMs = next;
  }

  if (!source["lock_angle"].isNull()) {
    int next = constrain(source["lock_angle"].as<int>(), 0, 180);
    persistLockAngle = next != deviceLockAngle;
    deviceLockAngle = next;
  }

  if (!source["unlock_angle"].isNull()) {
    int next = constrain(source["unlock_angle"].as<int>(), 0, 180);
    persistUnlockAngle = next != deviceUnlockAngle;
    deviceUnlockAngle = next;
  }

  if (source["rfid_allowlist"].is<JsonArrayConst>()) {
    String next = device_buildRfidCsv(source["rfid_allowlist"].as<JsonArrayConst>());
    persistRfidAllowlist = next != deviceRfidAllowlistCsv;
    if (persistRfidAllowlist) device_loadRfidCsv(next);
  }

  if (persistAutoLock || persistCameraPublish || persistAiDetection || persistAutoLockMs || persistLockAngle || persistUnlockAngle || persistRfidAllowlist) {
    Preferences preferences;
    if (preferences.begin("edgeguard", false)) {
      if (persistAutoLock) preferences.putBool("autolock", deviceAutoLockEnabled);
      if (persistCameraPublish) preferences.putBool("campub", deviceCameraPublishEnabled);
      if (persistAiDetection) preferences.putBool("aienabled", deviceAiDetectionEnabled);
      if (persistAutoLockMs) preferences.putULong("lockms", deviceAutoLockMs);
      if (persistLockAngle) preferences.putInt("lockang", deviceLockAngle);
      if (persistUnlockAngle) preferences.putInt("unlockang", deviceUnlockAngle);
      if (persistRfidAllowlist) {
        preferences.putString("rfiduids", deviceRfidAllowlistCsv);
        String storedRfidCsv = preferences.getString("rfiduids", "");
        if (storedRfidCsv == deviceRfidAllowlistCsv) {
          Serial.printf(
            "[Device] Saved %u RFID card(s) to NVS\n",
            static_cast<unsigned int>(deviceRfidAllowlistCount)
          );
        } else {
          Serial.println("[Device] ERROR: RFID allowlist was not saved to NVS");
        }
      }
      preferences.end();
    } else {
      Serial.println("[Device] ERROR: Could not open NVS for access config");
    }
  }

  Serial.printf(
    "[Device] Config updated: auto-lock %s after %lu ms, camera live view %s, AI detection %s, %u offline RFID card(s)\n",
    deviceAutoLockEnabled ? "on" : "off",
    deviceAutoLockMs,
    deviceCameraPublishEnabled ? "on" : "off",
    deviceAiDetectionEnabled ? "on" : "off",
    static_cast<unsigned int>(deviceRfidAllowlistCount)
  );
  device_printRfidAllowlist("Current");
}

void device_handleCommand(String topic, String payload) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.printf("[Device] Invalid JSON: %s\n", error.c_str());
    return;
  }

  if (topic.endsWith("/command/buzzer")) buzzer_command(doc);
  else if (topic.endsWith("/command/servo")) servo_command(doc);
  else if (topic.endsWith("/command/alarm")) alarm_command(doc);
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
