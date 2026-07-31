#ifndef EDGEGUARD_DEVICE_H
#define EDGEGUARD_DEVICE_H

#include "libs.h"
#include "config.h"
#include "actuators.h"

extern void fomo_handleRecognitionResult(JsonDocument &doc);

bool deviceAutoLockEnabled = true;
volatile bool deviceCameraPublishEnabled = true;
volatile bool deviceAiDetectionEnabled = true;
volatile bool deviceCameraBlockedAlertEnabled = true;
volatile bool deviceObjectLeftAlertEnabled = true;
volatile bool deviceStrangerAlertEnabled = true;
unsigned long deviceVisionStableAlertMs = 60000UL;
unsigned long deviceAutoLockMs = DEFAULT_AUTO_LOCK_MS;
int deviceLockAngle = SERVO_LOCK_ANGLE;
int deviceUnlockAngle = SERVO_UNLOCK_ANGLE;
String deviceFomoHttpResultUrl = DEFAULT_FOMO_HTTP_RESULT_URL;
String deviceBackendHttpUrl = DEFAULT_BACKEND_HTTP_URL;
SemaphoreHandle_t deviceFomoHttpUrlMutex = nullptr;
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

bool device_isHttpUrl(const String &value) {
  return value.length() > 0
    && value.length() <= 180
    && (value.startsWith("http://") || value.startsWith("https://"));
}

String device_getFomoHttpResultUrl() {
  if (!deviceFomoHttpUrlMutex
      || xSemaphoreTake(deviceFomoHttpUrlMutex, pdMS_TO_TICKS(100)) != pdTRUE) {
    return String();
  }
  String value = deviceFomoHttpResultUrl;
  xSemaphoreGive(deviceFomoHttpUrlMutex);
  return value;
}

String device_getBackendHttpUrl() {
  if (!deviceFomoHttpUrlMutex
      || xSemaphoreTake(deviceFomoHttpUrlMutex, pdMS_TO_TICKS(100)) != pdTRUE) {
    return String();
  }
  String value = deviceBackendHttpUrl;
  xSemaphoreGive(deviceFomoHttpUrlMutex);
  return value;
}

bool device_setFomoHttpResultUrl(const String &value) {
  if (!deviceFomoHttpUrlMutex
      || xSemaphoreTake(deviceFomoHttpUrlMutex, pdMS_TO_TICKS(100)) != pdTRUE) {
    return false;
  }
  bool changed = value != deviceFomoHttpResultUrl;
  deviceFomoHttpResultUrl = value;
  xSemaphoreGive(deviceFomoHttpUrlMutex);
  return changed;
}

