# EdgeGuard Telegram + Email Runbook

File này hướng dẫn chạy branch merge Telegram chatbot + Email alert.

## 1. Chuẩn bị

Yêu cầu:

- Node.js đã cài.
- Đã pull branch `feat/telegram-email-integration`.
- Có file env riêng, không commit lên Git.
- Có Supabase project/schema đã cập nhật theo `schema.sql`.
- Có Telegram bot token và Gmail app password/email SMTP nếu muốn test Email.
- Có `cloudflared` nếu muốn mở Telegram Mini App qua tunnel.

Cài dependencies:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
npm.cmd ci
```

## 2. File Env

Tạo một trong các file sau:

- `EdgeGuard-telegram-email-integration\.env`
- hoặc `EdgeGuard-telegram-email-integration\mini-app\.env.local`

Không commit file env. Repo đã ignore `.env`, `.env.*`, `*.env`.

Các biến chính cần có:

```env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_IMAGE_BUCKET=event-images

TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ADMIN_TELEGRAM_IDS=
TELEGRAM_AUTH_REQUIRED=true
TELEGRAM_BOT_UPDATES_ENABLED=false

EMAIL_ENABLED=true
EMAIL_USER=
EMAIL_PASS=
EMAIL_RECEIVER=

MQTT_DEVICE_ID=device_001
MQTT_TOPIC_BASE=/EdgeGuard/device_001
MQTT_ENABLED=false
```

Ghi chú:

- `ADMIN_TELEGRAM_IDS` là Telegram ID admin, dùng để bootstrap quyền Mini App.
- Telegram nhận cảnh báo theo bảng `telegram_device_users` với `is_active = true`.
- Email nhận cảnh báo theo user active có `email` và `email_alert_enabled = true`.
- `EMAIL_RECEIVER` chỉ là fallback khi không load được danh sách email active.

## 3. Chạy Dashboard Web Trên Laptop

Dashboard web mở trực tiếp bằng browser, không cần Telegram auth.

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"

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

Lưu ý:

- `localhost` chỉ mở được trên máy đang chạy server.
- Nếu dashboard báo `Ngoại tuyến`, đó là MQTT/live device offline, không có nghĩa logs/Supabase bị lỗi.

## 4. Chạy Telegram Mini App

Mini App phải chạy production qua HTTPS tunnel. Không dùng Next dev server cho Telegram WebView vì dễ bị kẹt spinner do HMR/dev websocket.

Nếu dùng Windows và `cloudflared` nằm ở `C:\tmp\edgeguard-cloudflared.exe`:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram
```

Script này sẽ:

- build production,
- chạy server ở port `4000`,
- mở Cloudflare quick tunnel,
- cập nhật Telegram bot menu button,
- in ra Mini App URL.

Giữ terminal này mở. Đóng terminal là server/tunnel dừng.

Sau khi script báo READY:

1. Mở Telegram bot.
2. Đóng Mini App cũ nếu đang mở.
3. Bấm nút menu `Mo EdgeGuard`.

## 5. Chạy Song Song Web + Mini App

Dùng 2 terminal:

Terminal 1 cho Mini App:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram
```

Terminal 2 cho web laptop:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"

$env:PORT="4001"
$env:TELEGRAM_AUTH_REQUIRED="false"
$env:NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED="false"
$env:MQTT_ENABLED="false"
$env:TELEGRAM_BOT_UPDATES_ENABLED="false"
node server.js
```

Quy ước port:

- `4000`: Telegram Mini App production qua tunnel.
- `4001`: dashboard web laptop.
- `3000`: không dùng trong setup này.

## 6. Test Cơ Bản

Chạy test Telegram logic:

```powershell
npm.cmd run test:telegram
```

Kỳ vọng hiện tại:

```text
pass 22/22
```

Lint:

```powershell
npm.cmd run lint
```

Hiện còn vài warning cũ/nhỏ, nhưng không có error.

Build:

```powershell
npm.cmd run build
```

Kỳ vọng: build pass.

## 7. Test Gửi Cảnh Báo Telegram + Email

Chạy server `4000` trước. Có thể dùng `npm.cmd run telegram`, hoặc chạy production server thủ công.

Gửi test alert qua endpoint nội bộ:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"

