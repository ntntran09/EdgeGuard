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
#include <math.h>
#include <string.h>

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
const size_t FOMO_FRAME_SAMPLE_COUNT =
  CAMERA_CHANGE_SAMPLE_WIDTH * CAMERA_CHANGE_SAMPLE_HEIGHT;
// Three bounding boxes plus the pipeline metadata can exceed 768 bytes. Keep
// this below PubSubClient's configured 1024-byte packet buffer.
const size_t FOMO_MQTT_PAYLOAD_BYTES = 896;
const size_t FOMO_ALERT_PAYLOAD_BYTES = 512;

struct FomoPublishMessage {
  uint32_t eventId;
  bool eventFrameCached;
  size_t length;
  char payload[FOMO_MQTT_PAYLOAD_BYTES];
};

struct FomoAlertMessage {
  size_t length;
  char payload[FOMO_ALERT_PAYLOAD_BYTES];
};

struct FomoRecognitionMessage {
  uint32_t eventId;
  bool verified;
  bool known;
  uint16_t strangerCount;
};

struct FomoFrameAnalysis {
  float changePercent;
  float meanBrightness;
  float stdDevContrast;
  float darkPixelPercent;
  float brightPixelPercent;
  float edgePercent;
};

struct FomoInferenceSummary {
  bool completed;
  uint16_t detectionCount;
  uint16_t peopleCount;
  uint16_t bagCount;
  uint16_t packageCount;
  float bestConfidence;
  char bestLabel[32];
};

enum FomoVisionState : uint8_t {
  FOMO_VISION_WARMUP = 0,
  FOMO_VISION_MONITORING,
  FOMO_VISION_WAITING_FACE_RESULT,
  FOMO_VISION_TRACKING_KNOWN_PERSON,
  FOMO_VISION_TRACKING_STRANGER,
  FOMO_VISION_TRACKING_OBJECT,
};

uint8_t *fomoSnapshotBuffer = nullptr;
uint8_t *fomoCapturedJpegBuffer = nullptr;
size_t fomoCapturedJpegCapacity = 0;
size_t fomoCapturedJpegLength = 0;
unsigned long fomoCapturedFrameAt = 0;
uint8_t fomoReferenceSamples[FOMO_FRAME_SAMPLE_COUNT] = {};
uint8_t fomoCurrentSamples[FOMO_FRAME_SAMPLE_COUNT] = {};
volatile bool fomoReady = false;
unsigned long lastFomoInitAttempt = 0;
unsigned long lastFomoAnalysisAt = 0;
volatile unsigned long lastFomoInferenceAt = 0;
volatile unsigned long lastFomoInferenceMs = 0;
volatile uint32_t fomoInferenceCount = 0;
volatile uint32_t fomoInferenceFailures = 0;
volatile uint16_t lastFomoDetectionCount = 0;
volatile uint16_t lastFomoPeopleCount = 0;
volatile uint16_t lastFomoBagCount = 0;
volatile uint16_t lastFomoPackageCount = 0;
volatile float lastFomoFrameChangePercent = 0.0f;
volatile FomoVisionState fomoVisionState = FOMO_VISION_WARMUP;
QueueHandle_t fomoPublishQueue = nullptr;
QueueHandle_t fomoAlertQueue = nullptr;
QueueHandle_t fomoRecognitionQueue = nullptr;
TaskHandle_t fomoTaskHandle = nullptr;
bool fomoReferenceValid = false;
bool fomoAiWasEnabled = false;
bool fomoVisionAlertSent = false;
bool fomoCameraBlocked = false;
uint8_t fomoWarmupFrames = 0;
uint8_t fomoBlockedSamples = 0;
uint32_t fomoVisionEventId = 0;
unsigned long fomoStableSince = 0;
char fomoTrackedObjectType[24] = "object";
float fomoTrackedConfidence = 0.0f;
bool fomoTrackedFrameCached = false;

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

