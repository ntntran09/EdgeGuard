import { Router } from 'express';

import { config } from '../config.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createFomoRouter(mqttService) {
  const router = Router();

  router.post('/inference', (request, response) => {
    const deviceId = request.get('X-EdgeGuard-Device-Id');
    if (deviceId !== config.mqtt.deviceId) {
      response.status(401).json({ error: 'Unknown EdgeGuard device.' });
      return;
    }

    if (!isPlainObject(request.body)) {
      response.status(422).json({ error: 'FOMO inference body must be a JSON object.' });
      return;
    }

    const eventId = Number(request.body.event_id);
    const confidence = Number(request.body.confidence);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      response.status(422).json({ error: 'event_id must be a positive integer.' });
      return;
    }
    if (typeof request.body.label !== 'string' || !request.body.label.trim()) {
      response.status(422).json({ error: 'label must be a non-empty string.' });
      return;
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      response.status(422).json({ error: 'confidence must be between 0 and 1.' });
      return;
    }

    mqttService.receiveFomoInference(request.body);
    response.status(202).json({
      ok: true,
      transport: 'http',
      eventId,
    });
  });

  return router;
}
