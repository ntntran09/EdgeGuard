#ifndef EDGEGUARD_MQTT_H
#define EDGEGUARD_MQTT_H

#include "libs.h"
#include "config.h"

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

extern void device_handleCommand(String topic, String payload);

String mqtt_topic(String suffix) {
  return String(MQTT_TOPIC_BASE) + suffix;
}

void mqtt_wifiConnect() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("[WiFi] Connected, IP: ");
  Serial.println(WiFi.localIP());
}

void mqtt_publishJson(String suffix, JsonDocument &doc, bool retain = false) {
  char payload[512];
  size_t size = serializeJson(doc, payload);
  mqttClient.publish(mqtt_topic(suffix).c_str(), reinterpret_cast<const uint8_t *>(payload), size, retain);
}

void mqtt_publishStatus(const char *status, bool retain = true) {
  mqttClient.publish(mqtt_topic("/status").c_str(), status, retain);
}

void mqtt_subscribeTopics() {
  String commandTopic = mqtt_topic("/command/#");
  mqttClient.subscribe(commandTopic.c_str(), 0);
  Serial.print("[MQTT] Subscribed to ");
  Serial.println(commandTopic);
}

void mqtt_callback(char *topic, byte *message, unsigned int length) {
  String payload;

  for (unsigned int i = 0; i < length; i++) {
    payload += (char)message[i];
  }

  Serial.print("[MQTT] Message on ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(payload);

  device_handleCommand(String(topic), payload);
}

void mqtt_connect() {
  while (!mqttClient.connected()) {
    Serial.println("[MQTT] Connecting...");
    String clientId = "EdgeGuard-" + String(MQTT_DEVICE_ID) + "-" + String(random(0xffff), HEX);

    if (mqttClient.connect(clientId.c_str())) {
      Serial.println("[MQTT] Connected");
      mqtt_subscribeTopics();
      mqtt_publishStatus("online", true);
    } else {
      Serial.print("[MQTT] Failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(". Retrying in 5 seconds.");
      delay(5000);
    }
  }
}

void mqtt_setup() {
  mqtt_wifiConnect();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqtt_callback);
  mqttClient.setKeepAlive(90);
  mqttClient.setBufferSize(1024);
  mqtt_connect();
}

void mqtt_loop() {
  if (WiFi.status() != WL_CONNECTED) {
    mqtt_wifiConnect();
  }

  if (!mqttClient.connected()) {
    mqtt_connect();
  }

  mqttClient.loop();
}

#endif
