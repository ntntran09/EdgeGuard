# EdgeGuard AIoT

EdgeGuard là hệ thống an ninh AIoT dùng ESP32-CAM, RFID/NFC, FOMO object detection, AWS Rekognition, Supabase, Telegram Mini App, dashboard web và email alert.

## 1. Tổng Quan Hệ Thống

Repo hiện có 4 phần chính:

- `mini-app`: dashboard web, Telegram Mini App, backend Express/Next.js, MQTT bridge, Supabase, Telegram alert và email alert.
- `hardware`: firmware ESP32-CAM/RFID/servo/buzzer, FOMO inference trên thiết bị, HTTP camera endpoints và MQTT/HTTP transport.
- `ai-models`: workspace Python/model phụ trợ.
- root web app: web đánh giá FOMO Edge Impulse, chạy độc lập với hệ thống thiết bị.

Luồng end-to-end khi demo với thiết bị thật:

```text
ESP32-CAM/RFID
  -> MQTT retained config + endpoint announcement
  -> HTTP/MQTT telemetry, RFID, FOMO inference, vision alert
  -> mini-app backend server.js
  -> Supabase Database + Supabase Storage
  -> Dashboard / Logs / Settings
  -> Telegram Mini App + Telegram alert + Email alert
```

## 2. Yêu Cầu Cài Đặt

Cần có:

- Node.js 20 trở lên.
- npm.
- Git.
- Supabase project.
- Telegram bot token nếu chạy Telegram Mini App/Telegram alert.
- Gmail app password hoặc SMTP account nếu bật email alert.
- AWS Rekognition credentials nếu dùng nhận diện khuôn mặt.
- `cloudflared` nếu mở Telegram Mini App qua HTTPS tunnel.
- Arduino IDE hoặc `arduino-cli` nếu build/flash firmware.

## 3. Cài Dependencies

Chạy một lần sau khi clone hoặc sau khi xoá `node_modules`.

Dashboard, Mini App và backend AIoT:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd ci
```

FOMO web evaluation ở root:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main"
npm.cmd ci
```

Nếu `npm.cmd ci` lỗi do lockfile không khớp môi trường local, dùng:

```powershell
npm.cmd install
```

## 4. Cấu Hình Env

Không commit file env thật lên Git.

Backend trong `mini-app` đọc env theo thứ tự:

```text
EdgeGuard-main\.env
EdgeGuard-main\mini-app\.env
EdgeGuard-main\mini-app\.env.local
```

File sau sẽ override file trước. Khuyến nghị khi demo local: tạo `EdgeGuard-main\mini-app\.env.local`.

Ví dụ env chính cho AIoT:

```env
PORT=4000

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
SUPABASE_IMAGE_BUCKET=event-images

MQTT_ENABLED=true
MQTT_PROTOCOL=mqtt
MQTT_HOST=broker.hivemq.com
MQTT_PORT=1883
MQTT_DEVICE_ID=device_001
MQTT_TOPIC_BASE=/EdgeGuard/device_001

TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=
ADMIN_TELEGRAM_IDS=123456789
TELEGRAM_AUTH_REQUIRED=true
TELEGRAM_BOT_UPDATES_ENABLED=false

EMAIL_ENABLED=true
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=your-gmail-app-password
EMAIL_RECEIVER=

AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_REKOGNITION_COLLECTION_ID=edgeguard-faces

BACKEND_PUBLIC_URL=
FOMO_HTTP_BASE_URL=
IMAGE_STORAGE_DIR=./data/images
MAX_IMAGE_BYTES=5242880
```

Ghi chú:

- `SUPABASE_SERVICE_KEY` phải là service role key, không dùng anon key cho backend.
- `ADMIN_TELEGRAM_IDS` dùng để bootstrap quyền admin Telegram.
- Telegram alert gửi cho user active trong bảng `telegram_device_users`.
- Email alert gửi cho user active có `email_alert_enabled = true`; `EMAIL_RECEIVER` chỉ là fallback.
- Nếu cắm thiết bị thật, chỉ nên có một server bật `MQTT_ENABLED=true` và email để tránh duplicate processing/duplicate email.

FOMO web evaluation ở root chỉ cần Edge Impulse credentials nếu muốn lấy dữ liệu thật:

```env
EDGE_IMPULSE_PROJECT_ID=
EDGE_IMPULSE_API_KEY=
```

Đặt trong:

```text
EdgeGuard-main\.env.local
```

## 5. Setup Supabase

1. Mở Supabase SQL Editor.
2. Chạy file `schema.sql` ở root repo.
3. Tạo Storage bucket:

```text
event-images
```

4. Bucket cần public URL để dashboard, Telegram và email load ảnh alert được.
5. Sau khi đổi schema, chạy lại server `mini-app` để backend nhận cấu trúc mới.

Các bảng chính:

- `device_settings`: cấu hình thiết bị.
- `security_events`: view/log sự kiện tổng hợp cho dashboard.
- `alerts`, `ai_logs`, `access_logs`: log cảnh báo, AI, RFID/cửa.
- `telegram_device_users`: user Telegram nhận Mini App/alert.
- `rfid_credentials`: thẻ RFID/NFC hợp lệ.
- `known_faces`: khuôn mặt đã đăng ký.
- `event_images`: metadata ảnh trong Supabase Storage.
- `security_event_views`: trạng thái đã xem sự kiện.

