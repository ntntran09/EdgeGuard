import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import next from 'next';
import { parse } from 'url';

// Adjust imports for the moved backend files
import { config } from './backend/config.js';
import { createImagesRouter } from './backend/routes/images.js';
import { createMqttRouter } from './backend/routes/mqtt.js';
import { ensureImageStorage } from './backend/services/image-store.js';
import { createMqttService } from './backend/services/mqtt-service.js';
import { createTelegramService } from './backend/services/telegram.js';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = config.port || 3000;

// Initialize Next.js app
const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();

nextApp.prepare().then(async () => {
  await ensureImageStorage();

  const telegram = createTelegramService(config.telegram);
  const mqttService = createMqttService({
    onImageSaved: async (image) => {
      const result = await telegram.sendImage(image);
      if (!result.skipped) {
        image.telegramMsgLink = result.telegramMsgLink;
      }
    },
  });

  if (process.env.EXAMPLE_FLOW) {
    console.log(`[Unified] Example flow "${process.env.EXAMPLE_FLOW}" active, skipping real MQTT connection`);
  } else {
    mqttService.start();
  }

  const app = express();
  const jsonParser = express.json({ limit: `${config.images.maxBytes + 1024}b` });

  app.use(cors());
  app.use(morgan('dev'));

  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      service: 'edgeguard-unified',
      mqtt: mqttService.getStatus(),
    });
  });

  // Mount existing API routes
  app.use('/api/mqtt', jsonParser, createMqttRouter(mqttService));
  app.use('/api/images', jsonParser, createImagesRouter());

  // Let Next.js handle all other requests
  app.use((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const server = app.listen(port, () => {
    console.log(`[Unified] Server listening on http://${hostname}:${port}`);
  });

  function shutdown() {
    console.log('[Unified] Shutting down');
    mqttService.stop();
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
