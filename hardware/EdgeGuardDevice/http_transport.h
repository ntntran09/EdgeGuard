#ifndef EDGEGUARD_HTTP_TRANSPORT_H
#define EDGEGUARD_HTTP_TRANSPORT_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"

extern String device_getBackendHttpUrl();

int transportLastHttpStatus = 0;
unsigned long transportLastHttpSuccessAt = 0;
uint32_t transportHttpFailures = 0;

const char *transport_channelForSuffix(const String &suffix) {
  if (suffix == "/telemetry/environment") return "environment";
  if (suffix == "/telemetry/security") return "security";
  if (suffix == "/telemetry/power") return "power";
  if (suffix == "/telemetry/system") return "system";
  if (suffix == "/telemetry/nfc") return "nfc";
  if (suffix == "/telemetry/vision-alert") return "visionAlert";
  return nullptr;
}

bool transport_httpAvailable() {
  return WiFi.status() == WL_CONNECTED && device_getBackendHttpUrl().length() > 0;
}

bool transport_postTelemetry(
  const String &suffix,
  const char *payload,
  size_t payloadLength
) {
  const char *channel = transport_channelForSuffix(suffix);
  String backendUrl = device_getBackendHttpUrl();
  if (!channel || !payload || payloadLength == 0
      || WiFi.status() != WL_CONNECTED || backendUrl.length() == 0) {
    return false;
  }

  String requestBody;
  requestBody.reserve(payloadLength + 80);
  requestBody += "{\"channel\":\"";
  requestBody += channel;
  requestBody += "\",\"payload\":";
  requestBody.concat(payload, payloadLength);
  requestBody += '}';

  HTTPClient request;
  request.setConnectTimeout(TELEMETRY_HTTP_CONNECT_TIMEOUT_MS);
  request.setTimeout(TELEMETRY_HTTP_RESPONSE_TIMEOUT_MS);
  String endpoint = backendUrl + "/api/device/telemetry";
  if (!request.begin(endpoint)) {
    transportLastHttpStatus = 0;
    transportHttpFailures++;
    return false;
  }

  request.addHeader("Content-Type", "application/json");
  request.addHeader("X-EdgeGuard-Device-Id", MQTT_DEVICE_ID);
  int status = request.POST(
    reinterpret_cast<uint8_t *>(const_cast<char *>(requestBody.c_str())),
    requestBody.length()
  );
  request.end();
  transportLastHttpStatus = status;
  if (status >= 200 && status < 300) {
    transportLastHttpSuccessAt = millis();
    Serial.printf("[Transport] HTTP telemetry %s accepted (%d)\n", channel, status);
    return true;
  }

  transportHttpFailures++;
  Serial.printf(
    "[Transport] HTTP telemetry %s failed (%d); trying MQTT fallback\n",
    channel,
    status
  );
  return false;
}

bool transport_publishPayload(
  const String &suffix,
  const char *payload,
  size_t payloadLength,
  bool retain = false
) {
  if (transport_postTelemetry(suffix, payload, payloadLength)) return true;
  return mqtt_publishPayload(suffix, payload, payloadLength, retain);
}

bool transport_publishJson(String suffix, JsonDocument &doc, bool retain = false) {
  size_t measuredSize = measureJson(doc);
  if (measuredSize == 0 || measuredSize >= MQTT_JSON_PAYLOAD_BYTES) return false;
  char payload[MQTT_JSON_PAYLOAD_BYTES];
  size_t size = serializeJson(doc, payload, sizeof(payload));
  if (size == 0 || size >= sizeof(payload)) return false;
  return transport_publishPayload(suffix, payload, size, retain);
}

#endif
