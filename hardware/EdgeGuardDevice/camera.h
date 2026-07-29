#ifndef EDGEGUARD_CAMERA_H
#define EDGEGUARD_CAMERA_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"
#include "esp_heap_caps.h"

extern volatile bool deviceCameraPublishEnabled;

volatile bool cameraReady = false;
unsigned long lastCameraInitAttempt = 0;
unsigned long lastCameraSuccessAt = 0;
size_t lastCameraFrameBytes = 0;
uint32_t cameraPublishFailures = 0;
uint8_t cameraCaptureFailures = 0;
portMUX_TYPE cameraFailureMux = portMUX_INITIALIZER_UNLOCKED;
SemaphoreHandle_t cameraMutex = nullptr;
SemaphoreHandle_t cameraEventFrameMutex = nullptr;
httpd_handle_t cameraControlHttpServer = nullptr;
httpd_handle_t cameraStreamHttpServer = nullptr;
volatile bool cameraHttpServersStopping = false;
String cameraBaseUrl;
String cameraCaptureUrl;
String cameraEventFrameUrl;
String cameraStreamUrl;
String cameraHealthUrl;
String cameraPublishedIp;
bool cameraEndpointsPublished = false;
unsigned long lastCameraEndpointAttempt = 0;
uint8_t *cameraEventFrameBuffer = nullptr;
size_t cameraEventFrameCapacity = 0;
size_t cameraEventFrameLength = 0;
uint32_t cameraEventFrameId = 0;
unsigned long cameraEventFrameCapturedAt = 0;

static const char *CAMERA_STREAM_CONTENT_TYPE =
  "multipart/x-mixed-replace;boundary=edgeguard-frame";
static const char *CAMERA_STREAM_BOUNDARY = "\r\n--edgeguard-frame\r\n";
static const char *CAMERA_STREAM_PART =
  "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

void camera_setNoCacheHeaders(httpd_req_t *request) {
  httpd_resp_set_hdr(request, "Cache-Control", "no-store, no-cache, must-revalidate");
  httpd_resp_set_hdr(request, "Pragma", "no-cache");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
}

bool camera_take(unsigned long timeoutMs = CAMERA_MUTEX_TIMEOUT_MS) {
  return cameraMutex
    && xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(timeoutMs)) == pdTRUE;
}

void camera_give() {
  if (cameraMutex) xSemaphoreGive(cameraMutex);
}

uint8_t camera_noteFailure() {
  portENTER_CRITICAL(&cameraFailureMux);
  if (cameraCaptureFailures < UINT8_MAX) cameraCaptureFailures++;
  uint8_t failures = cameraCaptureFailures;
  portEXIT_CRITICAL(&cameraFailureMux);
  return failures;
}

void camera_clearFailures() {
  portENTER_CRITICAL(&cameraFailureMux);
  cameraCaptureFailures = 0;
  portEXIT_CRITICAL(&cameraFailureMux);
}

uint8_t camera_getFailureCount() {
  portENTER_CRITICAL(&cameraFailureMux);
  uint8_t failures = cameraCaptureFailures;
  portEXIT_CRITICAL(&cameraFailureMux);
  return failures;
}

void camera_noteCapture(camera_fb_t *frame) {
  camera_clearFailures();
  lastCameraSuccessAt = millis();
  lastCameraFrameBytes = frame ? frame->len : 0;
}

