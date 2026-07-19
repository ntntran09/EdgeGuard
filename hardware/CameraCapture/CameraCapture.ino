#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include "time.h"

// Standalone ESP32-CAM data-collection sketch. The firmware hosts its own UI,
// persists pending captures locally, and uploads directly to Supabase.
// Board: AI Thinker ESP32-CAM (ESP32 Arduino core 2.0.17 in this repository).
// GPIO4 drives the onboard flash LED, so the physical button uses GPIO13.
// GPIO13/15 overlap the microSD interface; do not use microSD with this sketch.

// ---- Edit these values before flashing -------------------------------------
const char *WIFI_SSID = "Ai đó";
const char *WIFI_PASSWORD = "012345678";

const char *CAMERA_DEVICE_ID = "camera_capture_001";
const char *DATASET_LABEL = "unlabeled"; // Example: person, empty, package.

// Use the publishable/legacy anon key only. Never put a Supabase secret or
// service-role key in firmware. Apply schema.sql so RLS permits this device's
// camera-captures prefix before flashing.
const char *SUPABASE_URL = "";
const char *SUPABASE_PUBLISHABLE_KEY = "";
const char *SUPABASE_IMAGE_BUCKET = "event-images";
// ---------------------------------------------------------------------------

const uint8_t CAPTURE_BUTTON_PIN = 13;
const uint8_t BUZZER_PIN = 15;
const uint8_t FLASH_LED_PIN = 4;
const uint8_t BUZZER_LEDC_CHANNEL = 2;
const uint16_t STREAM_HTTP_PORT = 81;
const framesize_t LIVE_FRAME_SIZE = FRAMESIZE_QVGA;
const framesize_t NORMAL_SNAPSHOT_FRAME_SIZE = FRAMESIZE_QVGA;
const framesize_t HIGH_SNAPSHOT_FRAME_SIZE = FRAMESIZE_UXGA; // OV2640 maximum: 1600x1200 (2 MP).
const uint8_t LIVE_JPEG_QUALITY = 16;
const uint8_t NORMAL_SNAPSHOT_JPEG_QUALITY = 24; // Usually close to 5 KB; scene complexity still affects JPEG size.
const uint8_t HIGH_SNAPSHOT_JPEG_QUALITY = 10;
const unsigned long BUTTON_DEBOUNCE_MS = 25;
const unsigned long DOUBLE_CLICK_WINDOW_MS = 500;
const unsigned long BUTTON_MODE_HOLD_MS = 2000;
const unsigned long BUTTON_BEEP_MS = 75;
const unsigned long BUTTON_BEEP_GAP_MS = 90;
const uint16_t BUTTON_BEEP_HZ = 2400;
const unsigned long SNAPSHOT_SETTLE_MS = 650;
const unsigned long FLASH_SNAPSHOT_SETTLE_MS = 750;
const uint8_t SNAPSHOT_WARMUP_FRAMES = 5;
const int8_t SNAPSHOT_AE_LEVEL = 2;
const int8_t SNAPSHOT_BRIGHTNESS = 1;
const uint8_t AUTO_WB_MODE = 0;
const uint8_t FLASH_WB_MODE = 1; // Daylight preset for the cool-white onboard LED.
const unsigned long WIFI_RETRY_MS = 10000;
const unsigned long SNAPSHOT_RETRY_MS = 10000;
const unsigned long SUPABASE_HTTP_TIMEOUT_MS = 20000;
const size_t MAX_CACHED_SNAPSHOT_BYTES = 768 * 1024;
const uint8_t MAX_IMAGE_HISTORY = 10;
const char *PENDING_IMAGE_PATH = "/pending.jpg";
const char *PENDING_METADATA_PATH = "/pending.json";

// AI Thinker ESP32-CAM pins.
#define CAM_PIN_PWDN 32
#define CAM_PIN_RESET -1
#define CAM_PIN_XCLK 0
#define CAM_PIN_SIOD 26
#define CAM_PIN_SIOC 27
#define CAM_PIN_D7 35
#define CAM_PIN_D6 34
#define CAM_PIN_D5 39
#define CAM_PIN_D4 36
#define CAM_PIN_D3 21
#define CAM_PIN_D2 19
#define CAM_PIN_D1 18
#define CAM_PIN_D0 5
#define CAM_PIN_VSYNC 25
#define CAM_PIN_HREF 23
#define CAM_PIN_PCLK 22

httpd_handle_t streamServer = nullptr;
SemaphoreHandle_t cameraMutex = nullptr;
SemaphoreHandle_t historyMutex = nullptr;
Preferences preferences;

bool cameraReady = false;
bool snapshotPending = false;
bool snapshotFlashRequested = false;
bool pendingSnapshotStorageUploaded = false;
bool pendingSnapshotDurablyCached = false;
bool wifiWasConnected = false;
String snapshotRequestSource = "gpio13_double_click";
String cameraPublishedIp;
String cameraBaseUrl;
String cameraCaptureUrl;
String cameraStreamUrl;
String cameraHealthUrl;
String imageHistoryJson = "[]";
String pendingSnapshotObjectPath;
String pendingSnapshotPublicUrl;
String lastUploadError;
bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
uint8_t buttonClickCount = 0;
bool buzzerActive = false;
unsigned long lastButtonChangeAt = 0;
unsigned long firstButtonClickAt = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastSnapshotAttempt = 0;
uint32_t snapshotSequence = 0;
uint32_t snapshotFailures = 0;
volatile uint32_t streamFrameCount = 0;

enum CaptureMode : uint8_t {
  CAPTURE_MODE_NORMAL_5K = 0,
  CAPTURE_MODE_HIGH_2MP = 1,
};

const char *captureModeName(CaptureMode mode) {
  return mode == CAPTURE_MODE_HIGH_2MP ? "high_2mp" : "normal_5k";
}

CaptureMode activeCaptureMode = CAPTURE_MODE_NORMAL_5K;
CaptureMode pendingSnapshotMode = CAPTURE_MODE_NORMAL_5K;
bool cameraHasPsram = false;
bool buttonPressActive = false;
bool buttonLongPressHandled = false;
bool buzzerToneOn = false;
uint8_t buzzerBeepsRemaining = 0;
unsigned long buttonPressedAt = 0;
unsigned long buzzerNextTransitionAt = 0;

uint8_t *pendingSnapshotJpeg = nullptr;
size_t pendingSnapshotBytes = 0;
uint16_t pendingSnapshotWidth = 0;
uint16_t pendingSnapshotHeight = 0;
uint32_t pendingSnapshotSequence = 0;
uint32_t pendingSnapshotCapturedUptimeMs = 0;
String pendingSnapshotCaptureId;
String pendingSnapshotCapturedAt;

struct CameraSettingsBackup {
  framesize_t frameSize;
  int quality;
  int aeLevel;
  int brightness;
  int wbMode;
  int awb;
  int awbGain;
  int aec;
  int agc;
};

void clearPendingSnapshotBuffer();
void restoreLiveCameraSettings(sensor_t *sensor, const CameraSettingsBackup &settings);

static const char *STREAM_CONTENT_TYPE =
  "multipart/x-mixed-replace;boundary=edgeguard-frame";
