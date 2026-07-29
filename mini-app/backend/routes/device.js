import express from 'express';

import { config } from '../config.js';

const TELEMETRY_CHANNELS = new Set([
  'environment',
  'security',
  'power',
  'system',
  'nfc',
  'visionAlert',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createDeviceRouter(mqttService) {
  const router = express.Router();

  router.get('/status', (_request, response) => {
    response.json(mqttService.getStatus());
  });

  router.post('/command', async (request, response, next) => {
    try {
      const { command, payload } = request.body;
      if (typeof command !== 'string' || !/^[a-z0-9_-]+$/i.test(command.trim())) {
        response.status(422).json({ error: 'command is invalid.' });
        return;
      }
      if (payload !== undefined && !isObject(payload)) {
        response.status(422).json({ error: 'payload must be an object.' });
        return;
      }
      const result = await mqttService.publishCommand(command.trim(), payload ?? {});
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/config', async (request, response, next) => {
    try {
      if (!isObject(request.body)) {
        response.status(422).json({ error: 'config must be an object.' });
        return;
      }
      response.json(await mqttService.publishConfig(request.body));
    } catch (error) {
      next(error);
    }
  });

  router.post('/sync-access', async (_request, response, next) => {
    try {
      response.json(await mqttService.syncAccessConfig());
    } catch (error) {
      next(error);
    }
  });

  router.post('/telemetry', (request, response) => {
    const deviceId = request.get('x-edgeguard-device-id') || request.body?.device_id;
    if (deviceId !== config.mqtt.deviceId) {
      response.status(403).json({ error: 'Unknown device.' });
      return;
    }

    const channel = request.body?.channel;
    const payload = request.body?.payload;
    if (!TELEMETRY_CHANNELS.has(channel)) {
      response.status(422).json({ error: 'Unsupported telemetry channel.' });
      return;
    }
    if (!isObject(payload)) {
      response.status(422).json({ error: 'payload must be a JSON object.' });
      return;
    }

    const result = mqttService.receiveTelemetry(channel, payload, {
      topic: `/api/device/telemetry/${channel}`,
      transport: 'http',
    });
    response.status(202).json({ ok: true, transport: 'http', ...result });
  });

  return router;
}