void device_setup() {
  if (!deviceFomoHttpUrlMutex) deviceFomoHttpUrlMutex = xSemaphoreCreateMutex();
  Preferences preferences;
  if (preferences.begin("edgeguard", true)) {
    deviceAutoLockEnabled = preferences.getBool("autolock", true);
    deviceCameraPublishEnabled = preferences.getBool("campub", true);
    deviceAiDetectionEnabled = preferences.getBool("aienabled", true);
    deviceCameraBlockedAlertEnabled = preferences.getBool("camblock", true);
    deviceObjectLeftAlertEnabled = preferences.getBool("objalert", true);
    deviceStrangerAlertEnabled = preferences.getBool("stralert", true);
    deviceVisionStableAlertMs = preferences.getULong("visionms", 60000UL);
    deviceVisionStableAlertMs = constrain(
      deviceVisionStableAlertMs,
      MIN_VISION_STABLE_ALERT_MS,
      MAX_VISION_STABLE_ALERT_MS
    );
    deviceAutoLockMs = preferences.getULong("lockms", DEFAULT_AUTO_LOCK_MS);
    deviceLockAngle = preferences.getInt("lockang", SERVO_LOCK_ANGLE);
    deviceUnlockAngle = preferences.getInt("unlockang", SERVO_UNLOCK_ANGLE);
    deviceFomoHttpResultUrl = preferences.getString("fomourl", DEFAULT_FOMO_HTTP_RESULT_URL);
    deviceBackendHttpUrl = preferences.getString("backendurl", DEFAULT_BACKEND_HTTP_URL);
    if (!device_isHttpUrl(deviceFomoHttpResultUrl)) {
      deviceFomoHttpResultUrl = DEFAULT_FOMO_HTTP_RESULT_URL;
    }
    if (!device_isHttpUrl(deviceBackendHttpUrl)) deviceBackendHttpUrl = DEFAULT_BACKEND_HTTP_URL;
    device_loadRfidCsv(preferences.getString("rfiduids", ""));
    preferences.end();
  }

  actuators_lockDoor(deviceLockAngle, "startup");
  Serial.printf(
    "[Device] Loaded config: auto-lock %s after %lu ms, camera live view %s, AI detection %s, camera-block alert %s, %u offline RFID card(s)\n",
    deviceAutoLockEnabled ? "on" : "off",
    deviceAutoLockMs,
    deviceCameraPublishEnabled ? "on" : "off",
    deviceAiDetectionEnabled ? "on" : "off",
    deviceCameraBlockedAlertEnabled ? "on" : "off",
    static_cast<unsigned int>(deviceRfidAllowlistCount)
  );
  String fomoHttpUrl = device_getFomoHttpResultUrl();
  Serial.printf("[Device] FOMO HTTP endpoint: %s\n", fomoHttpUrl.c_str());
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
  bool persistCameraBlockedAlert = false;
  bool persistObjectLeftAlert = false;
  bool persistStrangerAlert = false;
  bool persistVisionStableMs = false;
  bool persistAutoLockMs = false;
  bool persistLockAngle = false;
  bool persistUnlockAngle = false;
  bool persistFomoHttpUrl = false;
  bool persistBackendHttpUrl = false;
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

  if (source["camera_blocked_alert_enabled"].is<bool>()) {
    bool next = source["camera_blocked_alert_enabled"].as<bool>();
    persistCameraBlockedAlert = next != deviceCameraBlockedAlertEnabled;
    deviceCameraBlockedAlertEnabled = next;
  }

  if (source["object_left_alert_enabled"].is<bool>()) {
    bool next = source["object_left_alert_enabled"].as<bool>();
    persistObjectLeftAlert = next != deviceObjectLeftAlertEnabled;
    deviceObjectLeftAlertEnabled = next;
  }

  if (source["stranger_alert_enabled"].is<bool>()) {
    bool next = source["stranger_alert_enabled"].as<bool>();
    persistStrangerAlert = next != deviceStrangerAlertEnabled;
    deviceStrangerAlertEnabled = next;
  }

  if (!source["vision_stable_alert_ms"].isNull()) {
    unsigned long next = constrain(
      source["vision_stable_alert_ms"].as<unsigned long>(),
      MIN_VISION_STABLE_ALERT_MS,
      MAX_VISION_STABLE_ALERT_MS
    );
    persistVisionStableMs = next != deviceVisionStableAlertMs;
    deviceVisionStableAlertMs = next;
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

  const char *nextFomoUrl = nullptr;
  if (source["fomo_inference_url"].is<const char *>()) {
    nextFomoUrl = source["fomo_inference_url"];
  } else if (source["fomo_http_result_url"].is<const char *>()) {
    nextFomoUrl = source["fomo_http_result_url"];
  }
  if (nextFomoUrl) {
    String normalizedUrl = String(nextFomoUrl);
    normalizedUrl.trim();
    if (device_isHttpUrl(normalizedUrl)) {
      persistFomoHttpUrl = device_setFomoHttpResultUrl(normalizedUrl);
    } else {
      Serial.println("[Device] Ignored invalid FOMO HTTP URL from config");
    }
  }

  if (source["backend_url"].is<const char *>()) {
    String nextBackendUrl = String(source["backend_url"].as<const char *>());
    nextBackendUrl.trim();
    while (nextBackendUrl.endsWith("/")) nextBackendUrl.remove(nextBackendUrl.length() - 1);
    if (device_isHttpUrl(nextBackendUrl)) {
      persistBackendHttpUrl = nextBackendUrl != deviceBackendHttpUrl;
      deviceBackendHttpUrl = nextBackendUrl;
    } else {
      Serial.println("[Device] Ignored invalid backend HTTP URL from config");
    }
  }

  if (source["rfid_allowlist"].is<JsonArrayConst>()) {
    String next = device_buildRfidCsv(source["rfid_allowlist"].as<JsonArrayConst>());
    persistRfidAllowlist = next != deviceRfidAllowlistCsv;
    if (persistRfidAllowlist) device_loadRfidCsv(next);
  }

  if (persistAutoLock || persistCameraPublish || persistAiDetection || persistCameraBlockedAlert
      || persistObjectLeftAlert || persistStrangerAlert || persistVisionStableMs
      || persistAutoLockMs || persistLockAngle || persistUnlockAngle
      || persistFomoHttpUrl || persistBackendHttpUrl || persistRfidAllowlist) {
    Preferences preferences;
    if (preferences.begin("edgeguard", false)) {
      if (persistAutoLock) preferences.putBool("autolock", deviceAutoLockEnabled);
      if (persistCameraPublish) preferences.putBool("campub", deviceCameraPublishEnabled);
      if (persistAiDetection) preferences.putBool("aienabled", deviceAiDetectionEnabled);
      if (persistCameraBlockedAlert) preferences.putBool("camblock", deviceCameraBlockedAlertEnabled);
      if (persistObjectLeftAlert) preferences.putBool("objalert", deviceObjectLeftAlertEnabled);
      if (persistStrangerAlert) preferences.putBool("stralert", deviceStrangerAlertEnabled);
      if (persistVisionStableMs) preferences.putULong("visionms", deviceVisionStableAlertMs);
      if (persistAutoLockMs) preferences.putULong("lockms", deviceAutoLockMs);
      if (persistLockAngle) preferences.putInt("lockang", deviceLockAngle);
      if (persistUnlockAngle) preferences.putInt("unlockang", deviceUnlockAngle);
      if (persistFomoHttpUrl) {
        String fomoHttpUrl = device_getFomoHttpResultUrl();
        preferences.putString("fomourl", fomoHttpUrl);
      }
      if (persistBackendHttpUrl) preferences.putString("backendurl", deviceBackendHttpUrl);
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
    "[Device] Config updated: auto-lock %s after %lu ms, camera live view %s, AI detection %s, camera-block alert %s, %u offline RFID card(s)\n",
    deviceAutoLockEnabled ? "on" : "off",
    deviceAutoLockMs,
    deviceCameraPublishEnabled ? "on" : "off",
    deviceAiDetectionEnabled ? "on" : "off",
    deviceCameraBlockedAlertEnabled ? "on" : "off",
    static_cast<unsigned int>(deviceRfidAllowlistCount)
  );
  String fomoHttpUrl = device_getFomoHttpResultUrl();
  Serial.printf("[Device] FOMO HTTP URL: %s\n", fomoHttpUrl.c_str());
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
  else if (topic.endsWith("/command/vision-result")) fomo_handleRecognitionResult(doc);
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