## 6. Chạy Dashboard Local

Chế độ này dùng để mở dashboard trên laptop. Nếu đang chạy Telegram Mini App ở port `4000`, hãy mở dashboard ở port `4001`.

Dashboard chỉ xem log, không kết nối thiết bị, không gửi email/Telegram:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"

$env:PORT="4001"
$env:TELEGRAM_AUTH_REQUIRED="false"
$env:NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED="false"
$env:MQTT_ENABLED="false"
$env:TELEGRAM_BOT_UPDATES_ENABLED="false"
node server.js
```

Mở:

```text
http://localhost:4001
http://localhost:4001/logs
http://localhost:4001/settings
```

Nếu chỉ chạy một server duy nhất để kết nối thiết bị từ dashboard, có thể bật MQTT:

```powershell
$env:PORT="4000"
$env:MQTT_ENABLED="true"
node server.js
```

## 7. Chạy Telegram Mini App

Telegram Mini App nên chạy production server qua HTTPS tunnel. Không nên dùng Next dev server cho Telegram WebView.

Lần đầu hoặc sau khi sửa code:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"

$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram
```

Nếu đã có production build trong `.next`, chạy nhanh:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"

$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram:quick
```

Khi terminal in `READY`, mở Telegram bot, đóng Mini App cũ nếu đang mở, rồi bấm nút mở EdgeGuard.

Nếu `telegram:quick` báo thiếu production build:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run build

$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram:quick
```

## 8. Chạy Dashboard Và Mini App Song Song

Dùng 2 terminal.

Terminal 1, server chính cho Telegram Mini App, MQTT, thiết bị, Telegram/email alert:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"

$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram
```

Terminal 2, dashboard laptop chỉ để xem:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"

$env:PORT="4001"
$env:TELEGRAM_AUTH_REQUIRED="false"
$env:NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED="false"
$env:MQTT_ENABLED="false"
$env:TELEGRAM_BOT_UPDATES_ENABLED="false"
node server.js
```

Quy ước port:

```text
4000: Telegram Mini App production server qua Cloudflare tunnel
4001: Dashboard local không cần Telegram auth
3000: FOMO web evaluation
```

## 9. Máy Khác Xem Dashboard

`localhost` luôn là máy đang mở trình duyệt. Vì vậy máy khác không vào được dashboard bằng:

```text
http://localhost:4001
```

Nếu máy chính đang chạy dashboard ở port `4001`, máy khác phải mở bằng IP LAN của máy chính:

```text
http://<IP-may-chinh>:4001
```

Ví dụ:

```text
http://192.168.1.50:4001
```

Tìm IP máy chính bằng:

```powershell
ipconfig
```

Máy khác chỉ mở browser theo dõi dashboard không tính là nhiều server. Chỉ tính là nhiều server khi mỗi máy tự chạy `node server.js`/`npm run telegram` riêng.

Trong demo thật, nên để một máy chính chạy server có `MQTT_ENABLED=true`. Các máy khác chỉ xem qua LAN IP hoặc chạy dashboard-only với `MQTT_ENABLED=false`.

## 10. Chạy Khi Chưa Có Thiết Bị

Vẫn mở được dashboard, logs, settings, Telegram Mini App và FOMO web evaluation.

Dashboard không có thiết bị:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"

$env:PORT="4001"
$env:TELEGRAM_AUTH_REQUIRED="false"
$env:NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED="false"
$env:MQTT_ENABLED="false"
$env:TELEGRAM_BOT_UPDATES_ENABLED="false"
node server.js
```

Nếu dashboard báo `Ngoai tuyen`, thường chỉ có nghĩa là MQTT/live device offline. Log trong Supabase vẫn có thể load bình thường.

## 11. Chạy FOMO Web Evaluation

FOMO evaluator là web riêng ở root repo, không nằm trong `mini-app`, không cần cắm thiết bị.

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main"

npm.cmd install
npm.cmd run dev
```

Mở:

```text
http://localhost:3000
http://localhost:3000/no-exact-match
```

Nếu port `3000` bị chiếm:

```powershell
npm.cmd run dev -- -p 3002
```

Mở:

```text
http://localhost:3002/no-exact-match
```

FOMO evaluator dùng:

- `Project ID`
- `API Key`
- `Confidence Threshold`

Logic final nằm ở route `/no-exact-match`. Route `/` giữ bản giao diện cũ để đối chiếu.

## 12. Build Và Flash Firmware