static const char *STREAM_BOUNDARY = "\r\n--edgeguard-frame\r\n";
static const char *STREAM_PART =
  "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static const char CAMERA_INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>EdgeGuard CameraCapture</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#071b12;color:#e8fff0;font-family:system-ui,sans-serif}
    main{max-width:820px;margin:auto;padding:20px}.live{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#000;border-radius:12px}
    h1,h2{margin:0 0 12px}p{line-height:1.5;color:#b7d9c4}code{color:#7cffad}.status{padding:10px 12px;border-radius:8px;background:#102b1e}
    #images{display:grid;gap:10px}.item{display:grid;grid-template-columns:132px 1fr;gap:12px;padding:10px;border:1px solid #28533a;border-radius:10px;background:#0d2418}
    .item img{width:132px;aspect-ratio:4/3;object-fit:cover;border-radius:7px;background:#000}.meta{min-width:0}.meta strong,.meta small{display:block}.meta small{margin-top:5px;color:#9fc6ad;overflow-wrap:anywhere}
    .empty{padding:24px;text-align:center;color:#9fc6ad;border:1px dashed #28533a;border-radius:10px}
    .recorder{margin:12px 0 16px;padding:12px;border:1px solid #28533a;border-radius:10px;background:#0d2418}.controls{display:flex;flex-wrap:wrap;gap:8px}
    button{min-height:44px;padding:9px 14px;color:#e8fff0;font:inherit;font-weight:700;background:#17633a;border:0;border-radius:8px}button:disabled{opacity:.45}.stop{background:#a52d35}.save{background:#24588a}
    .record-state{display:block;margin-top:9px;color:#9fc6ad}.record-state.is-recording{color:#ff8e95}.recording-preview{display:block;width:100%;max-height:420px;margin-top:12px;background:#000;border-radius:8px}.recording-preview[hidden]{display:none}
    #record-canvas{display:none}@media(max-width:520px){.item{grid-template-columns:96px 1fr}.item img{width:96px}.controls button{flex:1 1 100%}}
  </style>
</head>
<body><main>
  <h1>EdgeGuard CameraCapture</h1>
  <section class="recorder">
    <div class="controls">
      <button id="record-start" type="button">Quay video</button>
      <button id="record-stop" class="stop" type="button" disabled>Dừng</button>
      <button id="record-save" class="save" type="button" disabled>Lưu vào điện thoại</button>
    </div>
    <small id="record-state" class="record-state" aria-live="polite">Video được ghi trong trình duyệt điện thoại, tối đa 60 giây.</small>
    <canvas id="record-canvas" width="320" height="240"></canvas>
    <video id="recording-preview" class="recording-preview" controls playsinline hidden></video>
  </section>
  <img class="live" src="/stream" alt="Luồng trực tiếp ESP32-CAM">
  <p>Nhấn <code>GPIO13</code> để chụp, nhấn đúp để bật flash, giữ 2 giây để đổi giữa ảnh thường ~5 KB và 2 MP.</p>
  <p id="status" class="status">Đang đọc trạng thái thiết bị...</p>
  <h2>Ảnh đã gửi</h2>
  <section id="images"><div class="empty">Đang tải danh sách ảnh...</div></section>
</main>
<script>
const cacheKey='edgeguard-camera-images-v1';
const list=document.getElementById('images');
const statusBox=document.getElementById('status');
const liveImage=document.querySelector('.live');
const recordStart=document.getElementById('record-start');
const recordStop=document.getElementById('record-stop');
const recordSave=document.getElementById('record-save');
const recordState=document.getElementById('record-state');
const recordCanvas=document.getElementById('record-canvas');
const recordingPreview=document.getElementById('recording-preview');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const size=bytes=>bytes>=1048576?(bytes/1048576).toFixed(2)+' MB':bytes>=1024?(bytes/1024).toFixed(1)+' KB':bytes+' B';
const maximumRecordingMs=60000;
let mediaRecorder=null;let recordingStream=null;let recordingChunks=[];let recordedVideo=null;let recordedVideoUrl='';let recordedExtension='webm';let frameTimer=0;let durationTimer=0;let maximumTimer=0;let recordingStartedAt=0;
const setRecordState=(message,active=false)=>{recordState.textContent=message;recordState.classList.toggle('is-recording',active)};
const clearRecordingTimers=()=>{clearInterval(frameTimer);clearInterval(durationTimer);clearTimeout(maximumTimer);frameTimer=durationTimer=maximumTimer=0};
const stopRecordingTracks=()=>{if(recordingStream)for(const track of recordingStream.getTracks())track.stop();recordingStream=null};
const resetRecordedVideo=()=>{recordedVideo=null;recordSave.disabled=true;recordingPreview.hidden=true;recordingPreview.removeAttribute('src');recordingPreview.load();if(recordedVideoUrl)URL.revokeObjectURL(recordedVideoUrl);recordedVideoUrl=''};
const supportedRecordingFormat=()=>{
  const formats=[['video/mp4;codecs=avc1.42E01E','mp4'],['video/mp4','mp4'],['video/webm;codecs=vp8','webm'],['video/webm','webm']];
  if(typeof MediaRecorder==='undefined')return null;
  return formats.find(([mime])=>MediaRecorder.isTypeSupported(mime))||['','webm'];
};
const stopVideoRecording=()=>{
  if(!mediaRecorder||mediaRecorder.state==='inactive')return;
  recordStop.disabled=true;setRecordState('Đang hoàn tất video...');mediaRecorder.stop();
};
recordStart.addEventListener('click',()=>{
  try{
    const format=supportedRecordingFormat();
    if(!format)throw new Error('Trình duyệt này không hỗ trợ MediaRecorder. Hãy dùng Chrome hoặc Safari mới hơn.');
    if(typeof recordCanvas.captureStream!=='function')throw new Error('Trình duyệt này không thể ghi video từ luồng camera.');
    if(!liveImage.naturalWidth||!liveImage.naturalHeight)throw new Error('Luồng camera chưa sẵn sàng. Hãy đợi hình trực tiếp xuất hiện.');
    resetRecordedVideo();recordingChunks=[];recordedExtension=format[1];
    recordCanvas.width=liveImage.naturalWidth;recordCanvas.height=liveImage.naturalHeight;
    const context=recordCanvas.getContext('2d');
    const drawFrame=()=>{try{context.drawImage(liveImage,0,0,recordCanvas.width,recordCanvas.height)}catch{}};
    drawFrame();frameTimer=setInterval(drawFrame,100);recordingStream=recordCanvas.captureStream(10);
    const options={videoBitsPerSecond:1200000};if(format[0])options.mimeType=format[0];
    try{mediaRecorder=new MediaRecorder(recordingStream,options)}catch{mediaRecorder=new MediaRecorder(recordingStream)}
    const activeRecorder=mediaRecorder;
    activeRecorder.addEventListener('dataavailable',event=>{if(event.data&&event.data.size)recordingChunks.push(event.data)});
    activeRecorder.addEventListener('error',event=>{clearRecordingTimers();stopRecordingTracks();recordStart.disabled=false;recordStop.disabled=true;setRecordState('Không thể ghi video: '+(event.error?.message||'lỗi không xác định'))});
    activeRecorder.addEventListener('stop',()=>{
      clearRecordingTimers();stopRecordingTracks();recordStart.disabled=false;recordStop.disabled=true;
      const mime=activeRecorder.mimeType||format[0]||'video/webm';recordedExtension=mime.includes('mp4')?'mp4':'webm';recordedVideo=new Blob(recordingChunks,{type:mime});mediaRecorder=null;
      if(!recordedVideo.size){setRecordState('Không nhận được khung hình video. Hãy thử lại.');return}
      recordedVideoUrl=URL.createObjectURL(recordedVideo);recordingPreview.src=recordedVideoUrl;recordingPreview.hidden=false;recordSave.disabled=false;
      setRecordState('Video đã sẵn sàng ('+size(recordedVideo.size)+'). Nhấn “Lưu vào điện thoại”.');
    });
    activeRecorder.start(1000);recordingStartedAt=Date.now();recordStart.disabled=true;recordStop.disabled=false;
    setRecordState('Đang quay: 0 giây / 60 giây',true);
    durationTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-recordingStartedAt)/1000);setRecordState('Đang quay: '+seconds+' giây / 60 giây',true)},1000);
    maximumTimer=setTimeout(stopVideoRecording,maximumRecordingMs);
  }catch(error){clearRecordingTimers();stopRecordingTracks();mediaRecorder=null;recordStart.disabled=false;recordStop.disabled=true;setRecordState(error.message||String(error))}
});
recordStop.addEventListener('click',stopVideoRecording);
recordSave.addEventListener('click',async()=>{
  if(!recordedVideo)return;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');const filename='edgeguard-camera-'+stamp+'.'+recordedExtension;
  try{
    const file=new File([recordedVideo],filename,{type:recordedVideo.type});
    if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'EdgeGuard camera video'});setRecordState('Đã gửi video tới menu chia sẻ của điện thoại.');return}
  }catch(error){if(error?.name==='AbortError'){setRecordState('Đã hủy lưu/chia sẻ video.');return}}
  const link=document.createElement('a');link.href=recordedVideoUrl;link.download=filename;document.body.appendChild(link);link.click();link.remove();setRecordState('Video đã được gửi tới thư mục tải xuống của điện thoại.');
});
const imageDb='edgeguard-camera-cache-v1';
const openImageDb=()=>new Promise((resolve,reject)=>{if(!('indexedDB'in window)){resolve(null);return}const request=indexedDB.open(imageDb,1);request.onupgradeneeded=()=>request.result.createObjectStore('images');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
const readCachedImage=(db,url)=>new Promise(resolve=>{if(!db){resolve(null);return}const request=db.transaction('images').objectStore('images').get(url);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>resolve(null)});
const saveCachedImage=(db,url,blob)=>new Promise(resolve=>{if(!db){resolve();return}const request=db.transaction('images','readwrite').objectStore('images').put(blob,url);request.onsuccess=request.onerror=()=>resolve()});
const imageDbPromise=openImageDb().catch(()=>null);let renderGeneration=0;let activeObjectUrls=[];
const hydrateImages=async generation=>{const db=await imageDbPromise;for(const element of list.querySelectorAll('img[data-url]')){const url=element.dataset.url;try{let blob=await readCachedImage(db,url);if(!blob){const response=await fetch(url);if(!response.ok)throw new Error('image '+response.status);blob=await response.blob();await saveCachedImage(db,url,blob)}if(generation!==renderGeneration)return;const objectUrl=URL.createObjectURL(blob);activeObjectUrls.push(objectUrl);element.src=objectUrl}catch{element.src=url}}};
const render=(images,pending)=>{
  const generation=++renderGeneration;for(const url of activeObjectUrls)URL.revokeObjectURL(url);activeObjectUrls=[];
  if(!images.length&&!pending){list.innerHTML='<div class="empty">Chưa có ảnh nào.</div>';return}
  const rows=[];
  if(pending)rows.push(`<article class="item"><div class="empty">Cache</div><div class="meta"><strong>Đang chờ gửi Supabase</strong><small>${esc(pending.capture_id)}</small><small>${esc(pending.error||'Sẽ tự thử lại')}</small></div></article>`);
  for(const image of images)rows.push(`<a class="item" href="${esc(image.public_url)}" target="_blank" rel="noreferrer"><img loading="lazy" data-url="${esc(image.public_url)}" alt="Ảnh camera"><span class="meta"><strong>${esc(image.captured_at||image.uploaded_at||'Không rõ thời gian')}</strong><small>${esc(image.capture_mode||'camera')} · ${image.width||'?'}×${image.height||'?'} · ${size(Number(image.bytes)||0)}</small><small>${esc(image.capture_id)}</small></span></a>`);
  list.innerHTML=rows.join('');void hydrateImages(generation);
};
try{render(JSON.parse(localStorage.getItem(cacheKey)||'[]'),null)}catch{}
const refresh=async()=>{
  try{
    const [imagesResponse,healthResponse]=await Promise.all([fetch('/api/images',{cache:'no-store'}),fetch('/health',{cache:'no-store'})]);
    const data=await imagesResponse.json();const health=await healthResponse.json();const images=Array.isArray(data.images)?data.images:[];
    localStorage.setItem(cacheKey,JSON.stringify(images));render(images,data.pending||null);
    statusBox.textContent=`${health.capture_mode==='high_2mp'?'2 MP':'Thường ~5 KB'} · Supabase ${health.supabase_configured?'đã cấu hình':'chưa cấu hình'} · ${health.snapshot_pending?'có ảnh trong cache chờ gửi':'hàng đợi trống'}`;
  }catch(error){statusBox.textContent='Mất kết nối với camera; đang hiển thị cache trên trình duyệt.'}
};
refresh();setInterval(refresh,3000);
</script></body>
</html>
)HTML";

void setNoCacheHeaders(httpd_req_t *request) {
  httpd_resp_set_hdr(request, "Cache-Control", "no-store, no-cache, must-revalidate");
  httpd_resp_set_hdr(request, "Pragma", "no-cache");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
}

esp_err_t indexHandler(httpd_req_t *request) {
  httpd_resp_set_type(request, "text/html; charset=utf-8");
  setNoCacheHeaders(request);
  return httpd_resp_send(request, CAMERA_INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

esp_err_t healthHandler(httpd_req_t *request) {
  JsonDocument document;
  document["ok"] = true;
  document["device_id"] = CAMERA_DEVICE_ID;
  document["ip"] = WiFi.localIP().toString();
  document["stream_frames"] = streamFrameCount;
  document["snapshots"] = snapshotSequence;
  document["snapshot_failures"] = snapshotFailures;
  document["button_pin"] = CAPTURE_BUTTON_PIN;
  document["button_level"] = digitalRead(CAPTURE_BUTTON_PIN);
  document["capture_mode"] = captureModeName(activeCaptureMode);
  document["snapshot_pending"] = snapshotPending;
  document["snapshot_cached"] = pendingSnapshotDurablyCached;
  document["supabase_configured"] = String(SUPABASE_URL).startsWith("https://")
    && String(SUPABASE_URL).indexOf("your-project") < 0
    && strlen(SUPABASE_PUBLISHABLE_KEY) > 20;
  document["last_upload_error"] = lastUploadError;
  String payload;
  serializeJson(document, payload);
  httpd_resp_set_type(request, "application/json");
  setNoCacheHeaders(request);
  return httpd_resp_send(request, payload.c_str(), payload.length());
}

esp_err_t imagesHandler(httpd_req_t *request) {
  String history = "[]";
  if (historyMutex && xSemaphoreTake(historyMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    history = imageHistoryJson;
    xSemaphoreGive(historyMutex);
  }

  JsonDocument document;
  JsonArray images = document["images"].to<JsonArray>();
  JsonDocument storedHistory;
  if (!deserializeJson(storedHistory, history) && storedHistory.is<JsonArray>()) {
    for (JsonVariant item : storedHistory.as<JsonArray>()) images.add(item);
  }
  if (snapshotPending) {
    JsonObject pending = document["pending"].to<JsonObject>();
    pending["capture_id"] = pendingSnapshotCaptureId;
    pending["bytes"] = pendingSnapshotBytes;
    pending["cached"] = pendingSnapshotDurablyCached;
    pending["storage_uploaded"] = pendingSnapshotStorageUploaded;
    pending["error"] = lastUploadError;
  }

  String payload;
  serializeJson(document, payload);
  httpd_resp_set_type(request, "application/json");
  setNoCacheHeaders(request);
  return httpd_resp_send(request, payload.c_str(), payload.length());
}

esp_err_t captureHandler(httpd_req_t *request) {
  if (!cameraReady || !cameraMutex) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    return httpd_resp_send(request, "Camera is not ready", HTTPD_RESP_USE_STRLEN);
  }

  if (xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(1500)) != pdTRUE) {
    httpd_resp_set_status(request, "503 Service Unavailable");
    return httpd_resp_send(request, "Camera is busy", HTTPD_RESP_USE_STRLEN);
  }

  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) {
    xSemaphoreGive(cameraMutex);
    httpd_resp_set_status(request, "500 Internal Server Error");
    return httpd_resp_send(request, "Capture failed", HTTPD_RESP_USE_STRLEN);
  }

  httpd_resp_set_type(request, "image/jpeg");
  httpd_resp_set_hdr(request, "Content-Disposition", "inline; filename=capture.jpg");
  setNoCacheHeaders(request);
  esp_err_t result = httpd_resp_send(
    request,
    reinterpret_cast<const char *>(frame->buf),
    frame->len
  );
  esp_camera_fb_return(frame);
  xSemaphoreGive(cameraMutex);
  return result;
}

esp_err_t streamHandler(httpd_req_t *request) {
  httpd_resp_set_type(request, STREAM_CONTENT_TYPE);
  setNoCacheHeaders(request);

  esp_err_t result = ESP_OK;
  char partHeader[96];

  while (result == ESP_OK && WiFi.status() == WL_CONNECTED) {
    if (!cameraReady || !cameraMutex) {
      result = ESP_FAIL;
      break;
    }

    if (xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(1500)) != pdTRUE) {
      delay(10);
      continue;
    }

    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) {
      xSemaphoreGive(cameraMutex);
      result = ESP_FAIL;
      break;
    }

    size_t headerLength = snprintf(
      partHeader,
      sizeof(partHeader),
      STREAM_PART,
      static_cast<unsigned int>(frame->len)
    );

    result = httpd_resp_send_chunk(request, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (result == ESP_OK) {
      result = httpd_resp_send_chunk(request, partHeader, headerLength);
    }
    if (result == ESP_OK) {
      result = httpd_resp_send_chunk(
        request,
        reinterpret_cast<const char *>(frame->buf),
        frame->len
      );
    }

    esp_camera_fb_return(frame);
    xSemaphoreGive(cameraMutex);

    if (result == ESP_OK) {
      streamFrameCount++;
      delay(1);
    }
  }

  return result;
}

