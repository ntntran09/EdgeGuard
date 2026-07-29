#ifndef EDGEGUARD_PN532_READER_H
#define EDGEGUARD_PN532_READER_H

#include "libs.h"
#include "config.h"
#include "http_transport.h"
#include "device.h"

PN532_I2C pn532Interface(Wire);
PN532 nfc(pn532Interface);
bool pn532Ready = false;
unsigned long lastPn532InitAttempt = 0;
unsigned long lastNfcSeenAt = 0;
unsigned long lastNfcDetectionAt = 0;
String lastNfcUid;
String latchedNfcUid;

void pn532_setup() {
  pn532Ready = false;
  lastPn532InitAttempt = millis();

  // Select the custom ESP32-CAM pins before PN532_I2C calls Wire.begin().
  if (!Wire.setPins(PN532_SDA_PIN, PN532_SCL_PIN)) {
    Serial.println("[PN532] Failed to configure I2C pins");
    return;
  }

  nfc.begin();
  if (!Wire.setClock(100000)) {
    Serial.println("[PN532] Failed to start I2C bus");
    return;
  }

  uint32_t version = nfc.getFirmwareVersion();
  if (!version) {
    Serial.println("[PN532] Not found; verify I2C mode, address 0x24, power and wiring");
    return;
  }

  // Avoid an indefinitely long passive-target poll.
  if (!nfc.setPassiveActivationRetries(0x01)) {
    Serial.println("[PN532] Warning: could not set passive activation retries");
  }
  if (!nfc.SAMConfig()) {
    Serial.println("[PN532] SAMConfig failed");
    return;
  }

  pn532Ready = true;
  Serial.printf(
    "[PN532] Ready, chip PN5%02X, firmware %u.%u\n",
    static_cast<unsigned int>((version >> 24) & 0xFF),
    static_cast<unsigned int>((version >> 16) & 0xFF),
    static_cast<unsigned int>((version >> 8) & 0xFF)
  );
}

void pn532_loop() {
  if (!pn532Ready) {
    if (millis() - lastPn532InitAttempt >= PN532_INIT_RETRY_MS) {
      Serial.println("[PN532] Retrying initialization");
      Wire.end();
      pn532_setup();
    }
    return;
  }

  uint8_t uid[7] = {0};
  uint8_t uidLength = 0;
  if (!nfc.readPassiveTargetID(
        PN532_MIFARE_ISO14443A,
        uid,
        &uidLength,
        PN532_POLL_TIMEOUT_MS
      )) {
    if (latchedNfcUid.length() > 0 && millis() - lastNfcDetectionAt >= NFC_CARD_RELEASE_MS) {
      latchedNfcUid = "";
    }
    return;
  }
  if (uidLength != 4 && uidLength != 7) {
    Serial.printf("[PN532] Invalid UID length: %u\n", uidLength);
    return;
  }

  String uidHex;
  uidHex.reserve(uidLength * 2);
  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] < 0x10) uidHex += '0';
    uidHex += String(uid[i], HEX);
  }
  uidHex.toUpperCase();

  unsigned long now = millis();
  lastNfcDetectionAt = now;
  if (uidHex == latchedNfcUid) return;
  latchedNfcUid = uidHex;

  Serial.printf("[PN532] UID: %s\n", uidHex.c_str());
  actuators_playRfidReadTone();

  // A cached active card must open immediately on the ESP32. Do not wait for
  // HTTP/MQTT connectivity, which can remain stale during an outage.
  bool localAccessGranted = device_unlockForCachedRfid(uidHex);
  if (localAccessGranted) {
    Serial.println("[PN532] Cached RFID access granted");
  }

  if (transport_httpAvailable() || mqttClient.connected()) {
    JsonDocument doc;
    doc["uid"] = uidHex;
    doc["uid_length"] = uidLength;
    doc["technology"] = "ISO14443A";
    doc["uptime_ms"] = now;
    doc["local_access_granted"] = localAccessGranted;
    doc["offline_rfid_count"] = deviceRfidAllowlistCount;
    if (!transport_publishJson("/telemetry/nfc", doc)) {
      Serial.println("[PN532] HTTP and MQTT delivery both failed");
    }
  } else if (!localAccessGranted) {
    Serial.printf(
      "[PN532] Offline RFID access denied; UID not in cache (%u card(s))\n",
      static_cast<unsigned int>(deviceRfidAllowlistCount)
    );
  }

  if (!localAccessGranted && (transport_httpAvailable() || mqttClient.connected())) {
    Serial.println("[PN532] UID sent to backend for online validation");
  }

  lastNfcUid = uidHex;
  lastNfcSeenAt = now;
}

#endif
