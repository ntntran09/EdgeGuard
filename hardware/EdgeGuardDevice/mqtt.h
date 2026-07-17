#ifndef EDGEGUARD_MQTT_H
#define EDGEGUARD_MQTT_H

#include "libs.h"
#include "config.h"

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

extern void device_handleCommand(String topic, String payload);

const unsigned long WIFI_RETRY_MS = 10000;
const unsigned long MQTT_RETRY_MS = 5000;
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;
wl_status_t previousWifiStatus = WL_NO_SHIELD;

String mqtt_topic(String suffix) {
  return String(MQTT_TOPIC_BASE) + suffix;
}

void mqtt_startWifi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();
}

void mqtt_serviceWifi() {
  wl_status_t status = WiFi.status();

  if (status != previousWifiStatus) {
    if (status == WL_CONNECTED) {
      Serial.print("[WiFi] Connected, IP: ");
      Serial.println(WiFi.localIP());
      lastMqttAttempt = 0;  // allow an immediate MQTT attempt
    } else if (previousWifiStatus == WL_CONNECTED) {
      Serial.println("[WiFi] Disconnected");
    }
    previousWifiStatus = status;
  }

  if (status == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiAttempt >= WIFI_RETRY_MS) {
    Serial.println("[WiFi] Retrying connection");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttempt = now;
  }
}

bool mqtt_publishJson(String suffix, JsonDocument &doc, bool retain = false) {
  if (!mqttClient.connected()) return false;

  // FOMO summaries include up to three compact bounding boxes.
  char payload[768];
  size_t size = serializeJson(doc, payload, sizeof(payload));
  if (size == 0 || size >= sizeof(payload)) {
    Serial.println("[MQTT] JSON payload is too large");
    return false;
  }

  return mqttClient.publish(
    mqtt_topic(suffix).c_str(),
    reinterpret_cast<const uint8_t *>(payload),
    size,
    retain
  );
}

void mqtt_publishStatus(const char *status, bool retain = true) {
  if (mqttClient.connected()) {
    mqttClient.publish(mqtt_topic("/status").c_str(), status, retain);
  }
}

void mqtt_subscribeTopics() {
  String commandTopic = mqtt_topic("/command/#");
  mqttClient.subscribe(commandTopic.c_str(), 0);
  Serial.print("[MQTT] Subscribed to ");
  Serial.println(commandTopic);
}

void mqtt_callback(char *topic, byte *message, unsigned int length) {
  String payload;
  payload.reserve(length);

  for (unsigned int i = 0; i < length; i++) {
    payload += static_cast<char>(message[i]);
  }

  Serial.print("[MQTT] Message on ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(payload);

  device_handleCommand(String(topic), payload);
}

void mqtt_tryConnect() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;

  unsigned long now = millis();
  if (lastMqttAttempt != 0 && now - lastMqttAttempt < MQTT_RETRY_MS) return;
  lastMqttAttempt = now;

  Serial.println("[MQTT] Connecting...");
  String clientId = "EdgeGuard-" + String(MQTT_DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  String willTopic = mqtt_topic("/status");

  if (mqttClient.connect(clientId.c_str(), willTopic.c_str(), 0, true, "offline")) {
    Serial.println("[MQTT] Connected");
    mqtt_subscribeTopics();
    mqtt_publishStatus("online", true);
  } else {
    Serial.printf("[MQTT] Failed, rc=%d; retrying later\n", mqttClient.state());
  }
}

void mqtt_setup() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqtt_callback);
  mqttClient.setKeepAlive(90);
  mqttClient.setSocketTimeout(5);
  mqttClient.setBufferSize(1024);
  mqtt_startWifi();
}

void mqtt_loop() {
  mqtt_serviceWifi();
  mqtt_tryConnect();
  if (mqttClient.connected()) mqttClient.loop();
}

#endif