void refreshCameraEndpoints() {
  if (WiFi.status() != WL_CONNECTED) return;

  String ip = WiFi.localIP().toString();
  if (ip == cameraPublishedIp && cameraBaseUrl.length() > 0) return;

  cameraPublishedIp = ip;
  cameraBaseUrl = "http://" + ip + ":" + String(STREAM_HTTP_PORT);
  cameraCaptureUrl = cameraBaseUrl + "/capture";
  cameraStreamUrl = cameraBaseUrl + "/stream";
  cameraHealthUrl = cameraBaseUrl + "/health";
}

String supabaseBaseUrl() {
  String value = SUPABASE_URL;
  while (value.endsWith("/")) value.remove(value.length() - 1);
  return value;
}

bool supabaseConfigured() {
  String url = supabaseBaseUrl();
  String key = SUPABASE_PUBLISHABLE_KEY;
  return url.startsWith("https://")
    && url.indexOf("your-project") < 0
    && key.length() > 20
    && key.indexOf("your-supabase") < 0;
}

String buildSnapshotObjectPath() {
  char date[11] = "undated";
  struct tm timeInfo;
  if (getLocalTime(&timeInfo, 0)) strftime(date, sizeof(date), "%Y-%m-%d", &timeInfo);
  return String("camera-captures/") + CAMERA_DEVICE_ID + "/" + date + "/"
    + pendingSnapshotCaptureId + ".jpg";
}

