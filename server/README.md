# EdgeGuard API Server

Plain Node.js API server for EdgeGuard. It connects to MQTT, receives telemetry, receives images, and saves images locally.

## Run

```bash
npm install
```

Copy the `.env.example` file to `.env`:

```bash
cp .env.example .env
```

### Environment Variables

Configure the following inside your `.env` file:

- `PORT`: The API port (default: `4000`)
- `MQTT_URL` or (`MQTT_HOST`, `MQTT_PROTOCOL`, `MQTT_PORT`): MQTT connection info.
- `MQTT_DEVICE_ID`: Your target hardware device (default: `device_001`).
- `MQTT_TOPIC_BASE`: The root topic (default: `/EdgeGuard/device_001`).
- `IMAGE_STORAGE_DIR`: Local folder to save images (default: `./data/images`).
- `SUPABASE_URL`: Your Supabase Project URL.
- `SUPABASE_SERVICE_KEY`: Your Supabase Service Role Key (for server-side inserts bypassing RLS).
- `TELEGRAM_ENABLED`: Set to `true` to enable Telegram image forwarding.
- `TELEGRAM_BOT_TOKEN`: The API token from BotFather.
- `TELEGRAM_CHAT_ID`: The target chat ID.

### Database Setup
To store AI logs, alerts, and RFID credentials, execute the SQL found in `supabase-schema.sql` inside your Supabase project's SQL editor.

### Run

```bash
npm run dev
```

Default URL:

```text
http://localhost:4000
```

## MQTT Image Topics

The server subscribes to:

```text
/EdgeGuard/device_001/image
/EdgeGuard/device_001/image/json
```

Publish raw bytes to `/image`, or JSON base64 to `/image/json`:

```json
{
  "image_base64": "/9j/4AAQSkZJRgABAQAAAQABAAD...",
  "content_type": "image/jpeg",
  "filename": "capture.jpg"
}
```

Saved files go to `server/data/images`.

## API

- `GET /health`
- `GET /api/mqtt/status`
- `POST /api/mqtt/command`
- `POST /api/mqtt/config`
- `POST /api/mqtt/send`
- `GET /api/images`
- `GET /api/images/:filename`
- `POST /api/images`

Telegram forwarding is stubbed in `src/services/telegram.js` and can be enabled later with bot credentials.
