import { Router } from 'express';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createMqttRouter(mqttService) {
  const router = Router();

  router.get('/status', (_request, response) => {
    response.json(mqttService.getStatus());
  });

  router.post('/command', async (request, response, next) => {
    try {
      const { command, payload } = request.body;

      if (typeof command !== 'string' || !command.trim()) {
        response.status(422).json({ error: 'command must be a non-empty string.' });
        return;
      }

      if (payload !== undefined && !isPlainObject(payload)) {
        response.status(422).json({ error: 'payload must be an object when provided.' });
        return;
      }

      await mqttService.publishCommand(command, payload ?? {});
      response.json({ ok: true, command });
    } catch (error) {
      next(error);
    }
  });

  router.post('/config', async (request, response, next) => {
    try {
      if (!isPlainObject(request.body)) {
        response.status(422).json({ error: 'config body must be an object.' });
        return;
      }

      await mqttService.publishConfig(request.body);
      response.json({ ok: true, config: request.body });
    } catch (error) {
      next(error);
    }
  });

  router.post('/send', async (request, response, next) => {
    try {
      const { topic, message, retain } = request.body;

      if (typeof topic !== 'string' || !topic.trim()) {
        response.status(422).json({ error: 'topic must be a non-empty string.' });
        return;
      }

      await mqttService.publishJson(topic, message, { retain: Boolean(retain) });
      response.json({ ok: true, topic });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