String snapshotPublicUrl() {
  return supabaseBaseUrl() + "/storage/v1/object/public/" + SUPABASE_IMAGE_BUCKET
    + "/" + pendingSnapshotObjectPath;
}

void setUploadError(const String &message) {
  lastUploadError = message;
  if (lastUploadError.length() > 180) lastUploadError = lastUploadError.substring(0, 180);
  Serial.printf("[Supabase] %s\n", lastUploadError.c_str());
}

bool persistPendingMetadata() {
  JsonDocument document;
  document["capture_id"] = pendingSnapshotCaptureId;
  document["captured_at"] = pendingSnapshotCapturedAt;
  document["captured_uptime_ms"] = pendingSnapshotCapturedUptimeMs;
  document["sequence"] = pendingSnapshotSequence;
  document["width"] = pendingSnapshotWidth;
  document["height"] = pendingSnapshotHeight;
  document["bytes"] = pendingSnapshotBytes;
  document["capture_mode"] = captureModeName(pendingSnapshotMode);
  document["source"] = snapshotRequestSource;
  document["object_path"] = pendingSnapshotObjectPath;
  document["public_url"] = pendingSnapshotPublicUrl;
  document["storage_uploaded"] = pendingSnapshotStorageUploaded;

  File file = LittleFS.open(PENDING_METADATA_PATH, FILE_WRITE);
  if (!file) return false;
  size_t written = serializeJson(document, file);
  file.close();
  return written > 0;
}

bool cachePendingSnapshot() {
  if (!pendingSnapshotJpeg || pendingSnapshotBytes == 0) return false;
  if (pendingSnapshotBytes > MAX_CACHED_SNAPSHOT_BYTES) {
    setUploadError("Snapshot is too large for the configured LittleFS cache limit.");
    return false;
  }

  File image = LittleFS.open(PENDING_IMAGE_PATH, FILE_WRITE);
  if (!image) {
    setUploadError("Cannot open the LittleFS pending image cache.");
    return false;
  }
  size_t written = image.write(pendingSnapshotJpeg, pendingSnapshotBytes);
  image.close();
  if (written != pendingSnapshotBytes || !persistPendingMetadata()) {
    LittleFS.remove(PENDING_IMAGE_PATH);
    LittleFS.remove(PENDING_METADATA_PATH);
    setUploadError("Cannot persist the complete snapshot in LittleFS.");
    return false;
  }
  pendingSnapshotDurablyCached = true;
  Serial.printf("[Cache] Snapshot persisted to LittleFS (%u bytes)\n", static_cast<unsigned int>(written));
  return true;
}

