#ifndef EDGEGUARD_FOMO_H
#define EDGEGUARD_FOMO_H

#include "libs.h"
#include "config.h"
#include "mqtt.h"
#include "camera.h"

#include <ESP32-CAM_Detection_FOMO_inferencing.h>
#include "edge-impulse-sdk/dsp/image/image.hpp"
#include "img_converters.h"
#include "esp_heap_caps.h"
#include "esp_arduino_version.h"

extern volatile bool deviceAiDetectionEnabled;

#if ESP_ARDUINO_VERSION_MAJOR >= 3
#error "This Edge Impulse export conflicts with TensorFlow Lite Micro in ESP32 Arduino core 3.x; use core 2.0.17"
#endif

#if !defined(EI_CLASSIFIER_SENSOR) || EI_CLASSIFIER_SENSOR != EI_CLASSIFIER_SENSOR_CAMERA
#error "The Edge Impulse library must contain a camera model"
#endif

#if EI_CLASSIFIER_OBJECT_DETECTION != 1 || EI_HAS_FOMO != 1
#error "The Edge Impulse library must contain a FOMO object-detection model"
#endif

const uint16_t FOMO_CAMERA_FRAME_WIDTH = 320;
const uint16_t FOMO_CAMERA_FRAME_HEIGHT = 240;
const size_t FOMO_CAMERA_BYTES_PER_PIXEL = 3;
const size_t FOMO_CAMERA_BUFFER_BYTES =
  FOMO_CAMERA_FRAME_WIDTH * FOMO_CAMERA_FRAME_HEIGHT * FOMO_CAMERA_BYTES_PER_PIXEL;
const size_t FOMO_MQTT_PAYLOAD_BYTES = 768;

struct FomoPublishMessage {
  size_t length;
  char payload[FOMO_MQTT_PAYLOAD_BYTES];
};

uint8_t *fomoSnapshotBuffer = nullptr;
volatile bool fomoReady = false;
unsigned long lastFomoInitAttempt = 0;
unsigned long lastFomoStartedAt = 0;
volatile unsigned long lastFomoInferenceAt = 0;
volatile unsigned long lastFomoInferenceMs = 0;
volatile uint32_t fomoInferenceCount = 0;
volatile uint32_t fomoInferenceFailures = 0;
volatile uint16_t lastFomoDetectionCount = 0;
volatile uint16_t lastFomoPeopleCount = 0;
volatile uint16_t lastFomoBagCount = 0;
volatile uint16_t lastFomoPackageCount = 0;
QueueHandle_t fomoPublishQueue = nullptr;
TaskHandle_t fomoTaskHandle = nullptr;

void fomo_task(void *parameter);

void fomo_noteFailure() {
  fomoInferenceFailures++;
}

const char *fomo_objectType(const char *modelLabel) {
  if (strcmp(modelLabel, "human") == 0) return "person";
  if (strcmp(modelLabel, "backpack") == 0) return "bag";
  if (strcmp(modelLabel, "package") == 0) return "package";
  return modelLabel;
}

const char *fomo_eventLabel(const char *modelLabel) {
  return strcmp(modelLabel, "human") == 0 ? "person_detected" : "object_detected";
}

bool fomo_allocateBuffer() {
  lastFomoInitAttempt = millis();

  if (fomoSnapshotBuffer) {
    fomoReady = true;
    return true;
  }

  if (!psramFound()) {
    Serial.println("[FOMO] PSRAM is required; inference disabled");
    return false;
  }

  fomoSnapshotBuffer = static_cast<uint8_t *>(heap_caps_malloc(
    FOMO_CAMERA_BUFFER_BYTES,
    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
  ));
  if (!fomoSnapshotBuffer) {
    Serial.printf("[FOMO] Could not allocate %u-byte image buffer in PSRAM\n", FOMO_CAMERA_BUFFER_BYTES);
    return false;
  }

  fomoReady = true;
  Serial.printf(
    "[FOMO] Ready: %ux%u grayscale model, labels: human/person, backpack/bag, package\n",
    EI_CLASSIFIER_INPUT_WIDTH,
    EI_CLASSIFIER_INPUT_HEIGHT
  );
  return true;
}

void fomo_setup() {
  lastFomoStartedAt = millis();
  fomo_allocateBuffer();

  fomoPublishQueue = xQueueCreate(1, sizeof(FomoPublishMessage));
  if (!fomoPublishQueue) {
    fomoReady = false;
    Serial.println("[FOMO] Could not create result queue; inference task disabled");
    return;
  }

  BaseType_t created = xTaskCreatePinnedToCore(
    fomo_task,
    "edgeguard-fomo",
    EDGEGUARD_FOMO_TASK_STACK_BYTES,
    nullptr,
    EDGEGUARD_FOMO_TASK_PRIORITY,
    &fomoTaskHandle,
    EDGEGUARD_FOMO_CORE
  );
  if (created != pdPASS) {
    fomoTaskHandle = nullptr;
    fomoReady = false;
    Serial.println("[FOMO] Could not create inference task");
    return;
  }

  Serial.printf("[FOMO] Inference task pinned to Core %d\n", EDGEGUARD_FOMO_CORE);
}