bool camera_cacheEventFrame(
  const uint8_t *jpeg,
  size_t length,
  uint32_t eventId,
  unsigned long capturedAt
) {
  if (!jpeg || length == 0 || eventId == 0 || !cameraEventFrameMutex) return false;
  if (xSemaphoreTake(cameraEventFrameMutex, pdMS_TO_TICKS(CAMERA_MUTEX_TIMEOUT_MS)) != pdTRUE) {
    Serial.printf("[Camera Event] Cache busy for event %lu\n", static_cast<unsigned long>(eventId));
    return false;
  }

  if (length > cameraEventFrameCapacity) {
    uint8_t *replacement = static_cast<uint8_t *>(heap_caps_malloc(
      length,
      MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    ));
    if (!replacement) {
      xSemaphoreGive(cameraEventFrameMutex);
      Serial.printf("[Camera Event] Could not allocate %u bytes\n", static_cast<unsigned int>(length));
      return false;
    }
    if (cameraEventFrameBuffer) heap_caps_free(cameraEventFrameBuffer);
    cameraEventFrameBuffer = replacement;
    cameraEventFrameCapacity = length;
  }

  memcpy(cameraEventFrameBuffer, jpeg, length);
  cameraEventFrameLength = length;
  cameraEventFrameId = eventId;
  cameraEventFrameCapturedAt = capturedAt;
  xSemaphoreGive(cameraEventFrameMutex);
  Serial.printf(
    "[Camera Event] Cached exact frame for event %lu (%u bytes)\n",
    static_cast<unsigned long>(eventId),
    static_cast<unsigned int>(length)
  );
  return true;
}

esp_err_t camera_indexHandler(httpd_req_t *request) {
  static const char page[] =
    "<!doctype html><html><head><meta name=viewport content='width=device-width'>"
    "<title>EdgeGuard Camera</title></head><body style='margin:0;background:#071b12'>"
    "<img src='/stream' alt='EdgeGuard camera' style='display:block;width:100%;height:100vh;object-fit:contain'>"
    "</body></html>";
  httpd_resp_set_type(request, "text/html; charset=utf-8");
  camera_setNoCacheHeaders(request);
  return httpd_resp_send(request, page, HTTPD_RESP_USE_STRLEN);
}

esp_err_t camera_healthHandler(httpd_req_t *request) {
  char payload[320];
  snprintf(
    payload,
    sizeof(payload),
    "{\"ok\":true,\"device_id\":\"%s\",\"ip\":\"%s\",\"camera_ready\":%s,\"stream_enabled\":%s,\"last_frame_bytes\":%u}",
    MQTT_DEVICE_ID,
    WiFi.localIP().toString().c_str(),
    cameraReady ? "true" : "false",
    deviceCameraPublishEnabled ? "true" : "false",
    static_cast<unsigned int>(lastCameraFrameBytes)
  );
  httpd_resp_set_type(request, "application/json");
  camera_setNoCacheHeaders(request);
  return httpd_resp_send(request, payload, HTTPD_RESP_USE_STRLEN);
}

esp_err_t camera_captureHandler(httpd_req_t *request) {
  if (!cameraReady || !deviceCameraPublishEnabled || !camera_take()) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    return httpd_resp_send(request, "Camera is unavailable", HTTPD_RESP_USE_STRLEN);
  }

  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) {
    camera_give();
    camera_noteFailure();
    httpd_resp_set_status(request, "500 Internal Server Error");
    return httpd_resp_send(request, "Capture failed", HTTPD_RESP_USE_STRLEN);
  }

  camera_noteCapture(frame);
  httpd_resp_set_type(request, "image/jpeg");
  camera_setNoCacheHeaders(request);
  esp_err_t result = httpd_resp_send(
    request,
    reinterpret_cast<const char *>(frame->buf),
    frame->len
  );
  esp_camera_fb_return(frame);
  camera_give();
  return result;
}

