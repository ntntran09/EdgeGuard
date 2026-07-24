import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import next from 'next';

// Adjust imports for the moved backend files
import { config } from './backend/config.js';
import { createCameraRouter } from './backend/routes/camera.js';
import { createFomoRouter } from './backend/routes/fomo.js';
import { createImagesRouter } from './backend/routes/images.js';
import { createMqttRouter } from './backend/routes/mqtt.js';
import { createMqttService } from './backend/services/mqtt-service.js';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = config.port || 3000;

// Initialize Next.js app
const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const mqttService = createMqttService();

  if (config.mqtt.enabled) {
    mqttService.start();
  } else {
    console.log('[MQTT] Disabled by MQTT_ENABLED=false');
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
  app.use('/api/camera', createCameraRouter(mqttService));
  app.use('/api/fomo', jsonParser, createFomoRouter(mqttService));
  app.use('/api/mqtt', jsonParser, createMqttRouter(mqttService));
  app.use('/api/images', jsonParser, createImagesRouter());

  // Let Next.js handle all other requests
  app.use((req, res) => {
    handle(req, res);
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