bool restorePendingSnapshot() {
  if (!LittleFS.exists(PENDING_IMAGE_PATH) || !LittleFS.exists(PENDING_METADATA_PATH)) return false;
  File metadataFile = LittleFS.open(PENDING_METADATA_PATH, FILE_READ);
  JsonDocument document;
  DeserializationError error = deserializeJson(document, metadataFile);
  metadataFile.close();
  if (error) {
    setUploadError("Pending cache metadata is invalid.");
    return false;
  }

  File image = LittleFS.open(PENDING_IMAGE_PATH, FILE_READ);
  size_t bytes = image.size();
  if (bytes == 0 || bytes > MAX_CACHED_SNAPSHOT_BYTES) {
    image.close();
    setUploadError("Pending cached image has an invalid size.");
    return false;
  }
  pendingSnapshotJpeg = static_cast<uint8_t *>(ps_malloc(bytes));
  if (!pendingSnapshotJpeg || image.read(pendingSnapshotJpeg, bytes) != bytes) {
    image.close();
    if (pendingSnapshotJpeg) free(pendingSnapshotJpeg);
    pendingSnapshotJpeg = nullptr;
    setUploadError("Cannot restore the pending image from LittleFS.");
    return false;
  }
  image.close();

  pendingSnapshotBytes = bytes;
  pendingSnapshotCaptureId = document["capture_id"] | "";
  pendingSnapshotCapturedAt = document["captured_at"] | "";
  pendingSnapshotCapturedUptimeMs = document["captured_uptime_ms"] | 0;
  pendingSnapshotSequence = document["sequence"] | snapshotSequence + 1;
  pendingSnapshotWidth = document["width"] | 0;
  pendingSnapshotHeight = document["height"] | 0;
  snapshotRequestSource = document["source"] | "restored_cache";
  String mode = document["capture_mode"] | "normal_5k";
  pendingSnapshotMode = mode == "high_2mp" ? CAPTURE_MODE_HIGH_2MP : CAPTURE_MODE_NORMAL_5K;
  pendingSnapshotObjectPath = document["object_path"] | "";
  pendingSnapshotPublicUrl = document["public_url"] | "";
  pendingSnapshotStorageUploaded = document["storage_uploaded"] | false;
  snapshotPending = pendingSnapshotCaptureId.length() > 0;
  pendingSnapshotDurablyCached = snapshotPending;
  lastSnapshotAttempt = 0;
  if (!snapshotPending) {
    clearPendingSnapshotBuffer();
    return false;
  }
  Serial.printf("[Cache] Restored pending snapshot %s\n", pendingSnapshotCaptureId.c_str());
  return true;
}

