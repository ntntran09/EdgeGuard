#include "libs.h"
#include "config.h"
#include "device.h"
#include "mqtt.h"
#include "sensors.h"

unsigned long sample_interval_ms = DEFAULT_SAMPLE_INTERVAL_MS;
unsigned long security_interval_ms = DEFAULT_SECURITY_INTERVAL_MS;
bool publish_system_metrics = true;

void setup() {
  Serial.begin(115200);
  delay(100);

  sensors_setup();
  mqtt_setup();
}

void loop() {
  mqtt_loop();
  sensors_loop();
  device_loop();
}