esp_err_t camera_eventFrameHandler(httpd_req_t *request) {
  char query[64] = {};
  char eventIdText[24] = {};
  if (httpd_req_get_url_query_str(request, query, sizeof(query)) != ESP_OK
      || httpd_query_key_value(query, "event_id", eventIdText, sizeof(eventIdText)) != ESP_OK) {
    httpd_resp_set_status(request, "400 Bad Request");
    return httpd_resp_send(request, "event_id is required", HTTPD_RESP_USE_STRLEN);
  }

  char *end = nullptr;
  unsigned long requestedId = strtoul(eventIdText, &end, 10);
  if (!eventIdText[0] || !end || *end != '\0' || requestedId == 0 || requestedId > UINT32_MAX) {
    httpd_resp_set_status(request, "400 Bad Request");
    return httpd_resp_send(request, "event_id is invalid", HTTPD_RESP_USE_STRLEN);
  }
  if (!cameraEventFrameMutex
      || xSemaphoreTake(cameraEventFrameMutex, pdMS_TO_TICKS(CAMERA_MUTEX_TIMEOUT_MS)) != pdTRUE) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    return httpd_resp_send(request, "Event frame is busy", HTTPD_RESP_USE_STRLEN);
  }

  if (!cameraEventFrameBuffer
      || cameraEventFrameLength == 0
      || cameraEventFrameId != static_cast<uint32_t>(requestedId)) {
    xSemaphoreGive(cameraEventFrameMutex);
    httpd_resp_set_status(request, "404 Not Found");
    return httpd_resp_send(request, "Exact event frame is unavailable", HTTPD_RESP_USE_STRLEN);
  }

  char idHeader[24];
  char capturedAtHeader[24];
  snprintf(idHeader, sizeof(idHeader), "%lu", requestedId);
  snprintf(
    capturedAtHeader,
    sizeof(capturedAtHeader),
    "%lu",
    static_cast<unsigned long>(cameraEventFrameCapturedAt)
  );
  httpd_resp_set_type(request, "image/jpeg");
  camera_setNoCacheHeaders(request);
  httpd_resp_set_hdr(request, "X-EdgeGuard-Event-Id", idHeader);
  httpd_resp_set_hdr(request, "X-Frame-Uptime-Ms", capturedAtHeader);
  esp_err_t result = httpd_resp_send(
    request,
    reinterpret_cast<const char *>(cameraEventFrameBuffer),
    cameraEventFrameLength
  );
  xSemaphoreGive(cameraEventFrameMutex);
  return result;
}

esp_err_t camera_streamHandler(httpd_req_t *request) {
  if (!deviceCameraPublishEnabled) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    return httpd_resp_send(request, "Camera stream is disabled", HTTPD_RESP_USE_STRLEN);
  }

  httpd_resp_set_type(request, CAMERA_STREAM_CONTENT_TYPE);
  camera_setNoCacheHeaders(request);
  esp_err_t result = ESP_OK;
  char partHeader[96];

  while (result == ESP_OK
      && WiFi.status() == WL_CONNECTED
      && deviceCameraPublishEnabled
      && !cameraHttpServersStopping) {
    if (!cameraReady || !camera_take()) {
      delay(10);
      continue;
    }

    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) {
      camera_give();
      camera_noteFailure();
      result = ESP_FAIL;
      break;
    }

    camera_noteCapture(frame);
    size_t headerLength = snprintf(
      partHeader,
      sizeof(partHeader),
      CAMERA_STREAM_PART,
      static_cast<unsigned int>(frame->len)
    );
    result = httpd_resp_send_chunk(request, CAMERA_STREAM_BOUNDARY, strlen(CAMERA_STREAM_BOUNDARY));
    if (result == ESP_OK) result = httpd_resp_send_chunk(request, partHeader, headerLength);
    if (result == ESP_OK) {
      result = httpd_resp_send_chunk(
        request,
        reinterpret_cast<const char *>(frame->buf),
        frame->len
      );
    }

    esp_camera_fb_return(frame);
    camera_give();
    if (result == ESP_OK) delay(1);
  }

  return result;
}

void camera_refreshUrls() {
  if (WiFi.status() != WL_CONNECTED) return;
  String ip = WiFi.localIP().toString();
  if (ip == cameraPublishedIp && cameraBaseUrl.length() > 0) return;

  cameraPublishedIp = ip;
  cameraBaseUrl = "http://" + ip + ":" + String(CAMERA_CONTROL_HTTP_PORT);
  cameraCaptureUrl = cameraBaseUrl + "/capture";
  cameraEventFrameUrl = cameraBaseUrl + "/event-frame";
  cameraStreamUrl = "http://" + ip + ":" + String(CAMERA_STREAM_HTTP_PORT) + "/stream";
  cameraHealthUrl = cameraBaseUrl + "/health";
  cameraEndpointsPublished = false;
  lastCameraEndpointAttempt = 0;
}

