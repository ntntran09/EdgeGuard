#include "libs.h"
#include "config.h"
#include "mqtt.h"
#include "actuators.h"
#include "device.h"
#include "pn532_reader.h"
#include "camera.h"
#include "fomo.h"
#include "sensors.h"

bool publish_system_metrics = true;
TaskHandle_t edgeguardControlTaskHandle = nullptr;

void edgeguard_runControlLoops() {
  mqtt_loop();
  actuators_loop();
  pn532_loop();
  camera_loop();
  // Core 1 queues FOMO results for the low-priority HTTP task on Core 0. This
  // loop drains MQTT vision alerts, keeping PubSubClient serialized here.
  fomo_loop();
  sensors_loop();
  device_loop();
}

void edgeguard_controlTask(void *parameter) {
  (void)parameter;
  Serial.printf("[System] Control task running on Core %d\n", xPortGetCoreID());

  for (;;) {
    edgeguard_runControlLoops();
    vTaskDelay(pdMS_TO_TICKS(EDGEGUARD_CONTROL_TASK_DELAY_MS));
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH);

  // Camera first so it reserves its LEDC timer/channel before servo and tone.
  camera_setup();
  actuators_setup();
  device_setup();
  pn532_setup();
  mqtt_setup();
  sensors_setup();
  fomo_setup();

  BaseType_t created = xTaskCreatePinnedToCore(
    edgeguard_controlTask,
    "edgeguard-control",
    EDGEGUARD_CONTROL_TASK_STACK_BYTES,
    nullptr,
    EDGEGUARD_CONTROL_TASK_PRIORITY,
    &edgeguardControlTaskHandle,
    EDGEGUARD_CONTROL_CORE
  );
  if (created != pdPASS) {
    edgeguardControlTaskHandle = nullptr;
    Serial.println("[System] Could not create Core 0 control task; using Arduino loop fallback");
  }
}

void loop() {
  if (edgeguardControlTaskHandle) {
    // setup()/loop() is pinned to Core 1 by Arduino-ESP32. Core 1 now belongs
    // to FOMO, so release the otherwise-unused Arduino loop task and its stack.
    vTaskDelete(nullptr);
  }

  edgeguard_runControlLoops();
  delay(EDGEGUARD_CONTROL_TASK_DELAY_MS);
}
