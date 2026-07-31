import assert from 'node:assert/strict';
import test from 'node:test';

import { createTelegramService } from '../backend/services/telegram.js';

function installFetchRecorder() {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method,
      body: options.body,
    });

    return new Response(JSON.stringify({
      ok: true,
      result: { message_id: calls.length },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('broadcasts Telegram notifications to unique chat ids', async () => {
  const fetchRecorder = installFetchRecorder();
  const telegramService = createTelegramService({
    enabled: true,
    botToken: '123456789:test-token-for-unit-tests',
  });

  try {
    const result = await telegramService.sendImageToChats(['42', '42', '43'], null, 'Alert');

    assert.equal(result.success, true);
    assert.equal(fetchRecorder.calls.length, 2);
    assert.deepEqual(
      fetchRecorder.calls.map((call) => JSON.parse(call.body).chat_id),
      ['42', '43']
    );
  } finally {
    fetchRecorder.restore();
  }
});

test('skips Telegram broadcast when no valid chat id exists', async () => {
  const fetchRecorder = installFetchRecorder();
  const telegramService = createTelegramService({
    enabled: true,
    botToken: '123456789:test-token-for-unit-tests',
  });

  try {
    const result = await telegramService.sendImageToChats(['', 'abc'], null, 'Alert');

    assert.equal(result.skipped, true);
    assert.equal(fetchRecorder.calls.length, 0);
  } finally {
    fetchRecorder.restore();
  }
});

test('sends Telegram photos from public image URLs', async () => {
  const fetchRecorder = installFetchRecorder();
  const telegramService = createTelegramService({
    enabled: true,
    botToken: '123456789:test-token-for-unit-tests',
  });
  const publicUrl = 'https://example.supabase.co/storage/v1/object/public/event-images/events/device/photo.jpg';

  try {
    const result = await telegramService.sendImage(publicUrl, 'Alert', '42');

    assert.equal(result.success, true);
    assert.equal(fetchRecorder.calls.length, 1);
    assert.match(fetchRecorder.calls[0].url, /\/sendPhoto$/);
    assert.equal(fetchRecorder.calls[0].body.get('photo'), publicUrl);
    assert.equal(fetchRecorder.calls[0].body.get('chat_id'), '42');
  } finally {
    fetchRecorder.restore();
  }
});