void camera_startHttpServer() {
  if (!cameraReady || WiFi.status() != WL_CONNECTED) return;
  cameraHttpServersStopping = false;

  if (!cameraControlHttpServer) {
    httpd_config_t controlConfig = HTTPD_DEFAULT_CONFIG();
    controlConfig.core_id = EDGEGUARD_CONTROL_CORE;
    controlConfig.server_port = CAMERA_CONTROL_HTTP_PORT;
    controlConfig.ctrl_port = 32768;
    controlConfig.max_open_sockets = 4;
    controlConfig.lru_purge_enable = true;
    if (httpd_start(&cameraControlHttpServer, &controlConfig) != ESP_OK) {
      cameraControlHttpServer = nullptr;
      Serial.println("[Camera HTTP] Could not start control server");
      return;
    }

    httpd_uri_t healthUri = {};
    healthUri.uri = "/health";
    healthUri.method = HTTP_GET;
    healthUri.handler = camera_healthHandler;
    httpd_register_uri_handler(cameraControlHttpServer, &healthUri);

    httpd_uri_t captureUri = {};
    captureUri.uri = "/capture";
    captureUri.method = HTTP_GET;
    captureUri.handler = camera_captureHandler;
    httpd_register_uri_handler(cameraControlHttpServer, &captureUri);

    httpd_uri_t eventFrameUri = {};
    eventFrameUri.uri = "/event-frame";
    eventFrameUri.method = HTTP_GET;
    eventFrameUri.handler = camera_eventFrameHandler;
    httpd_register_uri_handler(cameraControlHttpServer, &eventFrameUri);

    Serial.printf(
      "[Camera HTTP] Control server on port %u: %s\n",
      CAMERA_CONTROL_HTTP_PORT,
      cameraEventFrameUrl.c_str()
    );
  }

  if (!cameraStreamHttpServer) {
    httpd_config_t streamConfig = HTTPD_DEFAULT_CONFIG();
    streamConfig.core_id = EDGEGUARD_CONTROL_CORE;
    streamConfig.server_port = CAMERA_STREAM_HTTP_PORT;
    streamConfig.ctrl_port = 32769;
    streamConfig.max_open_sockets = 2;
    streamConfig.lru_purge_enable = true;
    if (httpd_start(&cameraStreamHttpServer, &streamConfig) != ESP_OK) {
      cameraStreamHttpServer = nullptr;
      Serial.println("[Camera HTTP] Could not start stream server");
      return;
    }

    httpd_uri_t indexUri = {};
    indexUri.uri = "/";
    indexUri.method = HTTP_GET;
    indexUri.handler = camera_indexHandler;
    httpd_register_uri_handler(cameraStreamHttpServer, &indexUri);

    httpd_uri_t streamUri = {};
    streamUri.uri = "/stream";
    streamUri.method = HTTP_GET;
    streamUri.handler = camera_streamHandler;
    httpd_register_uri_handler(cameraStreamHttpServer, &streamUri);

    Serial.printf(
      "[Camera HTTP] Stream server on port %u: %s\n",
      CAMERA_STREAM_HTTP_PORT,
      cameraStreamUrl.c_str()
    );
  }
}

void camera_stopHttpServer() {
  cameraHttpServersStopping = true;
  if (cameraControlHttpServer) {
    httpd_stop(cameraControlHttpServer);
    cameraControlHttpServer = nullptr;
  }
  if (cameraStreamHttpServer) {
    httpd_stop(cameraStreamHttpServer);
    cameraStreamHttpServer = nullptr;
  }
  cameraHttpServersStopping = false;
  Serial.println("[Camera HTTP] Servers stopped");
}

