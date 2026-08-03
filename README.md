# EdgeGuard AIoT

EdgeGuard is an AIoT security project with these main workspaces:

- `mini-app`: Next.js dashboard, Telegram Mini App, MQTT bridge, Supabase integration, Telegram alerts, and email alerts.
- `hardware`: ESP32/ESP8266 firmware for the IoT device.
- `ai-models`: Python workspace for model training, inference, and MQTT-based model outputs.
- root web app: Edge Impulse FOMO presence evaluation dashboard.

The MQTT contract follows the same pattern as the NomNom reference project: the hardware device publishes telemetry and event images, while the server subscribes to device topics and publishes commands/configuration back to the device.

## Quick Start

Install dependencies:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd ci
```

Prepare a local env file. Do not commit env files. Use the project root `.env` or `mini-app\.env.local` for team setup.

## Run Telegram Mini App

Use a production server behind a Cloudflare HTTPS tunnel. Keep this terminal open while testing on Telegram.

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram:quick
```

When the script prints `READY`, open the Telegram bot, close old Mini App windows, then press `Mo EdgeGuard`.

Use this full command only when you want to rebuild before opening the Mini App:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
$env:CLOUDFLARED_PATH="C:\tmp\edgeguard-cloudflared.exe"
npm.cmd run telegram
```

If `npm.cmd run telegram` fails during `next build` because Google Font fetching is blocked, use `npm.cmd run telegram:quick` with the existing build.

## Run Laptop Dashboard

Run this in a second terminal so the dashboard and Telegram Mini App can run at the same time.

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"

$env:PORT="4001"
$env:TELEGRAM_AUTH_REQUIRED="false"
$env:NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED="false"
$env:MQTT_ENABLED="false"
$env:TELEGRAM_BOT_UPDATES_ENABLED="false"
node server.js
```

Open:

```text
http://localhost:4001
http://localhost:4001/logs
http://localhost:4001/settings
```

Port convention:

- `4000`: Telegram Mini App production server behind Cloudflare tunnel.
- `4001`: laptop dashboard without Telegram auth.
- `3000`: FOMO web evaluation dashboard.

If the dashboard says `Ngoai tuyen`, it usually means MQTT/live device is offline. It does not mean Supabase logs are broken.

## Alert Flow

- Telegram sends alerts to active Telegram users from `telegram_device_users`.
- Email sends alerts to active users with an email address and `email_alert_enabled = true`.
- Telegram currently has no cooldown.
- Email has a 1 minute cooldown per `deviceId + alertType`.
- Alert images are loaded from Supabase public event image URLs.
- Alert display time should use the event image timestamp when available, so realtime demo alerts match the ESP32-CAM uploaded image time.

## Common Commands

Run FOMO web evaluation:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main"
npm.cmd install
npm.cmd run dev
```

Open:

```text
http://localhost:3000
http://localhost:3000/no-exact-match
```

Run Telegram logic tests:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run test:telegram
```

Run lint:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run lint
```

Build:

```powershell
cd "D:\AIOT\FOMO WEB EVALUATION\EdgeGuard-main\mini-app"
npm.cmd run build
```

## MQTT Defaults

- Broker: `broker.hivemq.com`
- Port: `1883`
- Topic base: `/EdgeGuard/device_001`
- Device id: `device_001`
- Image topics: `/EdgeGuard/device_001/image` and `/EdgeGuard/device_001/image/json`

These defaults are suitable for local development and demos. Use a private broker with TLS, credentials, and per-device authentication before deploying real devices.
