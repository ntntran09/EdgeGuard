#ifndef EDGEGUARD_PN532_READER_H
#define EDGEGUARD_PN532_READER_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

PN532_I2C pn532Interface(Wire);
PN532 nfc(pn532Interface);
bool pn532Ready = false;
unsigned long lastNfcSeenAt = 0;
String lastNfcUid;

void pn532_setup() {
  // Initialize Wire on the ESP32-CAM free pins before nfc.begin().
  // PN532_I2C::begin() calls Wire.begin() again; on ESP32 an already-started
  // bus keeps these pins.
  if (!Wire.begin(PN532_SDA_PIN, PN532_SCL_PIN)) {
    Serial.println("[PN532] Failed to start I2C bus");
    return;
  }
  Wire.setClock(100000);

  nfc.begin();
  // Some PN532_I2C library versions call Wire.begin() without pins inside
  // begin(), which can reset ESP32 I2C back to default SDA/SCL. Put the bus
  // back on the wired ESP32-CAM pins before the first PN532 command.
  Wire.begin(PN532_SDA_PIN, PN532_SCL_PIN);
  Wire.setClock(100000);
  delay(50);

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
    (version >> 24) & 0xFF,
    (version >> 16) & 0xFF,
    (version >> 8) & 0xFF
  );
}

void pn532_loop() {
  if (!pn532Ready) return;

  uint8_t uid[7] = {0};
  uint8_t uidLength = 0;
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 50)) return;
  if (uidLength == 0 || uidLength > sizeof(uid)) {
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
  if (uidHex == lastNfcUid && now - lastNfcSeenAt < NFC_REPEAT_DELAY_MS) return;

  Serial.printf("[PN532] UID: %s\n", uidHex.c_str());

  if (mqttClient.connected()) {
    StaticJsonDocument<192> doc;
    doc["uid"] = uidHex;
    doc["uid_length"] = uidLength;
    doc["technology"] = "ISO14443A";
    doc["uptime_ms"] = now;
    if (!mqtt_publishJson("/telemetry/nfc", doc)) {
      Serial.println("[PN532] MQTT publish failed");
    }
  } else {
    Serial.println("[PN532] MQTT offline; UID not published");
  }

  lastNfcUid = uidHex;
  lastNfcSeenAt = now;
}

#endif