node -e "import dotenv from 'dotenv'; import { createInternalApiKey, INTERNAL_API_KEY_HEADER } from './shared/telegram-auth.js'; dotenv.config({path:'../.env'}); dotenv.config({path:'.env'}); dotenv.config({path:'.env.local'}); const token=process.env.TELEGRAM_BOT_TOKEN||''; const body={alertType:'object_left',message:'Kiểm tra cảnh báo vật thể bị bỏ lại',thumbnailUrl:'https://fcfftrlmljvrvgoxlmul.supabase.co/storage/v1/object/public/event-images/events/device_001/2026-07-29/2026-07-29T13-58-21-346Z-0ef106f0-33e7-49cd-a30c-ae26de0306bc.png',severity:'warning',source:'ai',metadata:{test:'manual_runbook',checked_at:new Date().toISOString()}}; const res=await fetch('http://localhost:4000/api/mqtt/events',{method:'POST',headers:{'Content-Type':'application/json',[INTERNAL_API_KEY_HEADER]:createInternalApiKey(token)},body:JSON.stringify(body)}); console.log('status',res.status); console.log(await res.text());"
```

Kỳ vọng:

- API trả `201 {"ok":true}`.
- Terminal server log có `Telegram Send image successfully`.
- Terminal server log có `Email Sent alert email successfully`.

Lưu ý:

- Email có cooldown 1 phút theo `deviceId + alertType`.
- Telegram hiện không có cooldown.
- Telegram gửi các alert theo rule:
  - `danger`: gửi.
  - `object_left` dù là `warning`: vẫn gửi.
  - `info`: không gửi.
  - warning khác `object_left`: không gửi.

## 8. Quyền Người Dùng

Mini App:

- Người mở Mini App phải có trong `telegram_device_users`.
- `is_active = true`.
- Admin bootstrap có thể được xác định bằng `ADMIN_TELEGRAM_IDS`.

Telegram notification:

- Gửi tới active Telegram users trong `telegram_device_users`.

Email notification:

- Gửi tới active users có `email` và `email_alert_enabled = true`.

## 9. Lỗi Hay Gặp

### Mini App xoay mãi

Nguyên nhân thường gặp:

- Đang serve dev build qua tunnel.
- Telegram WebView bị kẹt cache URL cũ.
- Tunnel chết hoặc server `4000` tắt.

Cách xử lý:

- Chạy lại `npm.cmd run telegram`.
- Đóng hẳn Mini App trên điện thoại rồi mở lại từ bot.
- Kiểm tra public URL không chứa dev HMR:

```powershell
node -e "fetch(process.argv[1]).then(async r=>{const t=await r.text(); console.log({status:r.status, hasDev:t.includes('hmr-client')})})" "PASTE_TUNNEL_URL_HERE"
```

Kỳ vọng: `hasDev: false`.

### Browser localhost báo không có quyền

Do đang mở port Mini App `4000` với Telegram auth thật. Mở web laptop bằng `4001` hoặc chạy auth-off như mục 3.

### Ảnh logs không hiện

Ảnh Supabase hiện được load thẳng, không qua Next image optimizer. Nếu vẫn không hiện:

- kiểm tra URL ảnh trong `/api/events`,
- mở URL ảnh trực tiếp trên browser,
- kiểm tra bucket `event-images` và public policy.

### `JWT issued at future`

Lỗi này thường là lệch giờ/timing từ Supabase. `/api/status` đã fallback sang default settings để không làm dashboard đỏ. Nếu gặp liên tục, kiểm tra giờ máy và timezone.

### Email không gửi

Kiểm tra:

- `EMAIL_ENABLED=true`,
- `EMAIL_USER`,
- `EMAIL_PASS` là Gmail app password,
- user active có email và `email_alert_enabled = true`,
- không bị cooldown 1 phút.

### Telegram không gửi

Kiểm tra:

- `TELEGRAM_ENABLED=true`,
- `TELEGRAM_BOT_TOKEN`,
- user active có `telegram_id`,
- bot chưa bị block bởi user,
- alert type có nằm trong rule gửi không.

## 10. Push/Pull Branch

Branch hiện tại:

```text
feat/telegram-email-integration
```

Pull về:

```powershell
git clone https://github.com/ntntran09/EdgeGuard.git
cd EdgeGuard
git checkout feat/telegram-email-integration
```

Sau đó làm từ mục 1.