Vào folder firmware:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\hardware"
```

Build merged binary:

```powershell
.\build_merged.bat
```

Flash update, giữ NVS/RFID cache:

```powershell
.\flash_update_COM6.bat COM9
```

Full flash, xoá NVS/RFID cache:

```powershell
.\flash_merged_COM6.bat COM9
```

Thay `COM9` bằng port thật của USB-UART trên máy.

Quy trình flash ESP32-CAM:

1. Nối GPIO0 xuống GND.
2. Reset hoặc cấp nguồn lại ESP32-CAM để vào download mode.
3. Đóng Serial Monitor nếu đang mở.
4. Chạy lệnh flash.
5. Tháo GPIO0 khỏi GND.
6. Reset lại thiết bị để boot bình thường.

Sau full flash, cần cho thiết bị online với backend một lần để đồng bộ RFID allowlist/config vào NVS trước khi test offline.

## 13. Luồng Thiết Bị Và AI

Thiết bị publish endpoint camera qua MQTT retained topic:

```text
/EdgeGuard/device_001/telemetry/endpoints
```

Backend dùng endpoint này để proxy camera:

```text
/api/camera/stream
```

Luồng FOMO:

```text
ESP32-CAM chụp frame
  -> chạy FOMO trên thiết bị
  -> post JSON tới /api/fomo/inference
  -> backend lấy đúng event frame từ /event-frame?event_id=<id>
  -> lưu ai_logs/event_images/security_events
  -> nếu là người thì chạy AWS Rekognition
  -> trả vision-result về thiết bị
  -> nếu người lạ hoặc vật thể bị bỏ lại đủ thời gian thì tạo alert
```

Các alert chính:

- `stranger_detected`: phát hiện người lạ.
- `object_left`: vật thể bị bỏ lại.
- `camera_blocked`: camera bị che.
- `rfid_invalid`: thẻ RFID không hợp lệ.
- `access_granted`: mở cửa hợp lệ.

## 14. Telegram Và Email Alert

Telegram alert:

- Gửi cho user active trong `telegram_device_users`.
- Mini App yêu cầu Telegram auth khi chạy production và `TELEGRAM_AUTH_REQUIRED=true`.
- Dashboard local có thể tắt auth bằng env `TELEGRAM_AUTH_REQUIRED=false`.

Email alert:

- Gửi cho user active có email và `email_alert_enabled=true`.
- Nếu không load được danh sách user, có thể dùng fallback `EMAIL_RECEIVER`.
- Có cooldown 1 phút theo `deviceId + alertType`.
- Trong 1 phút nếu có 2 alert cùng loại, ví dụ 2 lần `stranger_detected`, chỉ nên gửi email lần đầu.
- Event vẫn được ghi log và hiện dashboard; cooldown chỉ chặn email để tránh spam inbox.

Lưu ý khi demo:

- Chỉ để một backend có `MQTT_ENABLED=true` xử lý thiết bị/email.
- Nếu nhiều terminal cùng chạy server có MQTT/email, có thể sinh duplicate alert/email.

## 15. Test Và Kiểm Tra

Test Telegram/email notification logic:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run test:telegram-notification
```

Test toàn bộ Telegram logic:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run test:telegram
```

Build Mini App:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run build
```

Test FOMO evaluator:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main"
npm.cmd run test
```

Build FOMO evaluator:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main"
npm.cmd run build
```

## 16. Troubleshooting

Lỗi thiếu package, ví dụ `Cannot find package 'express'`:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd install
```

Lỗi `Supabase is not configured`:

- Kiểm tra file env có đúng tên `.env`, `.env.local` không.
- Không đặt tên kiểu `d41d8cd9.env` vì app không tự đọc file đó.
- Kiểm tra có đủ `SUPABASE_URL` và `SUPABASE_SERVICE_KEY`.
- Restart server sau khi sửa env.

Lỗi `Cannot load events`:

- Mở terminal đang chạy `node server.js`.
- Tìm dòng:

```text
[API /events] GET Error:
```

- Nếu API sau đó đã chạy được, tắt Next.js overlay và hard refresh bằng `Ctrl + F5`.

Lỗi `telegram:quick` báo thiếu production build:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run build

$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram:quick
```

Dashboard mở được nhưng trạng thái `Ngoai tuyen`:

- Thiết bị chưa online hoặc MQTT/live telemetry chưa tới.
- Nếu chỉ xem log cũ, đây không phải lỗi Supabase.
- Kiểm tra `MQTT_DEVICE_ID` và `MQTT_TOPIC_BASE` có khớp firmware không.

Máy khác không vào được `localhost`:

- Dùng IP LAN của máy chạy server.
- Ví dụ `http://192.168.1.50:4001`.
- Kiểm tra firewall Windows nếu vẫn không vào được.

Email gửi liên tục:

- Kiểm tra chỉ có một server bật `MQTT_ENABLED=true`.
- Kiểm tra đã dùng code có cooldown email 1 phút.
- Kiểm tra server có bị restart liên tục giữa các event không.

## 17. Ghi Chú Bảo Mật

- Không commit `.env`, `.env.local`, Gmail app password, Supabase service key, Telegram bot token hoặc AWS keys.
- Không dùng public MQTT broker cho triển khai thật.
- Khi triển khai thật, nên dùng MQTT private broker có TLS, username/password và topic phân quyền theo thiết bị.
- Supabase service role key chỉ dùng ở backend, không expose qua `NEXT_PUBLIC_`.