void loadImageHistory() {
  String stored = preferences.getString("history", "[]");
  JsonDocument document;
  if (deserializeJson(document, stored) || !document.is<JsonArray>()) stored = "[]";
  if (historyMutex && xSemaphoreTake(historyMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    imageHistoryJson = stored;
    xSemaphoreGive(historyMutex);
  } else {
    imageHistoryJson = stored;
  }
}

void appendImageHistory() {
  JsonDocument oldDocument;
  deserializeJson(oldDocument, imageHistoryJson);
  JsonDocument nextDocument;
  JsonArray next = nextDocument.to<JsonArray>();
  JsonObject current = next.add<JsonObject>();
  current["capture_id"] = pendingSnapshotCaptureId;
  current["public_url"] = pendingSnapshotPublicUrl;
  current["object_path"] = pendingSnapshotObjectPath;
  current["captured_at"] = pendingSnapshotCapturedAt;
  current["uploaded_at"] = pendingSnapshotCapturedAt.length() ? pendingSnapshotCapturedAt : String(millis());
  current["capture_mode"] = captureModeName(pendingSnapshotMode);
  current["source"] = snapshotRequestSource;
  current["width"] = pendingSnapshotWidth;
  current["height"] = pendingSnapshotHeight;
  current["bytes"] = pendingSnapshotBytes;

  uint8_t retained = 1;
  if (oldDocument.is<JsonArray>()) {
    for (JsonVariant item : oldDocument.as<JsonArray>()) {
      if (retained >= MAX_IMAGE_HISTORY) break;
      const char *existingCaptureId = item["capture_id"] | "";
      if (pendingSnapshotCaptureId == existingCaptureId) continue;
      next.add(item);
      retained++;
    }
  }

  String serialized;
  serializeJson(nextDocument, serialized);
  if (historyMutex && xSemaphoreTake(historyMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
    imageHistoryJson = serialized;
    xSemaphoreGive(historyMutex);
  } else {
    imageHistoryJson = serialized;
  }
  preferences.putString("history", serialized);
}

bool uploadPendingSnapshotToStorage() {
  if (pendingSnapshotStorageUploaded) return true;
  WiFiClientSecure secureClient;
  // The firmware uses a public-scoped key and a public bucket. For production,
  // replace setInsecure() with the CA certificate used by your Supabase domain.
  secureClient.setInsecure();
  HTTPClient http;
  String url = supabaseBaseUrl() + "/storage/v1/object/" + SUPABASE_IMAGE_BUCKET
    + "/" + pendingSnapshotObjectPath;
  if (!http.begin(secureClient, url)) {
    setUploadError("Cannot initialize the Supabase Storage request.");
    return false;
  }
  http.setTimeout(SUPABASE_HTTP_TIMEOUT_MS);
  http.addHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_PUBLISHABLE_KEY);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("x-upsert", "false");
  int status = http.POST(pendingSnapshotJpeg, pendingSnapshotBytes);
  String response = status >= 200 && status < 300 ? "" : http.getString();
  http.end();
  bool duplicate = status == HTTP_CODE_CONFLICT
    || (status == HTTP_CODE_BAD_REQUEST && response.indexOf("Duplicate") >= 0);
  if ((status < 200 || status >= 300) && !duplicate) {
    setUploadError("Storage HTTP " + String(status) + ": " + response);
    return false;
  }

  pendingSnapshotStorageUploaded = true;
  pendingSnapshotPublicUrl = snapshotPublicUrl();
  persistPendingMetadata();
  Serial.printf("[Supabase] Storage uploaded: %s\n", pendingSnapshotObjectPath.c_str());
  return true;
}

bool upsertPendingSnapshotReference() {
  JsonDocument document;
  document["capture_id"] = pendingSnapshotCaptureId;
  document["device_id"] = CAMERA_DEVICE_ID;
  document["storage_mode"] = "supabase_storage";
  document["storage_bucket"] = SUPABASE_IMAGE_BUCKET;
  document["storage_path"] = pendingSnapshotObjectPath;
  document["public_url"] = pendingSnapshotPublicUrl;
  document["mime_type"] = "image/jpeg";
  document["image_size_bytes"] = pendingSnapshotBytes;
  JsonObject metadata = document["metadata"].to<JsonObject>();
  metadata["collector"] = "camera_capture_firmware";
  metadata["dataset_label"] = DATASET_LABEL;
  metadata["capture_mode"] = captureModeName(pendingSnapshotMode);
  metadata["source"] = snapshotRequestSource;
  metadata["width"] = pendingSnapshotWidth;
  metadata["height"] = pendingSnapshotHeight;
  metadata["captured_at"] = pendingSnapshotCapturedAt;
  String payload;
  serializeJson(document, payload);

  WiFiClientSecure secureClient;
  secureClient.setInsecure();
  HTTPClient http;
  String url = supabaseBaseUrl()
    + "/rest/v1/event_images?on_conflict=device_id,capture_id";
  if (!http.begin(secureClient, url)) {
    setUploadError("Cannot initialize the Supabase Data API request.");
    return false;
  }
  http.setTimeout(SUPABASE_HTTP_TIMEOUT_MS);
  http.addHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_PUBLISHABLE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");
  int status = http.POST(payload);
  String response = status >= 200 && status < 300 ? "" : http.getString();
  http.end();
  if (status < 200 || status >= 300) {
    setUploadError("Data API HTTP " + String(status) + ": " + response);
    return false;
  }

  Serial.printf("[Supabase] Metadata upserted for %s\n", pendingSnapshotCaptureId.c_str());
  return true;
}

void startCameraWebServer() {
  if (streamServer || !cameraReady || WiFi.status() != WL_CONNECTED) return;

  httpd_config_t serverConfig = HTTPD_DEFAULT_CONFIG();
  serverConfig.server_port = STREAM_HTTP_PORT;
  serverConfig.max_open_sockets = 4;
  serverConfig.lru_purge_enable = true;

  if (httpd_start(&streamServer, &serverConfig) != ESP_OK) {
    streamServer = nullptr;
    Serial.println("[HTTP] Could not start camera server");
    return;
  }

  httpd_uri_t indexUri = {};
  indexUri.uri = "/";
  indexUri.method = HTTP_GET;
  indexUri.handler = indexHandler;
  httpd_register_uri_handler(streamServer, &indexUri);

  httpd_uri_t healthUri = {};
  healthUri.uri = "/health";
  healthUri.method = HTTP_GET;
  healthUri.handler = healthHandler;
  httpd_register_uri_handler(streamServer, &healthUri);

  httpd_uri_t imagesUri = {};
  imagesUri.uri = "/api/images";
  imagesUri.method = HTTP_GET;
  imagesUri.handler = imagesHandler;
  httpd_register_uri_handler(streamServer, &imagesUri);

  httpd_uri_t captureUri = {};
  captureUri.uri = "/capture";
  captureUri.method = HTTP_GET;
  captureUri.handler = captureHandler;
  httpd_register_uri_handler(streamServer, &captureUri);

  httpd_uri_t streamUri = {};
  streamUri.uri = "/stream";
  streamUri.method = HTTP_GET;
  streamUri.handler = streamHandler;
  httpd_register_uri_handler(streamServer, &streamUri);

  refreshCameraEndpoints();
  Serial.printf("[HTTP] Camera page: http://%s:%u/\n", WiFi.localIP().toString().c_str(), STREAM_HTTP_PORT);
  Serial.printf("[HTTP] JPEG capture: %s\n", cameraCaptureUrl.c_str());
  Serial.printf("[HTTP] MJPEG stream: http://%s:%u/stream\n", WiFi.localIP().toString().c_str(), STREAM_HTTP_PORT);
}

void stopCameraWebServer() {
  if (!streamServer) return;

  httpd_stop(streamServer);
  streamServer = nullptr;
  Serial.println("[HTTP] Camera server stopped");
}

bool setupCamera() {
  bool hasPsram = psramFound();
  cameraHasPsram = hasPsram;
  camera_config_t cameraConfig = {};
  cameraConfig.ledc_channel = LEDC_CHANNEL_0;
  cameraConfig.ledc_timer = LEDC_TIMER_0;
  cameraConfig.pin_d0 = CAM_PIN_D0;
  cameraConfig.pin_d1 = CAM_PIN_D1;
  cameraConfig.pin_d2 = CAM_PIN_D2;
  cameraConfig.pin_d3 = CAM_PIN_D3;
  cameraConfig.pin_d4 = CAM_PIN_D4;
  cameraConfig.pin_d5 = CAM_PIN_D5;
  cameraConfig.pin_d6 = CAM_PIN_D6;
  cameraConfig.pin_d7 = CAM_PIN_D7;
  cameraConfig.pin_xclk = CAM_PIN_XCLK;
  cameraConfig.pin_pclk = CAM_PIN_PCLK;
  cameraConfig.pin_vsync = CAM_PIN_VSYNC;
  cameraConfig.pin_href = CAM_PIN_HREF;
  cameraConfig.pin_sccb_sda = CAM_PIN_SIOD;
  cameraConfig.pin_sccb_scl = CAM_PIN_SIOC;
  cameraConfig.pin_pwdn = CAM_PIN_PWDN;
  cameraConfig.pin_reset = CAM_PIN_RESET;
  cameraConfig.xclk_freq_hz = 20000000;
  cameraConfig.pixel_format = PIXFORMAT_JPEG;
  // Allocate PSRAM buffers for the largest snapshot first. The sensor is reduced
  // to QVGA after initialization, so live frames stay small without preventing
  // a later 1600x1200 capture.
  cameraConfig.frame_size = hasPsram ? HIGH_SNAPSHOT_FRAME_SIZE : FRAMESIZE_QQVGA;
  cameraConfig.jpeg_quality = hasPsram ? HIGH_SNAPSHOT_JPEG_QUALITY : LIVE_JPEG_QUALITY;
  cameraConfig.fb_count = hasPsram ? 2 : 1;
  cameraConfig.grab_mode = CAMERA_GRAB_LATEST;
  cameraConfig.fb_location = hasPsram ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;

  esp_err_t result = esp_camera_init(&cameraConfig);
  cameraReady = result == ESP_OK;
  if (cameraReady && hasPsram) {
    sensor_t *sensor = esp_camera_sensor_get();
    if (sensor) {
      sensor->set_framesize(sensor, LIVE_FRAME_SIZE);
      sensor->set_quality(sensor, LIVE_JPEG_QUALITY);
    }
  }

  Serial.printf(
    "[Camera] %s (0x%x), PSRAM: %s, live: %s, snapshot: %s\n",
    cameraReady ? "ready" : "failed",
    result,
    hasPsram ? "yes" : "no",
    hasPsram ? "320x240" : "160x120",
    hasPsram ? "normal ~5 KB / 1600x1200 2 MP" : "160x120 normal only"
  );
  return cameraReady;
}

void serviceWifi() {
  wl_status_t status = WiFi.status();

  if (status == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      lastWifiAttempt = 0;
      Serial.printf(
        "[WiFi] Connected, IP: %s, RSSI: %d dBm\n",
        WiFi.localIP().toString().c_str(),
        WiFi.RSSI()
      );
    }

    startCameraWebServer();
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    Serial.printf("[WiFi] Disconnected, status: %d\n", static_cast<int>(status));
    stopCameraWebServer();
  }

  unsigned long now = millis();
  if (lastWifiAttempt != 0 && now - lastWifiAttempt < WIFI_RETRY_MS) return;
  lastWifiAttempt = now;

  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setFlash(bool enabled) {
  digitalWrite(FLASH_LED_PIN, enabled ? HIGH : LOW);
}

void playButtonBeeps(uint8_t count) {
  if (count == 0) return;
  ledcWriteTone(BUZZER_LEDC_CHANNEL, BUTTON_BEEP_HZ);
  buzzerActive = true;
  buzzerToneOn = true;
  buzzerBeepsRemaining = count - 1;
  buzzerNextTransitionAt = millis() + BUTTON_BEEP_MS;
}

void serviceBuzzer() {
  unsigned long now = millis();
  if (!buzzerActive || static_cast<long>(now - buzzerNextTransitionAt) < 0) return;

  if (buzzerToneOn) {
    ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);
    buzzerToneOn = false;
    if (buzzerBeepsRemaining == 0) {
      buzzerActive = false;
      return;
    }
    buzzerNextTransitionAt = now + BUTTON_BEEP_GAP_MS;
    return;
  }

  ledcWriteTone(BUZZER_LEDC_CHANNEL, BUTTON_BEEP_HZ);
  buzzerToneOn = true;
  buzzerBeepsRemaining--;
  buzzerNextTransitionAt = now + BUTTON_BEEP_MS;
}