const char *fomo_visionStateName(FomoVisionState state) {
  switch (state) {
    case FOMO_VISION_WARMUP: return "warmup";
    case FOMO_VISION_MONITORING: return "monitoring";
    case FOMO_VISION_WAITING_FACE_RESULT: return "waiting_face_result";
    case FOMO_VISION_TRACKING_KNOWN_PERSON: return "known_person";
    case FOMO_VISION_TRACKING_STRANGER: return "stranger";
    case FOMO_VISION_TRACKING_OBJECT: return "object";
    default: return "unknown";
  }
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
    "[FOMO] Ready: %ux%u model; frame gates %.0f%% initial / %.0f%% recheck\n",
    EI_CLASSIFIER_INPUT_WIDTH,
    EI_CLASSIFIER_INPUT_HEIGHT,
    CAMERA_FOMO_TRIGGER_CHANGE_PERCENT,
    CAMERA_FOMO_RECHECK_CHANGE_PERCENT
  );
  return true;
}

void fomo_setup() {
  fomo_allocateBuffer();

  fomoPublishQueue = xQueueCreate(1, sizeof(FomoPublishMessage));
  fomoAlertQueue = xQueueCreate(4, sizeof(FomoAlertMessage));
  fomoRecognitionQueue = xQueueCreate(4, sizeof(FomoRecognitionMessage));
  if (!fomoPublishQueue || !fomoAlertQueue || !fomoRecognitionQueue) {
    fomoReady = false;
    Serial.println("[FOMO] Could not create vision queues; inference task disabled");
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

  Serial.printf("[FOMO] Vision task pinned to Core %d\n", EDGEGUARD_FOMO_CORE);
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

bool fomo_copyCapturedJpeg(camera_fb_t *frame) {
  fomoCapturedJpegLength = 0;
  fomoCapturedFrameAt = 0;
  if (!frame || frame->format != PIXFORMAT_JPEG || !frame->buf || frame->len == 0) return false;

  if (frame->len > fomoCapturedJpegCapacity) {
    uint8_t *replacement = static_cast<uint8_t *>(heap_caps_malloc(
      frame->len,
      MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    ));
    if (!replacement) {
      Serial.printf(
        "[FOMO] Could not preserve %u-byte source JPEG\n",
        static_cast<unsigned int>(frame->len)
      );
      return false;
    }
    if (fomoCapturedJpegBuffer) heap_caps_free(fomoCapturedJpegBuffer);
    fomoCapturedJpegBuffer = replacement;
    fomoCapturedJpegCapacity = frame->len;
  }

  memcpy(fomoCapturedJpegBuffer, frame->buf, frame->len);
  fomoCapturedJpegLength = frame->len;
  fomoCapturedFrameAt = millis();
  return true;
}

bool fomo_cacheCurrentFrame(uint32_t eventId) {
  return camera_cacheEventFrame(
    fomoCapturedJpegBuffer,
    fomoCapturedJpegLength,
    eventId,
    fomoCapturedFrameAt
  );
}

bool fomo_captureRgbFrame(uint16_t &frameWidth, uint16_t &frameHeight) {
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
    return false;
  }

  frameWidth = frame->width;
  frameHeight = frame->height;
  bool dimensionsValid = frameWidth > 0 && frameHeight > 0
    && frameWidth <= FOMO_CAMERA_FRAME_WIDTH
    && frameHeight <= FOMO_CAMERA_FRAME_HEIGHT;
  bool converted = dimensionsValid && fmt2rgb888(
    frame->buf,
    frame->len,
    frame->format,
    fomoSnapshotBuffer
  );
  bool jpegPreserved = converted && fomo_copyCapturedJpeg(frame);
  camera_noteCapture(frame);
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
  if (!jpegPreserved) {
    Serial.println("[FOMO] Exact source JPEG is unavailable for this frame");
  }

  return true;
}

FomoFrameAnalysis fomo_analyzeFrame(uint16_t frameWidth, uint16_t frameHeight) {
  FomoFrameAnalysis analysis = {};
  uint32_t brightnessSum = 0;
  uint32_t brightnessSquareSum = 0;
  size_t darkPixels = 0;
  size_t brightPixels = 0;
  size_t changedPixels = 0;
  size_t edgePixels = 0;
  size_t edgeComparisons = 0;

  for (uint8_t row = 0; row < CAMERA_CHANGE_SAMPLE_HEIGHT; row++) {
    uint16_t sourceY = CAMERA_CHANGE_SAMPLE_HEIGHT <= 1
      ? 0
      : (static_cast<uint32_t>(row) * (frameHeight - 1)) / (CAMERA_CHANGE_SAMPLE_HEIGHT - 1);

    for (uint8_t column = 0; column < CAMERA_CHANGE_SAMPLE_WIDTH; column++) {
      uint16_t sourceX = CAMERA_CHANGE_SAMPLE_WIDTH <= 1
        ? 0
        : (static_cast<uint32_t>(column) * (frameWidth - 1)) / (CAMERA_CHANGE_SAMPLE_WIDTH - 1);
      size_t sourceIndex =
        (static_cast<size_t>(sourceY) * frameWidth + sourceX) * FOMO_CAMERA_BYTES_PER_PIXEL;
      uint8_t blue = fomoSnapshotBuffer[sourceIndex];
      uint8_t green = fomoSnapshotBuffer[sourceIndex + 1];
      uint8_t red = fomoSnapshotBuffer[sourceIndex + 2];
      uint8_t brightness = static_cast<uint8_t>(
        (77UL * red + 150UL * green + 29UL * blue) >> 8
      );
      size_t sampleIndex = static_cast<size_t>(row) * CAMERA_CHANGE_SAMPLE_WIDTH + column;
      fomoCurrentSamples[sampleIndex] = brightness;
      brightnessSum += brightness;
      brightnessSquareSum += static_cast<uint32_t>(brightness) * brightness;

      if (brightness <= CAMERA_BLOCKED_DARK_LUMA) darkPixels++;
      if (brightness >= CAMERA_BLOCKED_BRIGHT_LUMA) brightPixels++;
      if (fomoReferenceValid
          && abs(static_cast<int>(brightness) - static_cast<int>(fomoReferenceSamples[sampleIndex]))
            >= CAMERA_PIXEL_CHANGE_THRESHOLD) {
        changedPixels++;
      }

      bool isEdge = false;
      if (column > 0) {
        edgeComparisons++;
        isEdge = abs(static_cast<int>(brightness) - static_cast<int>(fomoCurrentSamples[sampleIndex - 1]))
          >= CAMERA_PIXEL_CHANGE_THRESHOLD;
      }
      if (row > 0) {
        edgeComparisons++;
        isEdge = isEdge || abs(
          static_cast<int>(brightness)
            - static_cast<int>(fomoCurrentSamples[sampleIndex - CAMERA_CHANGE_SAMPLE_WIDTH])
        ) >= CAMERA_PIXEL_CHANGE_THRESHOLD;
      }
      if (isEdge) edgePixels++;
    }
  }

  float sampleCount = static_cast<float>(FOMO_FRAME_SAMPLE_COUNT);
  analysis.meanBrightness = brightnessSum / sampleCount;
  float variance = brightnessSquareSum / sampleCount
    - analysis.meanBrightness * analysis.meanBrightness;
  analysis.stdDevContrast = sqrtf(variance > 0.0f ? variance : 0.0f);
  analysis.darkPixelPercent = darkPixels * 100.0f / sampleCount;
  analysis.brightPixelPercent = brightPixels * 100.0f / sampleCount;
  analysis.changePercent = fomoReferenceValid
    ? changedPixels * 100.0f / sampleCount
    : 0.0f;
  analysis.edgePercent = edgeComparisons > 0
    ? edgePixels * 100.0f / static_cast<float>(FOMO_FRAME_SAMPLE_COUNT)
    : 0.0f;
  lastFomoFrameChangePercent = analysis.changePercent;
  return analysis;
}

void fomo_useCurrentFrameAsReference() {
  memcpy(fomoReferenceSamples, fomoCurrentSamples, sizeof(fomoReferenceSamples));
  fomoReferenceValid = true;
}

bool fomo_isBlockedCandidate(const FomoFrameAnalysis &analysis) {
  bool extremeExposure = analysis.darkPixelPercent >= CAMERA_BLOCKED_EXTREME_PIXEL_PERCENT
    || analysis.brightPixelPercent >= CAMERA_BLOCKED_EXTREME_PIXEL_PERCENT;
  bool noVisualDetail = analysis.stdDevContrast <= CAMERA_BLOCKED_MAX_STDDEV
    && analysis.edgePercent <= CAMERA_BLOCKED_MAX_EDGE_PERCENT;
  return extremeExposure || noVisualDetail;
}

bool fomo_queueVisionAlert(
  const char *alertType,
  const char *objectType,
  uint32_t eventId,
  float changePercent,
  unsigned long stableMs,
  bool eventFrameCached,
  const FomoFrameAnalysis *analysis = nullptr
) {
  if (!fomoAlertQueue) return false;

  JsonDocument doc;
  doc["label"] = alertType;
  doc["alert_type"] = alertType;
  doc["object_type"] = objectType;
  doc["event_id"] = eventId;
  doc["frame_change_percent"] = changePercent;
  doc["stable_ms"] = stableMs;
  doc["confidence"] = strcmp(alertType, "camera_blocked") == 0 ? 0.0f : fomoTrackedConfidence;
  doc["vision_state"] = fomo_visionStateName(fomoVisionState);
  doc["uptime_ms"] = millis();
  doc["event_frame_cached"] = eventFrameCached;
  if (analysis) {
    doc["mean_brightness"] = analysis->meanBrightness;
    doc["contrast_stddev"] = analysis->stdDevContrast;
    doc["dark_pixel_percent"] = analysis->darkPixelPercent;
    doc["bright_pixel_percent"] = analysis->brightPixelPercent;
    doc["edge_percent"] = analysis->edgePercent;
  }

  FomoAlertMessage message = {};
  message.length = serializeJson(doc, message.payload, sizeof(message.payload));
  if (message.length == 0 || message.length >= sizeof(message.payload)) {
    Serial.println("[Vision] Alert JSON is too large");
    return false;
  }

  if (xQueueSend(fomoAlertQueue, &message, 0) != pdTRUE) {
    Serial.println("[Vision] Alert queue is full");
    return false;
  }
  Serial.printf("[Vision] Queued %s alert for event %lu\n", alertType, static_cast<unsigned long>(eventId));
  return true;
}

void fomo_resetVisionPipeline(bool resetBlockedState = true) {
  fomoVisionState = FOMO_VISION_WARMUP;
  fomoReferenceValid = false;
  fomoWarmupFrames = 0;
  fomoStableSince = 0;
  fomoVisionAlertSent = false;
  fomoTrackedConfidence = 0.0f;
  fomoTrackedFrameCached = false;
  strncpy(fomoTrackedObjectType, "object", sizeof(fomoTrackedObjectType));
  fomoTrackedObjectType[sizeof(fomoTrackedObjectType) - 1] = '\0';
  if (resetBlockedState) {
    fomoCameraBlocked = false;
    fomoBlockedSamples = 0;
  }
}

bool fomo_processBlockedState(const FomoFrameAnalysis &analysis) {
  if (fomo_isBlockedCandidate(analysis)) {
    if (fomoBlockedSamples < UINT8_MAX) fomoBlockedSamples++;
    if (fomoBlockedSamples >= CAMERA_BLOCKED_CONFIRM_SAMPLES) {
      if (!fomoCameraBlocked) {
        fomoCameraBlocked = true;
        uint32_t blockedEventId = ++fomoVisionEventId;
        bool eventFrameCached = fomo_cacheCurrentFrame(blockedEventId);
        fomo_queueVisionAlert(
          "camera_blocked",
          "camera",
          blockedEventId,
          analysis.changePercent,
          0,
          eventFrameCached,
          &analysis
        );
        Serial.printf(
          "[Vision] Camera blocked: mean %.1f, contrast %.1f, dark %.1f%%, bright %.1f%%\n",
          analysis.meanBrightness,
          analysis.stdDevContrast,
          analysis.darkPixelPercent,
          analysis.brightPixelPercent
        );
      }
      return true;
    }
    return false;
  }

  fomoBlockedSamples = 0;
  if (fomoCameraBlocked) {
    Serial.println("[Vision] Camera view recovered; rebuilding baseline");
    fomoCameraBlocked = false;
    fomo_resetVisionPipeline(false);
  }
  return false;
}

bool fomo_resizeForInference(uint16_t frameWidth, uint16_t frameHeight) {
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

void fomo_publishResult(
  const ei_impulse_result_t &result,
  const FomoInferenceSummary &summary,
  uint32_t eventId,
  float triggerChangePercent,
  bool eventFrameCached
) {
  if (!fomoPublishQueue || summary.detectionCount == 0) return;

  JsonDocument doc;
  JsonArray detections = doc["detections"].to<JsonArray>();
  size_t publishedCount = 0;
  bool publishPeopleOnly = summary.peopleCount > 0;

  for (uint32_t i = 0; i < result.bounding_boxes_count; i++) {
    const ei_impulse_result_bounding_box_t &box = result.bounding_boxes[i];
    if (box.value <= FOMO_MIN_CONFIDENCE) continue;
    if (publishPeopleOnly && strcmp(box.label, "human") != 0) continue;
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

  const char *publishedLabel = publishPeopleOnly ? "human" : summary.bestLabel;
  doc["label"] = fomo_eventLabel(publishedLabel);
  doc["model_label"] = publishedLabel;
  doc["object_type"] = fomo_objectType(publishedLabel);
  doc["confidence"] = summary.bestConfidence;
  doc["object_count"] = publishPeopleOnly ? summary.peopleCount : summary.detectionCount;
  doc["people_count"] = summary.peopleCount;
  doc["bag_count"] = publishPeopleOnly ? 0 : summary.bagCount;
  doc["package_count"] = publishPeopleOnly ? 0 : summary.packageCount;
  doc["event_id"] = eventId;
  doc["frame_change_percent"] = triggerChangePercent;
  doc["recheck_change_percent"] = CAMERA_FOMO_RECHECK_CHANGE_PERCENT;
  doc["stable_alert_ms"] = VISION_STABLE_ALERT_MS;
  doc["input_width"] = EI_CLASSIFIER_INPUT_WIDTH;
  doc["input_height"] = EI_CLASSIFIER_INPUT_HEIGHT;
  doc["inference_ms"] = static_cast<unsigned long>(lastFomoInferenceMs);
  doc["uptime_ms"] = static_cast<unsigned long>(lastFomoInferenceAt);
  doc["published_detection_count"] = publishedCount;
  doc["event_frame_cached"] = eventFrameCached;

  FomoPublishMessage message = {};
  message.eventId = eventId;
  message.eventFrameCached = eventFrameCached;
  message.length = serializeJson(doc, message.payload, sizeof(message.payload));
  if (message.length == 0 || message.length >= sizeof(message.payload)) {
    Serial.println("[FOMO] Result JSON is too large");
    return;
  }

  // Only the newest inference is relevant. A backend response carries event_id,
  // so a face result for an older frame cannot mutate the current state.
  xQueueOverwrite(fomoPublishQueue, &message);
}

FomoInferenceSummary fomo_runInference(
  unsigned long startedAt,
  uint16_t frameWidth,
  uint16_t frameHeight,
  uint32_t eventId,
  float triggerChangePercent,
  bool eventFrameCached
) {
  FomoInferenceSummary summary = {};
  if (!fomo_resizeForInference(frameWidth, frameHeight)) return summary;

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
    return summary;
  }

  summary.completed = true;
  float bestPersonConfidence = 0.0f;
  uint32_t inferenceNumber = ++fomoInferenceCount;
  Serial.printf(
    "[FOMO] #%lu event %lu after %.1f%% change, in %lu ms (DSP %d ms, NN %d ms)\n",
    static_cast<unsigned long>(inferenceNumber),
    static_cast<unsigned long>(eventId),
    triggerChangePercent,
    static_cast<unsigned long>(lastFomoInferenceMs),
    result.timing.dsp,
    result.timing.classification
  );

  for (uint32_t i = 0; i < result.bounding_boxes_count; i++) {
    const ei_impulse_result_bounding_box_t &box = result.bounding_boxes[i];
    if (box.value <= FOMO_MIN_CONFIDENCE) continue;

    summary.detectionCount++;
    if (strcmp(box.label, "human") == 0) {
      summary.peopleCount++;
      if (box.value > bestPersonConfidence) bestPersonConfidence = box.value;
    }
    else if (strcmp(box.label, "backpack") == 0) summary.bagCount++;
    else if (strcmp(box.label, "package") == 0) summary.packageCount++;

    if (box.value > summary.bestConfidence) {
      summary.bestConfidence = box.value;
      strncpy(summary.bestLabel, box.label, sizeof(summary.bestLabel));
      summary.bestLabel[sizeof(summary.bestLabel) - 1] = '\0';
    }

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

  // A mixed person/object frame belongs to the person-recognition pipeline.
  // Keep object boxes out of the published overlay and use the strongest
  // person confidence for the top-level event.
  if (summary.peopleCount > 0) {
    summary.bestConfidence = bestPersonConfidence;
    strncpy(summary.bestLabel, "human", sizeof(summary.bestLabel));
    summary.bestLabel[sizeof(summary.bestLabel) - 1] = '\0';
  }

  if (summary.detectionCount == 0) Serial.println("[FOMO]   no person, bag or package");

  lastFomoDetectionCount = summary.detectionCount;
  lastFomoPeopleCount = summary.peopleCount;
  lastFomoBagCount = summary.bagCount;
  lastFomoPackageCount = summary.packageCount;
  fomo_publishResult(result, summary, eventId, triggerChangePercent, eventFrameCached);
  return summary;
}

void fomo_classifyCurrentFrame(
  unsigned long now,
  uint16_t frameWidth,
  uint16_t frameHeight,
  const FomoFrameAnalysis &analysis
) {
  uint32_t eventId = ++fomoVisionEventId;
  fomoTrackedFrameCached = fomo_cacheCurrentFrame(eventId);
  FomoInferenceSummary summary = fomo_runInference(
    now,
    frameWidth,
    frameHeight,
    eventId,
    analysis.changePercent,
    fomoTrackedFrameCached
  );
  if (!summary.completed) {
    fomo_useCurrentFrameAsReference();
    fomoVisionState = FOMO_VISION_MONITORING;
    fomoStableSince = 0;
    fomoVisionAlertSent = false;
    fomoTrackedFrameCached = false;
    return;
  }

  fomo_useCurrentFrameAsReference();
  fomoVisionAlertSent = false;
  fomoStableSince = 0;
  fomoTrackedConfidence = summary.bestConfidence;

  if (summary.peopleCount > 0) {
    fomoVisionState = FOMO_VISION_WAITING_FACE_RESULT;
    strncpy(fomoTrackedObjectType, "person", sizeof(fomoTrackedObjectType));
    fomoTrackedObjectType[sizeof(fomoTrackedObjectType) - 1] = '\0';
    Serial.printf("[Vision] Event %lu waiting for familiar-person check\n", static_cast<unsigned long>(eventId));
    return;
  }

  if (summary.detectionCount > 0) {
    fomoVisionState = FOMO_VISION_TRACKING_OBJECT;
    fomoStableSince = lastFomoInferenceAt;
    strncpy(fomoTrackedObjectType, fomo_objectType(summary.bestLabel), sizeof(fomoTrackedObjectType));
    fomoTrackedObjectType[sizeof(fomoTrackedObjectType) - 1] = '\0';
    Serial.printf(
      "[Vision] Tracking %s; alert after %lu ms without %.0f%% change\n",
      fomoTrackedObjectType,
      VISION_STABLE_ALERT_MS,
      CAMERA_FOMO_RECHECK_CHANGE_PERCENT
    );
    return;
  }

  fomoVisionState = FOMO_VISION_MONITORING;
}

void fomo_applyRecognitionResults() {
  if (!fomoRecognitionQueue) return;

  FomoRecognitionMessage message = {};
  while (xQueueReceive(fomoRecognitionQueue, &message, 0) == pdTRUE) {
    if (fomoVisionState != FOMO_VISION_WAITING_FACE_RESULT
        || message.eventId != fomoVisionEventId) {
      Serial.printf("[Vision] Ignored stale face result for event %lu\n", static_cast<unsigned long>(message.eventId));
      continue;
    }
    if (!message.verified) {
      Serial.printf("[Vision] Familiar-person check unavailable for event %lu\n", static_cast<unsigned long>(message.eventId));
      continue;
    }

    if (message.known && message.strangerCount == 0) {
      fomoVisionState = FOMO_VISION_TRACKING_KNOWN_PERSON;
      fomoStableSince = 0;
      Serial.printf("[Vision] Event %lu is a familiar person\n", static_cast<unsigned long>(message.eventId));
    } else {
      fomoVisionState = FOMO_VISION_TRACKING_STRANGER;
      fomoStableSince = millis();
      Serial.printf(
        "[Vision] Event %lu has %u stranger(s); starting %lu ms timer\n",
        static_cast<unsigned long>(message.eventId),
        message.strangerCount,
        VISION_STABLE_ALERT_MS
      );
    }
  }
}

void fomo_maybeAlertForStableDetection(unsigned long now, const FomoFrameAnalysis &analysis) {
  if (fomoVisionAlertSent || fomoStableSince == 0
      || now - fomoStableSince < VISION_STABLE_ALERT_MS) {
    return;
  }

  const char *alertType = nullptr;
  if (fomoVisionState == FOMO_VISION_TRACKING_STRANGER) alertType = "stranger_detected";
  else if (fomoVisionState == FOMO_VISION_TRACKING_OBJECT) alertType = "object_left";
  if (!alertType) return;

  fomoVisionAlertSent = fomo_queueVisionAlert(
    alertType,
    fomoTrackedObjectType,
    fomoVisionEventId,
    analysis.changePercent,
    now - fomoStableSince,
    fomoTrackedFrameCached
  );
}

void fomo_processFrame(
  unsigned long now,
  uint16_t frameWidth,
  uint16_t frameHeight,
  const FomoFrameAnalysis &analysis
) {
  if (fomo_processBlockedState(analysis)) return;

  if (!fomoReferenceValid || fomoVisionState == FOMO_VISION_WARMUP) {
    fomo_useCurrentFrameAsReference();
    if (fomoWarmupFrames < CAMERA_BASELINE_WARMUP_FRAMES) fomoWarmupFrames++;
    if (fomoWarmupFrames >= CAMERA_BASELINE_WARMUP_FRAMES) {
      fomoVisionState = FOMO_VISION_MONITORING;
      Serial.println("[Vision] Camera baseline ready");
    }
    return;
  }

  float requiredChange = fomoVisionState == FOMO_VISION_MONITORING
    ? CAMERA_FOMO_TRIGGER_CHANGE_PERCENT
    : CAMERA_FOMO_RECHECK_CHANGE_PERCENT;

  bool shouldClassify = fomoVisionState == FOMO_VISION_MONITORING
    ? analysis.changePercent > requiredChange
    : analysis.changePercent >= requiredChange;

  // Once an object/stranger timer has started, finish that stability window
  // before another frame-change (even above the trigger) may run FOMO again.
  if (!fomoVisionAlertSent && fomoStableSince != 0) {
    if (now - fomoStableSince >= VISION_STABLE_ALERT_MS) {
      fomo_maybeAlertForStableDetection(now, analysis);
    }
    return;
  }

  if (shouldClassify) {
    fomo_classifyCurrentFrame(now, frameWidth, frameHeight, analysis);
    return;
  }

  fomo_maybeAlertForStableDetection(now, analysis);
}

void fomo_task(void *parameter) {
  (void)parameter;
  Serial.printf("[FOMO] Vision task running on Core %d\n", xPortGetCoreID());

  for (;;) {
    unsigned long now = millis();
    fomo_applyRecognitionResults();

    if (!deviceAiDetectionEnabled) {
      if (fomoAiWasEnabled) {
        fomo_resetVisionPipeline();
        fomoAiWasEnabled = false;
        Serial.println("[Vision] Pipeline reset because AI detection is disabled");
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    fomoAiWasEnabled = true;

    if (!fomoReady) {
      if (now - lastFomoInitAttempt >= FOMO_INIT_RETRY_MS) fomo_allocateBuffer();
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    if (!cameraReady || now - lastFomoAnalysisAt < CAMERA_ANALYSIS_INTERVAL_MS) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }

    lastFomoAnalysisAt = now;
    uint16_t frameWidth = 0;
    uint16_t frameHeight = 0;
    if (fomo_captureRgbFrame(frameWidth, frameHeight)) {
      FomoFrameAnalysis analysis = fomo_analyzeFrame(frameWidth, frameHeight);
      fomo_processFrame(now, frameWidth, frameHeight, analysis);
    }
    vTaskDelay(pdMS_TO_TICKS(1));
  }
}

void fomo_handleRecognitionResult(JsonDocument &doc) {
  if (!fomoRecognitionQueue) return;
  JsonVariant source = doc.as<JsonVariant>();
  if (doc["payload"].is<JsonObject>()) source = doc["payload"];
  if (source["event_id"].isNull()) {
    Serial.println("[Vision] Face result is missing event_id");
    return;
  }

  FomoRecognitionMessage message = {};
  message.eventId = source["event_id"].as<uint32_t>();
  message.verified = source["verified"].is<bool>() && source["verified"].as<bool>();
  message.known = source["known"].is<bool>() && source["known"].as<bool>();
  message.strangerCount = source["stranger_count"] | 0;
  if (xQueueSend(fomoRecognitionQueue, &message, 0) != pdTRUE) {
    Serial.println("[Vision] Face-result queue is full");
  }
}

void fomo_loop() {
  if (!mqttClient.connected()) return;

  FomoPublishMessage inferenceMessage = {};
  if (fomoPublishQueue
      && xQueueReceive(fomoPublishQueue, &inferenceMessage, 0) == pdTRUE) {
    if (inferenceMessage.eventFrameCached
        && !camera_publishEventFrame(inferenceMessage.eventId)) {
      if (!mqttClient.connected()) {
        // A partial streaming PUBLISH invalidates the socket. Retry the image
        // and inference together after reconnecting.
        xQueueOverwrite(fomoPublishQueue, &inferenceMessage);
        return;
      }
      // An oversized/busy MQTT frame can still be retrieved through HTTP.
      Serial.printf(
        "[FOMO] Event %lu will use HTTP image retrieval only\n",
        static_cast<unsigned long>(inferenceMessage.eventId)
      );
    }

    if (!mqttClient.publish(
          mqtt_topic("/model/inference").c_str(),
          reinterpret_cast<const uint8_t *>(inferenceMessage.payload),
          inferenceMessage.length,
          false
        )) {
      xQueueOverwrite(fomoPublishQueue, &inferenceMessage);
      Serial.println("[FOMO] MQTT result publish failed");
    }
  }

  FomoAlertMessage alertMessage = {};
  if (fomoAlertQueue
      && xQueueReceive(fomoAlertQueue, &alertMessage, 0) == pdTRUE
      && !mqttClient.publish(
        mqtt_topic("/telemetry/vision-alert").c_str(),
        reinterpret_cast<const uint8_t *>(alertMessage.payload),
        alertMessage.length,
        false
      )) {
    Serial.println("[Vision] MQTT alert publish failed");
  }
}

#endif