bool camera_publishEndpoints() {
  if (!mqttClient.connected() || cameraCaptureUrl.length() == 0) return false;

  JsonDocument doc;
  doc["device_id"] = MQTT_DEVICE_ID;
  doc["ip"] = cameraPublishedIp;
  doc["port"] = CAMERA_CONTROL_HTTP_PORT;
  doc["stream_port"] = CAMERA_STREAM_HTTP_PORT;
  doc["base_url"] = cameraBaseUrl;
  doc["capture_url"] = cameraCaptureUrl;
  doc["event_frame_url"] = cameraEventFrameUrl;
  doc["stream_url"] = cameraStreamUrl;
  doc["health_url"] = cameraHealthUrl;
  doc["live_mode"] = "mjpeg";
  doc["uptime_ms"] = millis();
  bool published = mqtt_publishJson("/telemetry/endpoints", doc, true);
  if (published) {
    cameraEndpointsPublished = true;
    Serial.println("[Camera HTTP] Endpoints announced through MQTT");
  }
  return published;
}

void camera_setup() {
  lastCameraInitAttempt = millis();
  if (!cameraMutex) cameraMutex = xSemaphoreCreateMutex();
  if (!cameraEventFrameMutex) cameraEventFrameMutex = xSemaphoreCreateMutex();
  if (!cameraMutex || !cameraEventFrameMutex || !camera_take()) {
    Serial.println("[Camera] Could not acquire camera mutex");
    cameraReady = false;
    return;
  }

  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_7;
  c.ledc_timer = LEDC_TIMER_3;
  c.pin_d0 = CAM_PIN_D0; c.pin_d1 = CAM_PIN_D1; c.pin_d2 = CAM_PIN_D2; c.pin_d3 = CAM_PIN_D3;
  c.pin_d4 = CAM_PIN_D4; c.pin_d5 = CAM_PIN_D5; c.pin_d6 = CAM_PIN_D6; c.pin_d7 = CAM_PIN_D7;
  c.pin_xclk = CAM_PIN_XCLK; c.pin_pclk = CAM_PIN_PCLK; c.pin_vsync = CAM_PIN_VSYNC;
  c.pin_href = CAM_PIN_HREF; c.pin_sccb_sda = CAM_PIN_SIOD; c.pin_sccb_scl = CAM_PIN_SIOC;
  c.pin_pwdn = CAM_PIN_PWDN; c.pin_reset = CAM_PIN_RESET;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_QVGA;
  c.jpeg_quality = psramFound() ? 12 : 16;
  c.fb_count = psramFound() ? 2 : 1;
  c.grab_mode = CAMERA_GRAB_LATEST;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  esp_err_t result = esp_camera_init(&c);
  cameraReady = result == ESP_OK;
  if (cameraReady) camera_clearFailures();
  camera_give();
  Serial.printf("[Camera] %s (0x%x)\n", cameraReady ? "Ready" : "Initialization failed", result);
}

void camera_restartAfterCaptureFailures(unsigned long now) {
  camera_stopHttpServer();
  if (!camera_take()) return;
  Serial.println("[Camera] Too many capture failures; scheduling reinitialization");
  esp_camera_deinit();
  cameraReady = false;
  camera_clearFailures();
  lastCameraInitAttempt = now;
  camera_give();
}

void camera_loop() {
  unsigned long now = millis();
  if (!cameraReady) {
    if (now - lastCameraInitAttempt >= CAMERA_INIT_RETRY_MS) {
      Serial.println("[Camera] Retrying initialization");
      camera_setup();
    }
    return;
  }

  if (camera_getFailureCount() >= CAMERA_CAPTURE_FAILURES_BEFORE_RESTART) {
    camera_restartAfterCaptureFailures(now);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    cameraEndpointsPublished = false;
    camera_stopHttpServer();
    return;
  }

  camera_refreshUrls();
  camera_startHttpServer();
  if (!mqttClient.connected()) {
    cameraEndpointsPublished = false;
    return;
  }

  if (!cameraEndpointsPublished
      && (lastCameraEndpointAttempt == 0 || now - lastCameraEndpointAttempt >= CAMERA_ENDPOINT_RETRY_MS)) {
    lastCameraEndpointAttempt = now;
    camera_publishEndpoints();
  }
}

#endif