bool queueSnapshot(const char *source, bool useFlash) {
  if (snapshotPending) {
    Serial.println("[Snapshot] A capture is already pending; new button action ignored");
    return false;
  }

  snapshotPending = true;
  snapshotFlashRequested = useFlash;
  pendingSnapshotMode = activeCaptureMode;
  snapshotRequestSource = source;
  lastSnapshotAttempt = 0;
  Serial.printf(
    "[Snapshot] Queued from %s in %s mode%s\n",
    source,
    captureModeName(pendingSnapshotMode),
    useFlash ? " with flash" : ""
  );
  return true;
}

void registerShortButtonPress(unsigned long now) {
  playButtonBeeps(1);

  if (buttonClickCount == 1 && now - firstButtonClickAt <= DOUBLE_CLICK_WINDOW_MS) {
    buttonClickCount = 0;
    Serial.println("[Button] GPIO13 double-click detected");
    queueSnapshot("gpio13_double_click", true);
    return;
  }

  buttonClickCount = 1;
  firstButtonClickAt = now;
  Serial.println("[Button] GPIO13 first click; waiting briefly for a second click");
}

void toggleCaptureMode() {
  if (activeCaptureMode == CAPTURE_MODE_HIGH_2MP) {
    activeCaptureMode = CAPTURE_MODE_NORMAL_5K;
  } else if (cameraHasPsram) {
    activeCaptureMode = CAPTURE_MODE_HIGH_2MP;
  } else {
    activeCaptureMode = CAPTURE_MODE_NORMAL_5K;
    Serial.println("[Button] 2 MP mode requires PSRAM; staying in normal mode");
  }

  uint8_t confirmationBeeps = activeCaptureMode == CAPTURE_MODE_HIGH_2MP ? 3 : 2;
  playButtonBeeps(confirmationBeeps);
  Serial.printf(
    "[Button] Capture mode: %s (%u confirmation beeps)\n",
    captureModeName(activeCaptureMode),
    confirmationBeeps
  );
}

void serviceCaptureButton() {
  bool reading = digitalRead(CAPTURE_BUTTON_PIN);
  unsigned long now = millis();

  if (reading != lastButtonReading) {
    lastButtonReading = reading;
    lastButtonChangeAt = now;
  }

  if (now - lastButtonChangeAt >= BUTTON_DEBOUNCE_MS && reading != stableButtonState) {
    stableButtonState = reading;
    if (stableButtonState == LOW) {
      buttonPressActive = true;
      buttonLongPressHandled = false;
      buttonPressedAt = now;
    } else if (buttonPressActive) {
      buttonPressActive = false;
      if (!buttonLongPressHandled) registerShortButtonPress(now);
    }
  }

  if (buttonPressActive
      && stableButtonState == LOW
      && !buttonLongPressHandled
      && now - buttonPressedAt >= BUTTON_MODE_HOLD_MS) {
    buttonLongPressHandled = true;
    buttonClickCount = 0;
    toggleCaptureMode();
  }

  if (buttonClickCount == 1 && now - firstButtonClickAt >= DOUBLE_CLICK_WINDOW_MS) {
    buttonClickCount = 0;
    Serial.println("[Button] GPIO13 single click detected");
    queueSnapshot("gpio13_single_click", false);
  }
}

bool utcTimestamp(char *output, size_t outputSize) {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 0)) return false;
  return strftime(output, outputSize, "%Y-%m-%dT%H:%M:%SZ", &timeInfo) > 0;
}

void restoreLiveCameraSettings(sensor_t *sensor, const CameraSettingsBackup &settings) {
  if (!sensor) return;
  sensor->set_framesize(sensor, settings.frameSize);
  sensor->set_quality(sensor, settings.quality);
  sensor->set_ae_level(sensor, settings.aeLevel);
  sensor->set_brightness(sensor, settings.brightness);
  sensor->set_whitebal(sensor, settings.awb);
  sensor->set_awb_gain(sensor, settings.awbGain);
  sensor->set_wb_mode(sensor, settings.wbMode);
  sensor->set_exposure_ctrl(sensor, settings.aec);
  sensor->set_gain_ctrl(sensor, settings.agc);
}

bool capturePendingSnapshot() {
  if (xSemaphoreTake(cameraMutex, pdMS_TO_TICKS(1500)) != pdTRUE) {
    Serial.println("[Snapshot] Camera busy; will retry");
    return false;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  bool useFlash = snapshotFlashRequested;
  bool highResolution = pendingSnapshotMode == CAPTURE_MODE_HIGH_2MP && cameraHasPsram;
  framesize_t requestedFrameSize = highResolution
    ? HIGH_SNAPSHOT_FRAME_SIZE
    : NORMAL_SNAPSHOT_FRAME_SIZE;
  uint8_t requestedJpegQuality = highResolution
    ? HIGH_SNAPSHOT_JPEG_QUALITY
    : NORMAL_SNAPSHOT_JPEG_QUALITY;
  CameraSettingsBackup previousSettings = {
    LIVE_FRAME_SIZE,
    LIVE_JPEG_QUALITY,
    0,
    0,
    AUTO_WB_MODE,
    1,
    1,
    1,
    1,
  };
  bool changedSensorSettings = false;

  if (sensor && psramFound()) {
    previousSettings.frameSize = static_cast<framesize_t>(sensor->status.framesize);
    previousSettings.quality = sensor->status.quality;
    previousSettings.aeLevel = sensor->status.ae_level;
    previousSettings.brightness = sensor->status.brightness;
    previousSettings.wbMode = sensor->status.wb_mode;
    previousSettings.awb = sensor->status.awb;
    previousSettings.awbGain = sensor->status.awb_gain;
    previousSettings.aec = sensor->status.aec;
    previousSettings.agc = sensor->status.agc;

    sensor->set_framesize(sensor, requestedFrameSize);
    sensor->set_quality(sensor, requestedJpegQuality);
    sensor->set_exposure_ctrl(sensor, 1);
    sensor->set_gain_ctrl(sensor, 1);
    sensor->set_ae_level(sensor, SNAPSHOT_AE_LEVEL);
    sensor->set_brightness(sensor, SNAPSHOT_BRIGHTNESS);
    sensor->set_whitebal(sensor, 1);
    sensor->set_awb_gain(sensor, 1);
    sensor->set_wb_mode(sensor, useFlash ? FLASH_WB_MODE : AUTO_WB_MODE);
    changedSensorSettings = true;
  }

  if (useFlash) setFlash(true);

  if (changedSensorSettings || useFlash) {
    // A snapshot profile can differ from the live stream. Let AE/AGC settle, then
    // drain every queued pre-change frame before taking the saved image.
    delay(useFlash ? FLASH_SNAPSHOT_SETTLE_MS : SNAPSHOT_SETTLE_MS);
    for (uint8_t index = 0; index < SNAPSHOT_WARMUP_FRAMES; index++) {
      camera_fb_t *transitionFrame = esp_camera_fb_get();
      if (transitionFrame) esp_camera_fb_return(transitionFrame);
      delay(20);
    }
  }

  camera_fb_t *frame = esp_camera_fb_get();
  if (!frame) {
    setFlash(false);
    if (changedSensorSettings) restoreLiveCameraSettings(sensor, previousSettings);
    xSemaphoreGive(cameraMutex);
    snapshotFailures++;
    Serial.println("[Snapshot] Capture failed; will retry");
    return false;
  }

  pendingSnapshotBytes = frame->len;
  pendingSnapshotWidth = frame->width;
  pendingSnapshotHeight = frame->height;
  pendingSnapshotSequence = snapshotSequence + 1;
  pendingSnapshotCapturedUptimeMs = millis();
  pendingSnapshotCaptureId =
    String(CAMERA_DEVICE_ID) + "-"
    + String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX) + "-"
    + String(pendingSnapshotCapturedUptimeMs) + "-"
    + String(pendingSnapshotSequence);
  char capturedAt[24] = "";
  pendingSnapshotCapturedAt = utcTimestamp(capturedAt, sizeof(capturedAt)) ? capturedAt : "";
  pendingSnapshotObjectPath = buildSnapshotObjectPath();
  pendingSnapshotPublicUrl = snapshotPublicUrl();
  pendingSnapshotStorageUploaded = false;
  pendingSnapshotDurablyCached = false;
  lastUploadError = "";
  pendingSnapshotJpeg = static_cast<uint8_t *>(ps_malloc(pendingSnapshotBytes));

  if (!pendingSnapshotJpeg) {
    esp_camera_fb_return(frame);
    setFlash(false);
    if (changedSensorSettings) restoreLiveCameraSettings(sensor, previousSettings);
    xSemaphoreGive(cameraMutex);
    snapshotFailures++;
    Serial.printf(
      "[Snapshot] Cannot allocate %u bytes for transfer; will retry\n",
      static_cast<unsigned int>(pendingSnapshotBytes)
    );
    pendingSnapshotBytes = 0;
    return false;
  }

  memcpy(pendingSnapshotJpeg, frame->buf, pendingSnapshotBytes);

  esp_camera_fb_return(frame);
  setFlash(false);
  if (changedSensorSettings) restoreLiveCameraSettings(sensor, previousSettings);
  xSemaphoreGive(cameraMutex);
  snapshotFlashRequested = false;

  Serial.printf(
    "[Snapshot] Captured %s in %s mode (%ux%u, %u bytes)%s\n",
    pendingSnapshotCaptureId.c_str(),
    captureModeName(pendingSnapshotMode),
    pendingSnapshotWidth,
    pendingSnapshotHeight,
    static_cast<unsigned int>(pendingSnapshotBytes),
    useFlash ? " with flash" : ""
  );
  cachePendingSnapshot();
  return true;
}

