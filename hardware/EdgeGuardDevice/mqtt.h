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

bool mqtt_publishPayload(
  String suffix,
  const char *payload,
  size_t size,
  bool retain = false
) {
  if (!mqttClient.connected()) return false;

  String topic = mqtt_topic(suffix);
  if (!payload || size == 0 || size >= MQTT_JSON_PAYLOAD_BYTES) {
    Serial.printf(
      "[MQTT] JSON payload is too large: %u bytes for %s (limit %u)\n",
      static_cast<unsigned int>(size),
      topic.c_str(),
      static_cast<unsigned int>(MQTT_JSON_PAYLOAD_BYTES - 1)
    );
    return false;
  }

  const size_t estimatedPacketBytes = 5 + 2 + topic.length() + size;
  if (estimatedPacketBytes > MQTT_PACKET_BUFFER_BYTES) {
    Serial.printf(
      "[MQTT] Packet is too large: about %u bytes for %s (buffer %u)\n",
      static_cast<unsigned int>(estimatedPacketBytes),
      topic.c_str(),
      static_cast<unsigned int>(MQTT_PACKET_BUFFER_BYTES)
    );
    return false;
  }

  bool published = mqttClient.publish(
    topic.c_str(),
    reinterpret_cast<const uint8_t *>(payload),
    size,
    retain
  );
  if (!published) {
    Serial.printf(
      "[MQTT] Publish failed for %s: topic=%u bytes, payload=%u bytes, state=%d\n",
      topic.c_str(),
      static_cast<unsigned int>(topic.length()),
      static_cast<unsigned int>(size),
      mqttClient.state()
    );
  }
  return published;
}

bool mqtt_publishJson(String suffix, JsonDocument &doc, bool retain = false) {
  size_t measuredSize = measureJson(doc);
  if (measuredSize == 0 || measuredSize >= MQTT_JSON_PAYLOAD_BYTES) return false;
  char payload[MQTT_JSON_PAYLOAD_BYTES];
  size_t size = serializeJson(doc, payload, sizeof(payload));
  if (size == 0 || size >= sizeof(payload)) return false;
  return mqtt_publishPayload(suffix, payload, size, retain);
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
  if (!mqttClient.setBufferSize(MQTT_PACKET_BUFFER_BYTES)) {
    Serial.printf(
      "[MQTT] Could not allocate %u-byte packet buffer\n",
      static_cast<unsigned int>(MQTT_PACKET_BUFFER_BYTES)
    );
  } else {
    Serial.printf(
      "[MQTT] Packet buffer set to %u bytes\n",
      static_cast<unsigned int>(MQTT_PACKET_BUFFER_BYTES)
    );
  }
  mqtt_startWifi();
}

void mqtt_loop() {
  mqtt_serviceWifi();
  mqtt_tryConnect();
  if (mqttClient.connected()) mqttClient.loop();
}

#endif
