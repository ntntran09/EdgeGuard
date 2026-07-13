#include "libs.h"
#include "config.h"
#include "mqtt.h"
#include "actuators.h"
#include "device.h"
#include "pn532_reader.h"
#include "camera.h"
#include "sensors.h"

bool publish_system_metrics = true;

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH);

  // Camera first so it reserves its LEDC timer/channel before servo and tone.
  camera_setup();
  actuators_setup();
  pn532_setup();
  mqtt_setup();
  sensors_setup();
}

void loop() {
  mqtt_loop();
  actuators_loop();
  pn532_loop();
  camera_loop();
  sensors_loop();
  device_loop();
}
