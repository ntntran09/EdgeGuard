import http from 'node:http';
import https from 'node:https';

import { Router } from 'express';

function endpointFromStatus(mqttService, kind) {
  const endpoints = mqttService.getStatus().summary?.cameraEndpoints;
  const rawValue = endpoints?.[kind];
  if (typeof rawValue !== 'string') return null;

  try {
    const target = new URL(rawValue);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (target.username || target.password) return null;
    return target;
  } catch {
    return null;
  }
}

function cameraTargets(mqttService) {
  let capture = endpointFromStatus(mqttService, 'captureUrl');
  let eventFrame = endpointFromStatus(mqttService, 'eventFrameUrl');
  let stream = endpointFromStatus(mqttService, 'streamUrl');
  const health = endpointFromStatus(mqttService, 'healthUrl');
  const base = endpointFromStatus(mqttService, 'baseUrl');

  if (!capture && base) capture = new URL('/capture', base);
  if (!eventFrame && base) eventFrame = new URL('/event-frame', base);
  if (!stream && base) stream = new URL('/stream', base);
  return { base, capture, eventFrame, stream, health };
}

function publicUrl(target) {
  if (!target) return null;
  return `${target.protocol}//${target.host}${target.pathname}`;
}

export function createCameraRouter(mqttService) {
  const router = Router();

  router.get('/status', (_request, response) => {
    const targets = cameraTargets(mqttService);
    const mqttStatus = mqttService.getStatus();
    response.set('Cache-Control', 'no-store');
    response.json({
      configured: Boolean(targets.capture || targets.stream),
      source: targets.capture || targets.stream ? 'mqtt' : null,
      connected: mqttStatus.connection?.connected ?? false,
      topicBase: mqttStatus.topicBase,
      endpoints: {
        baseUrl: publicUrl(targets.base),
        captureUrl: publicUrl(targets.capture),
        eventFrameUrl: publicUrl(targets.eventFrame),
        streamUrl: publicUrl(targets.stream),
        healthUrl: publicUrl(targets.health),
        frameProxyUrl: '/api/camera/frame',
        streamProxyUrl: '/api/camera/stream',
      },
      liveMode: 'jpeg-polling',
    });
  });

  router.get('/frame', async (_request, response) => {
    const { capture } = cameraTargets(mqttService);
    if (!capture) {
      response.status(503).json({
        error: 'The device has not announced its camera capture URL through MQTT yet.',
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const upstream = await fetch(capture, {
        method: 'GET',
        headers: {
          Accept: 'image/jpeg,*/*',
          'User-Agent': 'EdgeGuard-Camera-Frame-Proxy/1.0',
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!upstream.ok) {
        response.status(upstream.status).json({ error: `ESP32-CAM returned HTTP ${upstream.status}.` });
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.toLowerCase().startsWith('image/')) {
        response.status(502).json({ error: 'ESP32-CAM did not return an image.' });
        return;
      }

      const frame = Buffer.from(await upstream.arrayBuffer());
      if (frame.length === 0) {
        response.status(502).json({ error: 'ESP32-CAM returned an empty frame.' });
        return;
      }

      response.status(200);
      response.set({
        'Content-Type': contentType,
        'Content-Length': String(frame.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
      response.send(frame);
    } catch {
      response.status(controller.signal.aborted ? 504 : 502).json({
        error: controller.signal.aborted
          ? 'ESP32-CAM frame request timed out.'
          : 'Cannot connect to the camera endpoint announced through MQTT.',
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  router.get('/stream', (request, response) => {
    const { stream } = cameraTargets(mqttService);
    if (!stream) {
      response.status(503).json({
        error: 'The device has not announced its camera stream URL through MQTT yet.',
      });
      return;
    }

    const transport = stream.protocol === 'https:' ? https : http;
    let upstreamResponse = null;
    let settled = false;
    const upstreamRequest = transport.request(stream, {
      method: 'GET',
      headers: {
        Accept: 'multipart/x-mixed-replace,image/jpeg,*/*',
        'User-Agent': 'EdgeGuard-Camera-Proxy/1.0',
      },
    }, (upstream) => {
      upstreamResponse = upstream;
      settled = true;
      if (!upstream.statusCode || upstream.statusCode < 200 || upstream.statusCode >= 300) {
        response.status(upstream.statusCode || 502);
        response.set('Content-Type', upstream.headers['content-type'] || 'text/plain; charset=utf-8');
        upstream.pipe(response);
        return;
      }

      response.status(200);
      response.set({
        'Content-Type': upstream.headers['content-type'] || 'multipart/x-mixed-replace',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      upstream.on('error', (error) => {
        if (!response.destroyed) response.destroy(error);
      });
      upstream.pipe(response);
    });

    upstreamRequest.setTimeout(15000, () => {
      upstreamRequest.destroy(new Error('ESP32-CAM stream timed out.'));
    });
    upstreamRequest.on('error', (error) => {
      if (response.destroyed || response.writableEnded) return;
      if (settled || response.headersSent) {
        response.destroy(error);
        return;
      }
      const timedOut = error.message === 'ESP32-CAM stream timed out.';
      console.error('[Camera] Stream proxy failed:', error);
      response.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? 'ESP32-CAM stream timed out.'
          : 'Cannot connect to the camera stream announced through MQTT.',
      });
    });

    const closeUpstream = () => {
      upstreamResponse?.destroy();
      upstreamRequest.destroy();
    };
    request.once('aborted', closeUpstream);
    response.once('close', closeUpstream);
    upstreamRequest.end();
  });

  return router;
}
