import { Router } from 'express';
import { createTelegramService } from '../services/telegram.js';

const telegramService = createTelegramService({
  enabled: true,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const EVENT_SEVERITIES = new Set(['info', 'warning', 'danger']);

export function createMqttRouter(mqttService) {
  const router = Router();

  router.get('/stream', (request, response) => {
    const boundary = 'edgeguard-frame';
    response.status(200);
    response.set({
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let waitingForDrain = false;
    const unsubscribe = mqttService.subscribeToFrames((frame) => {
      if (waitingForDrain || response.writableEnded || response.destroyed) return;

      const header = [
        `--${boundary}`,
        `Content-Type: ${frame.contentType}`,
        `Content-Length: ${frame.buffer.length}`,
        `X-Frame-Time: ${frame.receivedAt}`,
        '',
        '',
      ].join('\r\n');
      const canWriteHeader = response.write(header);
      const canWriteFrame = response.write(frame.buffer);
      const canWriteTail = response.write('\r\n');
      waitingForDrain = !(canWriteHeader && canWriteFrame && canWriteTail);
    });

    response.on('drain', () => {
      waitingForDrain = false;
    });

    const closeStream = () => unsubscribe();
    request.once('close', closeStream);
    response.once('close', closeStream);
  });

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

  router.post('/events', async (request, response, next) => {
    try {
      const { alertType, message, thumbnailUrl, severity, source, metadata, resolved } = request.body;
      if (typeof alertType !== 'string' || !alertType.trim() || alertType.length > 80) {
        response.status(422).json({ error: 'alertType must be a non-empty string up to 80 characters.' });
        return;
      }
      if (typeof message !== 'string' || !message.trim() || message.length > 1000) {
        response.status(422).json({ error: 'message must be a non-empty string up to 1000 characters.' });
        return;
      }
      if (severity !== undefined && !EVENT_SEVERITIES.has(severity)) {
        response.status(422).json({ error: 'severity must be info, warning, or danger.' });
        return;
      }
      if (source !== undefined && (typeof source !== 'string' || source.length > 80)) {
        response.status(422).json({ error: 'source must be a string up to 80 characters.' });
        return;
      }
      if (thumbnailUrl !== undefined && (typeof thumbnailUrl !== 'string' || thumbnailUrl.length > 2048)) {
        response.status(422).json({ error: 'thumbnailUrl must be a string up to 2048 characters.' });
        return;
      }
      if (metadata !== undefined && !isPlainObject(metadata)) {
        response.status(422).json({ error: 'metadata must be an object when provided.' });
        return;
      }
      if (resolved !== undefined && typeof resolved !== 'boolean') {
        response.status(422).json({ error: 'resolved must be a boolean when provided.' });
        return;
      }

      await mqttService.recordEvent({
        alertType: alertType.trim(),
        message: message.trim(),
        thumbnailUrl,
        severity,
        source,
        metadata,
        resolved,
      });
      response.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sync-access', async (_request, response, next) => {
    try {
      const result = await mqttService.syncAccessConfig();
      if (!result.synced) {
        response.status(503).json(result);
        return;
      }
      response.json({ ok: true, ...result });
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

    const teleText = `*MQTT Published*\n• *Topic:* \`${topic}\`\n• *Content:* \`\`\`json\n${JSON.stringify(message, null, 2)}\n\`\`\``;
    telegramService.sendMessage(teleText).catch(err => console.error('[MQTT Route] Telegram error:', err));

    response.json({ ok: true, topic });
  } catch (error) {
    next(error);
  }
});

  return router;
}
