# EdgeGuard Telegram + Email Runbook

File nay huong dan chay branch merge Telegram chatbot + Email alert tren may local.

## 1. Chuan bi

Yeu cau:

- Da pull branch `feat/telegram-email-integration`.
- Da cai Node.js.
- Da cai dependencies trong `mini-app`.
- Co file env rieng, khong commit len Git.
- Co Supabase schema theo `schema.sql`.
- Co Telegram bot token va Gmail app password/email SMTP neu muon test email.
- Co `cloudflared` neu muon mo Telegram Mini App qua tunnel.

Cai dependencies:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
npm.cmd ci
```

## 2. File Env

Tao mot trong cac file sau:

- `EdgeGuard-telegram-email-integration\.env`
- `EdgeGuard-telegram-email-integration\mini-app\.env.local`

Khong commit file env. Repo da ignore `.env`, `.env.*`, `*.env`.

Bien chinh can co:

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

Ghi chu:

- `ADMIN_TELEGRAM_IDS` la Telegram ID admin, dung de bootstrap quyen Mini App.
- Telegram nhan canh bao theo bang `telegram_device_users` voi `is_active = true`.
- Email nhan canh bao theo active users co `email` va `email_alert_enabled = true`.
- `EMAIL_RECEIVER` chi la fallback khi khong load duoc danh sach email active.

## 3. Chay Telegram Mini App

Mini App phai chay production qua HTTPS tunnel. Khong dung Next dev server cho Telegram WebView vi de bi ket spinner do HMR/dev websocket.

Lenh nen dung khi demo local:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram:quick
```

Script nay se:

- chay server production o port `4000`,
- mo Cloudflare quick tunnel,
- cap nhat Telegram bot menu button sang tunnel URL moi,
- in ra Mini App URL.

Giu terminal nay mo. Dong terminal la server/tunnel dung.

Sau khi script bao `READY`:

1. Mo Telegram bot `@IoT_23CLC06_bot`.
2. Dong Mini App cu neu dang mo.
3. Bam nut menu `Mo EdgeGuard`.

Neu muon build lai production truoc khi mo Mini App, dung:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram
```

Neu `npm.cmd run telegram` fail o buoc `next build` do mang chan Google Font, dung lai `npm.cmd run telegram:quick` voi build co san.

## 4. Chay Dashboard Web Tren Laptop

Dashboard web mo truc tiep bang browser, khong can Telegram auth.

Chay trong terminal thu hai neu dang mo Mini App:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"

$env:PORT="4001"
$env:TELEGRAM_AUTH_REQUIRED="false"
$env:NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED="false"
$env:MQTT_ENABLED="false"
$env:TELEGRAM_BOT_UPDATES_ENABLED="false"
node server.js
```

Mo:

```text
http://localhost:4001
http://localhost:4001/logs
http://localhost:4001/settings
```

Luu y:

- `localhost` chi mo duoc tren may dang chay server.
- Neu dashboard bao `Ngoai tuyen`, do thuong la MQTT/live device offline, khong co nghia logs/Supabase bi loi.

## 5. Chay Song Song Web + Mini App

Dung 2 terminal:

Terminal 1 cho Telegram Mini App:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram:quick
```

Terminal 2 cho dashboard laptop:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"

$env:PORT="4001"
$env:TELEGRAM_AUTH_REQUIRED="false"
$env:NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED="false"
$env:MQTT_ENABLED="false"
$env:TELEGRAM_BOT_UPDATES_ENABLED="false"
node server.js
```

Quy uoc port:

- `4000`: Telegram Mini App production qua tunnel.
- `4001`: dashboard web laptop.
- `3000`: khong dung trong setup local nay.

## 6. Test Co Ban

Chay test Telegram logic:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
npm.cmd run test:telegram
```

Lint:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
npm.cmd run lint
```

Build:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"
npm.cmd run build
```

## 7. Test Gui Canh Bao Telegram + Email

Chay server `4000` truoc bang `npm.cmd run telegram:quick`.

Gui test alert qua endpoint noi bo:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-telegram-email-integration\mini-app"

node -e "import dotenv from 'dotenv'; import { createInternalApiKey, INTERNAL_API_KEY_HEADER } from './shared/telegram-auth.js'; dotenv.config({path:'../.env'}); dotenv.config({path:'.env'}); dotenv.config({path:'.env.local'}); const token=process.env.TELEGRAM_BOT_TOKEN||''; const body={alertType:'object_left',message:'Kiem tra canh bao vat the bi bo lai',thumbnailUrl:'https://fcfftrlmljvrvgoxlmul.supabase.co/storage/v1/object/public/event-images/events/device_001/2026-07-29/2026-07-29T13-58-21-346Z-0ef106f0-33e7-49cd-a30c-ae26de0306bc.png',severity:'warning',source:'ai',metadata:{test:'manual_runbook',checked_at:new Date().toISOString()}}; const res=await fetch('http://localhost:4000/api/mqtt/events',{method:'POST',headers:{'Content-Type':'application/json',[INTERNAL_API_KEY_HEADER]:createInternalApiKey(token)},body:JSON.stringify(body)}); console.log('status',res.status); console.log(await res.text());"
```

Ky vong:

- API tra `201 {"ok":true}`.
- Terminal server log co `Telegram Send image successfully`.
- Terminal server log co `Email Sent alert email successfully`.

Luu y:

- Email co cooldown 1 phut theo `deviceId + alertType`.
- Telegram hien khong co cooldown.
- Telegram gui cac alert theo rule:
  - `danger`: gui.
  - `object_left` du la `warning`: van gui.
  - `info`: khong gui.
  - warning khac `object_left`: khong gui.

## 8. Quyen Nguoi Dung

Mini App:

- Nguoi mo Mini App phai co trong `telegram_device_users`.
- `is_active = true`.
- Admin bootstrap co the duoc xac dinh bang `ADMIN_TELEGRAM_IDS`.

Telegram notification:

- Gui toi active Telegram users trong `telegram_device_users`.

Email notification:

- Gui toi active users co `email` va `email_alert_enabled = true`.

## 9. Loi Hay Gap

### Mini App xoay mai

Nguyen nhan thuong gap:

- Dang serve dev build qua tunnel.
- Telegram WebView bi ket cache URL cu.
- Tunnel chet hoac server `4000` tat.

Cach xu ly:

- Chay lai `npm.cmd run telegram:quick`.
- Dong han Mini App tren dien thoai roi mo lai tu bot.
- Dam bao terminal bao `READY`.

### Browser localhost bao khong co quyen

Do dang mo port Mini App `4000` voi Telegram auth that. Mo web laptop bang `4001` hoac chay auth-off nhu muc 4.

### Anh logs khong hien

Anh Supabase hien duoc load thang, khong qua Next image optimizer. Neu van khong hien:

- kiem tra URL anh trong `/api/events`,
- mo URL anh truc tiep tren browser,
- kiem tra bucket `event-images` va public policy.

### JWT issued at future

Loi nay thuong la lech gio/timing tu Supabase. Neu gap lien tuc, kiem tra gio may va timezone.
