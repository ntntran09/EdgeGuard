import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import express from 'express';

import { config } from '../config.js';
import { createDeviceRouter } from './device.js';
import { buildDeviceAccessPayload, createMqttService } from '../services/mqtt-service.js';

let baseUrl;
let server;

before(async () => {
  const service = createMqttService();
  const app = express();
  app.use(express.json());
  app.use('/api/device', createDeviceRouter(service));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
});

test('HTTP telemetry marks the physical device online and updates alarm state', async () => {
  const telemetryResponse = await fetch(`${baseUrl}/api/device/telemetry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeGuard-Device-Id': config.mqtt.deviceId,
    },
    body: JSON.stringify({
      channel: 'system',
      payload: { camera_ready: true, alarm_active: true, alarm_source: 'vision' },
    }),
  });
  assert.equal(telemetryResponse.status, 202);

  const status = await (await fetch(`${baseUrl}/api/device/status`)).json();
  assert.equal(status.connection.deviceConnected, true);
  assert.equal(status.connection.activeTransport, 'http');
  assert.equal(status.summary.cameraReady, true);
  assert.equal(status.summary.alarmActive, true);
  assert.equal(status.summary.alarmSource, 'vision');
});

test('HTTP telemetry rejects a device with the wrong identity', async () => {
  const response = await fetch(`${baseUrl}/api/device/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EdgeGuard-Device-Id': 'other-device' },
    body: JSON.stringify({ channel: 'system', payload: {} }),
  });
  assert.equal(response.status, 403);
});

test('device config carries alert gates and the configured stable duration', () => {
  const payload = buildDeviceAccessPayload({
    object_left_alert_enabled: false,
    stranger_alert_enabled: true,
    object_left_max_seconds: 125,
  });
  assert.equal(payload.object_left_alert_enabled, false);
  assert.equal(payload.stranger_alert_enabled, true);
  assert.equal(payload.vision_stable_alert_ms, 125000);
});
