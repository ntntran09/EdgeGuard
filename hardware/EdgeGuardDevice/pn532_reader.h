#ifndef EDGEGUARD_PN532_READER_H
#define EDGEGUARD_PN532_READER_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

PN532_I2C pn532Interface(Wire);
PN532 nfc(pn532Interface);
bool pn532Ready = false;
unsigned long lastNfcPublish = 0;
String lastNfcUid;

void pn532_setup() {
  Wire.begin(PN532_SDA_PIN, PN532_SCL_PIN);
  nfc.begin();
  uint32_t version = nfc.getFirmwareVersion();
  if (!version) {
    Serial.println("[PN532] Not found; check I2C mode and wiring");
    return;
  }
  nfc.SAMConfig();
  pn532Ready = true;
  Serial.printf("[PN532] Ready, firmware %d.%d\n", (version >> 16) & 0xff, (version >> 8) & 0xff);
}

void pn532_loop() {
  if (!pn532Ready || !mqttClient.connected()) return;
  uint8_t uid[7] = {0};
  uint8_t uidLength = 0;
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 50)) return;

  String uidHex;
  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] < 0x10) uidHex += "0";
    uidHex += String(uid[i], HEX);
  }
  uidHex.toUpperCase();
  if (uidHex == lastNfcUid && millis() - lastNfcPublish < NFC_REPEAT_DELAY_MS) return;

  StaticJsonDocument<192> doc;
  doc["uid"] = uidHex;
  doc["uid_length"] = uidLength;
  doc["technology"] = "ISO14443A";
  doc["read_at_ms"] = millis();
  mqtt_publishJson("/telemetry/nfc", doc);
  lastNfcUid = uidHex;
  lastNfcPublish = millis();
  Serial.printf("[PN532] UID: %s\n", uidHex.c_str());
}

#endif