static int fomo_getSignalData(size_t offset, size_t length, float *outPtr) {
  size_t pixelIndex = offset * FOMO_CAMERA_BYTES_PER_PIXEL;

  for (size_t outputIndex = 0; outputIndex < length; outputIndex++) {
    // fmt2rgb888() returns BGR byte order for this ESP32 camera driver.
    outPtr[outputIndex] =
      (fomoSnapshotBuffer[pixelIndex + 2] << 16) |
      (fomoSnapshotBuffer[pixelIndex + 1] << 8) |
      fomoSnapshotBuffer[pixelIndex];
    pixelIndex += FOMO_CAMERA_BYTES_PER_PIXEL;
  }

  return 0;
}

bool fomo_captureAndResize() {
  if (!camera_take()) {
    fomo_noteFailure();
    Serial.println("[FOMO] Camera is busy");
    return false;
  }

  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) {
    camera_give();
    uint8_t cameraFailures = camera_noteFailure();
    fomo_noteFailure();
    Serial.printf("[FOMO] Camera capture failed (%u/%u)\n", cameraFailures, CAMERA_CAPTURE_FAILURES_BEFORE_RESTART);
    // Camera recovery stays on the Core 0 control task. Deinitializing the
    // driver here could race camera_loop() or the HTTP server on the other core.
    return false;
  }

  uint16_t frameWidth = frame->width;
  uint16_t frameHeight = frame->height;
  bool dimensionsValid = frameWidth > 0 && frameHeight > 0
    && frameWidth <= FOMO_CAMERA_FRAME_WIDTH
    && frameHeight <= FOMO_CAMERA_FRAME_HEIGHT;
  bool converted = dimensionsValid && fmt2rgb888(
    frame->buf,
    frame->len,
    frame->format,
    fomoSnapshotBuffer
  );
  esp_camera_fb_return(frame);
  camera_give();

  if (!dimensionsValid) {
    fomo_noteFailure();
    Serial.printf("[FOMO] Unexpected camera frame size: %ux%u\n", frameWidth, frameHeight);
    return false;
  }
  if (!converted) {
    fomo_noteFailure();
    Serial.println("[FOMO] JPEG to RGB conversion failed");
    return false;
  }

  camera_clearFailures();
  int resizeResult = ei::image::processing::crop_and_interpolate_rgb888(
    fomoSnapshotBuffer,
    frameWidth,
    frameHeight,
    fomoSnapshotBuffer,
    EI_CLASSIFIER_INPUT_WIDTH,
    EI_CLASSIFIER_INPUT_HEIGHT
  );
  if (resizeResult != 0) {
    fomo_noteFailure();
    Serial.printf("[FOMO] Image resize failed (%d)\n", resizeResult);
    return false;
  }

  return true;
}

void fomo_publishResult(const ei_impulse_result_t &result, uint16_t detectionCount) {
  if (!fomoPublishQueue || detectionCount == 0) return;

  const ei_impulse_result_bounding_box_t *best = nullptr;
  uint16_t peopleCount = 0;
  uint16_t bagCount = 0;
  uint16_t packageCount = 0;

  JsonDocument doc;
  JsonArray detections = doc["detections"].to<JsonArray>();
  size_t publishedCount = 0;

  for (uint32_t i = 0; i < result.bounding_boxes_count; i++) {
    const ei_impulse_result_bounding_box_t &box = result.bounding_boxes[i];
    if (box.value <= FOMO_MIN_CONFIDENCE) continue;

    if (!best || box.value > best->value) best = &box;
    if (strcmp(box.label, "human") == 0) peopleCount++;
    else if (strcmp(box.label, "backpack") == 0) bagCount++;
    else if (strcmp(box.label, "package") == 0) packageCount++;

    if (publishedCount >= FOMO_MAX_PUBLISHED_DETECTIONS) continue;
    JsonObject item = detections.add<JsonObject>();
    item["label"] = box.label;
    item["type"] = fomo_objectType(box.label);
    item["confidence"] = box.value;
    item["x"] = box.x;
    item["y"] = box.y;
    item["width"] = box.width;
    item["height"] = box.height;
    item["centroid_x"] = box.x + (box.width / 2.0f);
    item["centroid_y"] = box.y + (box.height / 2.0f);
    publishedCount++;
  }

  if (!best) return;

  doc["label"] = fomo_eventLabel(best->label);
  doc["model_label"] = best->label;
  doc["object_type"] = fomo_objectType(best->label);
  doc["confidence"] = best->value;
  doc["object_count"] = detectionCount;
  doc["people_count"] = peopleCount;
  doc["bag_count"] = bagCount;
  doc["package_count"] = packageCount;
  doc["input_width"] = EI_CLASSIFIER_INPUT_WIDTH;
  doc["input_height"] = EI_CLASSIFIER_INPUT_HEIGHT;
  doc["inference_ms"] = static_cast<unsigned long>(lastFomoInferenceMs);
  doc["uptime_ms"] = static_cast<unsigned long>(lastFomoInferenceAt);
  doc["published_detection_count"] = publishedCount;

  FomoPublishMessage message = {};
  message.length = serializeJson(doc, message.payload, sizeof(message.payload));
  if (message.length == 0 || message.length >= sizeof(message.payload)) {
    Serial.println("[FOMO] Result JSON is too large");
    return;
  }

  // A length-one overwrite queue keeps only the newest detection if Core 0 is
  // temporarily occupied or MQTT is offline. PubSubClient remains Core-0-only.
  xQueueOverwrite(fomoPublishQueue, &message);
}

