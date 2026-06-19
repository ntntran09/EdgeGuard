import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { config } from './config.js';
import { createImagesRouter } from './routes/images.js';
import { createMqttRouter } from './routes/mqtt.js';
import { ensureImageStorage } from './services/image-store.js';
import { createMqttService } from './services/mqtt-service.js';
import { createTelegramService } from './services/telegram.js';

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

mqttService.start();

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: `${config.images.maxBytes + 1024}b` }));

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'edgeguard-api',
    mqtt: mqttService.getStatus(),
  });
});

app.use('/api/mqtt', createMqttRouter(mqttService));
app.use('/api/images', createImagesRouter());

app.use((error, _request, response, _next) => {
  void _next;
  console.error('[API] Unhandled error', error);
  response.status(500).json({
    error: error instanceof Error ? error.message : 'Internal server error',
  });
});

const server = app.listen(config.port, () => {
  console.log(`[API] EdgeGuard server listening on http://localhost:${config.port}`);
});

function shutdown() {
  console.log('[API] Shutting down');
  mqttService.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
