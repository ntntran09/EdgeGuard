#ifndef EDGEGUARD_ACTUATORS_H
#define EDGEGUARD_ACTUATORS_H

#include "libs.h"
#include "config.h"

Servo doorServo;
unsigned long buzzerStopAt = 0;
unsigned long doorLockAt = 0;
unsigned long alarmToneChangeAt = 0;
int scheduledLockAngle = SERVO_LOCK_ANGLE;
bool buzzerStopPending = false;
bool doorLockPending = false;
bool doorOpenState = false;
bool doorStateDirty = true;
bool alarmActive = false;
bool alarmHighTone = false;
unsigned long doorStateChangedAt = 0;
String doorStateReason = "startup";

void actuators_markDoorState(bool open, const char *reason) {
  doorOpenState = open;
  doorStateDirty = true;
  doorStateChangedAt = millis();
  doorStateReason = reason;
}

void actuators_stopBuzzer() {
  noTone(BUZZER_PIN);
  digitalWrite(BUZZER_PIN, LOW);
  buzzerStopPending = false;
}

void actuators_playRfidReadTone() {
  if (alarmActive) return;
  tone(BUZZER_PIN, RFID_READ_TONE_HZ);
  buzzerStopAt = millis() + RFID_READ_TONE_MS;
  buzzerStopPending = true;
}

void actuators_lockDoor(int angle, const char *reason = "command") {
  doorLockPending = false;
  doorServo.write(constrain(angle, 0, 180));
  actuators_markDoorState(false, reason);
  Serial.printf("[Servo] Locked at angle %d\n", constrain(angle, 0, 180));
}

void actuators_unlockDoor(int unlockAngle, int lockAngle, unsigned long autoLockMs, const char *reason = "command") {
  doorServo.write(constrain(unlockAngle, 0, 180));
  scheduledLockAngle = constrain(lockAngle, 0, 180);
  doorLockPending = autoLockMs > 0;
  if (doorLockPending) doorLockAt = millis() + min(autoLockMs, MAX_AUTO_LOCK_MS);
  actuators_markDoorState(true, reason);

  Serial.printf(
    "[Servo] Unlocked at angle %d%s\n",
    constrain(unlockAngle, 0, 180),
    doorLockPending ? "; auto-lock scheduled" : "; auto-lock disabled"
  );
}

void actuators_setAlarm(bool active) {
  alarmActive = active;
  buzzerStopPending = false;

  if (!alarmActive) {
    actuators_stopBuzzer();
    Serial.println("[Alarm] Urgent tone stopped");
    return;
  }

  alarmHighTone = true;
  tone(BUZZER_PIN, ALARM_TONE_HIGH_HZ);
  alarmToneChangeAt = millis() + ALARM_TONE_STEP_MS;
  Serial.println("[Alarm] Urgent tone started");
}

void actuators_setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // tone() defaults to LEDC channel 0, which is also the first channel
  // allocated by ESP32Servo. Assign the buzzer its own timer before any
  // tone/noTone call so it cannot corrupt the servo's 50 Hz PWM signal.
  setToneChannel(BUZZER_LEDC_CHANNEL);

  doorServo.setPeriodHertz(50);
  doorServo.attach(SERVO_PIN, 500, 2400);
  doorServo.write(SERVO_START_ANGLE);
  Serial.printf(
    "[Actuators] Servo initialized; buzzer uses LEDC channel %u%s\n",
    BUZZER_LEDC_CHANNEL,
    doorServo.attached() ? "" : " (servo attach failed)"
  );
}

void buzzer_command(JsonDocument &doc) {
  JsonVariant payload = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) payload = doc["payload"];
  bool enabled = payload["enabled"] | true;
  unsigned int duration = constrain(payload["duration_ms"] | 500, 0, 10000);
  unsigned int frequency = constrain(payload["frequency_hz"] | 2000, 100, 10000);

  if (alarmActive) return;

  if (!enabled || duration == 0) {
    actuators_stopBuzzer();
    return;
  }
  tone(BUZZER_PIN, frequency);
  buzzerStopAt = millis() + duration;
  buzzerStopPending = true;
}

void servo_command(JsonDocument &doc) {
  JsonVariant payload = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) payload = doc["payload"];
  int angle = constrain(payload["angle"] | SERVO_START_ANGLE, 0, 180);
  const char *action = payload["action"] | "";

  if (strcmp(action, "unlock") == 0) {
    unsigned long autoLockMs = payload["auto_lock_ms"] | 0UL;
    int lockAngle = constrain(payload["lock_angle"] | SERVO_LOCK_ANGLE, 0, 180);
    const char *reason = payload["tag_id"].isNull() ? "command" : "rfid";
    actuators_unlockDoor(angle, lockAngle, autoLockMs, reason);
    return;
  }

  actuators_lockDoor(angle);
}

void alarm_command(JsonDocument &doc) {
  JsonVariant payload = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) payload = doc["payload"];
  actuators_setAlarm(payload["active"] | true);
}

void actuators_loop() {
  unsigned long now = millis();

  if (doorLockPending && (long)(now - doorLockAt) >= 0) {
    actuators_lockDoor(scheduledLockAngle, "auto_lock");
  }

  if (alarmActive) {
    if ((long)(now - alarmToneChangeAt) >= 0) {
      alarmHighTone = !alarmHighTone;
      tone(BUZZER_PIN, alarmHighTone ? ALARM_TONE_HIGH_HZ : ALARM_TONE_LOW_HZ);
      alarmToneChangeAt = now + ALARM_TONE_STEP_MS;
    }
    return;
  }

  if (buzzerStopPending && (long)(now - buzzerStopAt) >= 0) {
    actuators_stopBuzzer();
  }
}

#endif
