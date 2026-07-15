#ifndef EDGEGUARD_LIBS_H
#define EDGEGUARD_LIBS_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <Wire.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>
#include <Preferences.h>

// Select the I2C transport. Arduino builds the library's PN532_I2C.cpp as a
// separate translation unit; including that source file here would define
// every PN532_I2C method twice at link time.
#ifndef NFC_INTERFACE_I2C
#define NFC_INTERFACE_I2C
#endif
#include <PN532_I2C.h>
#include <PN532.h>

#include "esp_camera.h"

#endif
