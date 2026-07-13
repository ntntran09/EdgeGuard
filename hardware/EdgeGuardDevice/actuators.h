#ifndef EDGEGUARD_ACTUATORS_H
#define EDGEGUARD_ACTUATORS_H

#include "libs.h"
#include "config.h"

Servo doorServo;
unsigned long buzzerStopAt = 0;

void actuators_setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  doorServo.setPeriodHertz(50);
  doorServo.attach(SERVO_PIN, 500, 2400);
  doorServo.write(SERVO_START_ANGLE);
  Serial.println("[Actuators] Buzzer and servo initialized");
}

void buzzer_command(JsonDocument &doc) {
  JsonVariant payload = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) payload = doc["payload"];
  bool enabled = payload["enabled"] | true;
  unsigned int duration = constrain(payload["duration_ms"] | 500, 0, 10000);
  unsigned int frequency = constrain(payload["frequency_hz"] | 2000, 100, 10000);

  if (!enabled || duration == 0) {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
    buzzerStopAt = 0;
    return;
  }
  tone(BUZZER_PIN, frequency);
  buzzerStopAt = millis() + duration;
}

void servo_command(JsonDocument &doc) {
  JsonVariant payload = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) payload = doc["payload"];
  int angle = constrain(payload["angle"] | SERVO_START_ANGLE, 0, 180);
  doorServo.write(angle);
  Serial.printf("[Servo] Angle: %d\n", angle);
}

void actuators_loop() {
  if (buzzerStopAt != 0 && (long)(millis() - buzzerStopAt) >= 0) {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
    buzzerStopAt = 0;
  }
}

#endif
