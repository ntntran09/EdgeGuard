This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Database schema

Run the workspace-root `schema.sql` in the Supabase SQL editor when setting up the app or after pulling schema changes. The device processing controls require `device_settings.camera_image_publish_enabled`; the migration is idempotent and keeps image publishing enabled by default.

## Event image storage

Set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `SUPABASE_IMAGE_BUCKET=event-images` in `.env`. Camera frames remain memory-only until an event is logged. Persistent images use these bucket prefixes:

```text
events/<device-id>/<UTC-date>/<timestamp>-<uuid>.<extension>
ai-logs/<device-id>/<UTC-date>/<timestamp>-<uuid>.<extension>
known-faces/<device-id>/<uuid>.<extension>
manual-uploads/<device-id>/<UTC-date>/<timestamp>-<uuid>.<extension>
```

`alerts`, `ai_logs`, `known_faces`, and `event_images` store only public URLs plus bucket/object paths and image metadata. Image base64/bytea is never written to a database table; if Storage is unavailable, the event is retained without an image and records the storage error in metadata.

## Dynamic camera endpoints

The main `EdgeGuardDevice` firmware serves MJPEG `/stream` on port 81 and `/capture`, `/event-frame`, and `/health` on port 82. Whenever its Wi-Fi address changes, it publishes the complete endpoint set to the retained MQTT topic `{topic-base}/telemetry/endpoints`. The backend consumes that announcement and proxies the stream through `/api/camera/stream`, so camera URLs are not required in `.env`.

AI events use HTTP end to end for device-to-backend delivery. Firmware caches the original JPEG used for FOMO and posts the inference JSON to `/api/fomo/inference`. The backend then requests `/event-frame?event_id=<id>` from the device and verifies `X-EdgeGuard-Event-Id`. The raw detection is inserted before recognition begins. If the exact frame is unavailable, the event is stored without an image; a newer live frame is never substituted.

Open **Settings → System → Dynamic connection paths** to inspect the MQTT topic, device URLs, and server proxy currently in use. The dashboard uses the backend MJPEG proxy and falls back to individual JPEG frames only when the stream cannot be opened.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:4000](http://localhost:4000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
