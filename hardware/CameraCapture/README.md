# CameraCapture standalone firmware

`CameraCapture.ino` runs the AI Thinker ESP32-CAM without an EdgeGuard backend. The firmware hosts the live camera page and image-list API itself, caches a pending JPEG in LittleFS, uploads directly to Supabase over HTTPS, records its `event_images` row through the Supabase Data API, and retries after network failures or reboot.

## Data flow

```text
GPIO13 click/double-click
  -> camera JPEG in selected profile
  -> PSRAM + LittleFS /pending.jpg cache
  -> direct HTTPS upload to Supabase Storage
  -> direct REST upsert to public.event_images
  -> NVS metadata history
  -> firmware-hosted GET /api/images
  -> image list under the live stream at http://<camera-ip>:81/
```

There is no MQTT broker, Node/Next server, or other backend in this capture flow.

## Wiring

```text
ESP32-CAM GPIO13 ---- button ---- GND
ESP32-CAM GPIO15 ---- buzzer +
ESP32-CAM GND ------- buzzer -
```

The button uses `INPUT_PULLUP`. GPIO4 remains the onboard flash LED. GPIO13/15 overlap the microSD interface, so this sketch uses the internal LittleFS partition instead of microSD.

## Supabase setup

1. Run the workspace-root `schema.sql` in Supabase SQL Editor. It creates the public `event-images` bucket, `event_images.capture_id`, an idempotent `(device_id, capture_id)` index, and RLS policies limited to the `camera-captures/` Storage prefix.
2. In `CameraCapture.ino`, set:

```cpp
const char *SUPABASE_URL = "https://<project-ref>.supabase.co";
const char *SUPABASE_PUBLISHABLE_KEY = "<publishable-key>";
const char *SUPABASE_IMAGE_BUCKET = "event-images";
```

Only use the publishable key (or legacy anon key). Never place a secret/service-role key in firmware. If `CAMERA_DEVICE_ID` is changed from `camera_capture_001`, insert the same ID into `device_settings` because `event_images.device_id` has a foreign key.

A publishable key plus an anonymous insert policy limits where clients can write, but it does not prove that a request came from your physical camera. For an Internet-exposed production device, use a short-lived Supabase Auth JWT and tighten the policies to that authenticated device identity.

The bucket is public so the on-device page can show uploaded images by conventional public Storage URL. The firmware keeps at most 10 metadata entries in NVS. The browser mirrors that list in `localStorage` and stores fetched image blobs in IndexedDB, so subsequent renders prefer the copy cached on the viewing machine.

## Configure and flash

1. Set `WIFI_SSID` and `WIFI_PASSWORD`.
2. Set the three Supabase constants above.
3. Optionally change `CAMERA_DEVICE_ID` and `DATASET_LABEL`.
4. Compile for **AI Thinker ESP32-CAM**, ESP32 Arduino core 2.0.17.

```bat
build_camera_capture.bat
```

Open Serial Monitor at 115200 baud. After Wi-Fi connects, browse to the printed URL, normally `http://<camera-ip>:81/`.

## Capture controls

- Hold GPIO13 for 2 seconds to switch profile. Two beeps confirm normal mode; three beeps confirm 2 MP mode. Releasing after a hold does not capture.
- Normal mode uses QVGA and higher JPEG compression to target roughly 5 KB. Actual JPEG bytes depend on scene detail.
- 2 MP mode uses the OV2640 maximum 1600x1200 frame and requires PSRAM.
- Single-click and wait 500 ms to capture with the selected profile.
- Double-click within 500 ms to capture with the selected profile and onboard flash.
- Serial `c` captures without flash; `f` captures with flash.

## Save a video on a phone

Open the firmware-hosted page on the phone, select **Quay video**, then select **Dừng** and **Lưu vào điện thoại**. The page copies the live MJPEG frames into a browser video recording for up to 60 seconds. It uses MP4 when the phone browser supports it and otherwise uses WebM. A supported share sheet is preferred; otherwise the file is sent to the phone's Downloads folder.

The video is assembled and buffered by the phone browser. It is not encoded, cached, or uploaded by the ESP32, and it is not written to Supabase. This keeps the standalone firmware independent and avoids the memory and storage cost of video encoding on the ESP32-CAM. Current Chrome on Android or Safari on iOS is recommended; exact save/share behavior depends on the phone and browser.

Only one unsent image is queued at a time. It is copied to PSRAM and, up to `MAX_CACHED_SNAPSHOT_BYTES`, persisted as `/pending.jpg` in LittleFS. Upload failures retain the same image and retry every 10 seconds; a reboot restores the pending file. Once both Storage and `event_images` confirm success, the cache file is deleted and the next capture is accepted.

Uploaded JPEGs use sortable UTC filenames such as `capture_20260720_143052Z_0000000042.jpg`. If NTP time is not available yet, the firmware falls back to an `capture_unsynced_uptime_...jpg` name while retaining a unique sequence number.

## Firmware-hosted endpoints

```text
GET /            live stream page with sent-image list
GET /stream      MJPEG stream
GET /capture     current live JPEG (not persisted)
GET /api/images  NVS history plus current pending status
GET /health      device, capture, cache, and Supabase status
```

Keep the device endpoints on a trusted LAN. The current prototype uses `WiFiClientSecure::setInsecure()` for Supabase compatibility; install the CA certificate for your project domain before a production deployment.