void fomo_runInference(unsigned long startedAt) {
  if (!fomo_captureAndResize()) return;

  ei::signal_t signal;
  signal.total_length = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT;
  signal.get_data = &fomo_getSignalData;

  ei_impulse_result_t result = {};
  EI_IMPULSE_ERROR error = run_classifier(&signal, &result, false);
  lastFomoInferenceAt = millis();
  lastFomoInferenceMs = lastFomoInferenceAt - startedAt;

  if (error != EI_IMPULSE_OK) {
    fomo_noteFailure();
    Serial.printf("[FOMO] Classifier failed (%d)\n", error);
    return;
  }

  uint32_t inferenceNumber = ++fomoInferenceCount;
  uint16_t detectionCount = 0;
  uint16_t peopleCount = 0;
  uint16_t bagCount = 0;
  uint16_t packageCount = 0;

  Serial.printf(
    "[FOMO] #%lu in %lu ms (DSP %d ms, NN %d ms)\n",
    static_cast<unsigned long>(inferenceNumber),
    static_cast<unsigned long>(lastFomoInferenceMs),
    result.timing.dsp,
    result.timing.classification
  );

  for (uint32_t i = 0; i < result.bounding_boxes_count; i++) {
    const ei_impulse_result_bounding_box_t &box = result.bounding_boxes[i];
    if (box.value <= FOMO_MIN_CONFIDENCE) continue;

    detectionCount++;
    if (strcmp(box.label, "human") == 0) peopleCount++;
    else if (strcmp(box.label, "backpack") == 0) bagCount++;
    else if (strcmp(box.label, "package") == 0) packageCount++;

    Serial.printf(
      "[FOMO]   %s/%s %.1f%% [x=%u y=%u w=%u h=%u centroid=(%.1f,%.1f)]\n",
      box.label,
      fomo_objectType(box.label),
      box.value * 100.0f,
      static_cast<unsigned int>(box.x),
      static_cast<unsigned int>(box.y),
      static_cast<unsigned int>(box.width),
      static_cast<unsigned int>(box.height),
      box.x + (box.width / 2.0f),
      box.y + (box.height / 2.0f)
    );
  }

  if (detectionCount == 0) Serial.println("[FOMO]   no person, bag or package");

  lastFomoDetectionCount = detectionCount;
  lastFomoPeopleCount = peopleCount;
  lastFomoBagCount = bagCount;
  lastFomoPackageCount = packageCount;
  fomo_publishResult(result, detectionCount);
}

void fomo_task(void *parameter) {
  (void)parameter;
  Serial.printf("[FOMO] Task running on Core %d\n", xPortGetCoreID());

  for (;;) {
    unsigned long now = millis();

    if (!deviceAiDetectionEnabled) {
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    if (!fomoReady) {
      if (now - lastFomoInitAttempt >= FOMO_INIT_RETRY_MS) fomo_allocateBuffer();
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    if (!cameraReady || now - lastFomoStartedAt < FOMO_INTERVAL_MS) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }

    // Schedule by start time. The task runs alone on Core 1, and the camera is
    // released before run_classifier() so Core 0 can resume HTTP streaming.
    lastFomoStartedAt = now;
    fomo_runInference(now);
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

void fomo_loop() {
  if (!fomoPublishQueue || !mqttClient.connected()) return;

  FomoPublishMessage message = {};
  if (xQueueReceive(fomoPublishQueue, &message, 0) != pdTRUE) return;

  if (!mqttClient.publish(
        mqtt_topic("/model/inference").c_str(),
        reinterpret_cast<const uint8_t *>(message.payload),
        message.length,
        false
      )) {
    Serial.println("[FOMO] MQTT result publish failed");
  }
}

#endif
