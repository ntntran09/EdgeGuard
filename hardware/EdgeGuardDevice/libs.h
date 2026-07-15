#ifndef EDGEGUARD_LIBS_H
#define EDGEGUARD_LIBS_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <Wire.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>

// The supplied PN532-Arduino ZIP conditionally compiles each transport.
// For Arduino IDE builds, its own examples enable I2C and include the
// transport implementation directly. Without these two lines the sketch
// can compile headers but fail at link time with missing PN532_I2C methods.
#ifndef NFC_INTERFACE_I2C
#define NFC_INTERFACE_I2C
#endif
#include <PN532_I2C.h>
#include <PN532_I2C.cpp>
#include <PN532.h>

#include "esp_camera.h"

#endif