void clearPendingSnapshotBuffer() {
  if (pendingSnapshotJpeg) free(pendingSnapshotJpeg);
  pendingSnapshotJpeg = nullptr;
  pendingSnapshotBytes = 0;
  pendingSnapshotWidth = 0;
  pendingSnapshotHeight = 0;
  pendingSnapshotSequence = 0;
  pendingSnapshotCapturedUptimeMs = 0;
  pendingSnapshotCaptureId = "";
  pendingSnapshotCapturedAt = "";
  pendingSnapshotObjectPath = "";
  pendingSnapshotPublicUrl = "";
  pendingSnapshotStorageUploaded = false;
  pendingSnapshotDurablyCached = false;
  LittleFS.remove(PENDING_IMAGE_PATH);
  LittleFS.remove(PENDING_METADATA_PATH);
}

void serviceSnapshotPublisher() {
  if (!snapshotPending
      || !cameraReady
      || !cameraMutex) return;

  unsigned long now = millis();
  if (lastSnapshotAttempt != 0 && now - lastSnapshotAttempt < SNAPSHOT_RETRY_MS) return;
  lastSnapshotAttempt = now;

  if (!pendingSnapshotJpeg) {
    if (!capturePendingSnapshot()) return;

    // Keep capture and HTTPS upload in separate loop passes so Wi-Fi and the
    // self-hosted web server can run after the expensive sensor operation.
    lastSnapshotAttempt = 0;
    Serial.println("[Snapshot] JPEG cached; direct Supabase upload scheduled");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) return;

  // Supabase is never attempted before the JPEG and its metadata are durable
  // in LittleFS. If flash was temporarily busy/full, keep the PSRAM buffer and
  // retry the same local write instead of sending an uncached image.
  if (!pendingSnapshotDurablyCached) {
    if (!cachePendingSnapshot()) snapshotFailures++;
    return;
  }

  if (!supabaseConfigured()) {
    setUploadError("Supabase URL/publishable key is not configured in firmware.");
    snapshotFailures++;
    return;
  }

  if (!uploadPendingSnapshotToStorage() || !upsertPendingSnapshotReference()) {
    snapshotFailures++;
    return;
  }

  lastUploadError = "";
  appendImageHistory();
  snapshotSequence = pendingSnapshotSequence;
  preferences.putULong("sequence", snapshotSequence);
  snapshotPending = false;
  snapshotFlashRequested = false;
  Serial.printf("[Snapshot] Supabase confirmed %s\n", pendingSnapshotCaptureId.c_str());
  clearPendingSnapshotBuffer();
}

void serviceSerialCapture() {
  while (Serial.available() > 0) {
    char command = static_cast<char>(Serial.read());
    if (command == 'c' || command == 'C') queueSnapshot("serial", false);
    if (command == 'f' || command == 'F') queueSnapshot("serial_flash", true);
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[CameraCapture] Starting standalone data collector");

  pinMode(CAPTURE_BUTTON_PIN, INPUT_PULLUP);
  pinMode(FLASH_LED_PIN, OUTPUT);
  setFlash(false);
  ledcSetup(BUZZER_LEDC_CHANNEL, BUTTON_BEEP_HZ, 8);
  ledcAttachPin(BUZZER_PIN, BUZZER_LEDC_CHANNEL);
  ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);
  Serial.printf(
    "[Button] GPIO%u initial level: %s (released must be HIGH)\n",
    CAPTURE_BUTTON_PIN,
    digitalRead(CAPTURE_BUTTON_PIN) == HIGH ? "HIGH" : "LOW"
  );
  cameraMutex = xSemaphoreCreateMutex();
  historyMutex = xSemaphoreCreateMutex();
  if (!cameraMutex) {
    Serial.println("[Camera] Could not create capture mutex");
  }
  if (!historyMutex) {
    Serial.println("[Cache] Could not create history mutex");
  }

  preferences.begin("camera-cache", false);
  snapshotSequence = preferences.getULong("sequence", 0);
  loadImageHistory();
  bool fileCacheReady = LittleFS.begin(true);
  Serial.printf("[Cache] LittleFS: %s\n", fileCacheReady ? "ready" : "failed");

  setupCamera();
  if (fileCacheReady) restorePendingSnapshot();

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  serviceWifi();
  Serial.printf(
    "[CameraCapture] Supabase direct upload: %s\n",
    supabaseConfigured() ? "configured" : "NOT CONFIGURED"
  );
  Serial.println("[CameraCapture] GPIO13: click = capture, double-click = flash, hold 2 s = switch mode");
  Serial.println("[CameraCapture] Mode confirmation: 2 beeps = normal ~5 KB, 3 beeps = 2 MP");
  Serial.println("[CameraCapture] Serial commands: 'c' capture, 'f' capture with flash");
}

void loop() {
  serviceWifi();
  serviceCaptureButton();
  serviceBuzzer();
  serviceSerialCapture();
  serviceSnapshotPublisher();
  delay(2);
}
