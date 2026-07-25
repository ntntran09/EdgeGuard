import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTelegramPollingConflict,
  startRegistrationFromUpdate,
} from '../backend/services/telegram-bot-update-service.js';

function update(overrides = {}) {
  return {
    update_id: 100,
    message: {
      chat: { id: 42, type: 'private' },
      from: {
        id: 42,
        is_bot: false,
        first_name: 'Edge',
        last_name: 'Guard',
        username: 'edge_guard',
        language_code: 'vi',
      },
      text: '/start',
      ...overrides,
    },
  };
}

test('extracts a private /start registration', () => {
  assert.deepEqual(startRegistrationFromUpdate(update()), {
    chatId: '42',
    telegramId: '42',
    displayName: 'Edge Guard',
    username: 'edge_guard',
    languageCode: 'vi',
  });
});

test('accepts /start payloads and bot-qualified commands', () => {
  assert.equal(startRegistrationFromUpdate(update({ text: '/start invite-code' }))?.telegramId, '42');
  assert.equal(startRegistrationFromUpdate(update({ text: '/start@IoT_23CLC06_bot' }))?.telegramId, '42');
});

test('ignores non-start messages and group messages', () => {
  assert.equal(startRegistrationFromUpdate(update({ text: 'hello' })), null);
  const groupUpdate = update();
  groupUpdate.message.chat.type = 'group';
  assert.equal(startRegistrationFromUpdate(groupUpdate), null);
});
test('detects Telegram getUpdates conflicts', () => {
  assert.equal(
    isTelegramPollingConflict(new Error('Conflict: terminated by other getUpdates request; make sure that only one bot instance is running')),
    true
  );
  assert.equal(isTelegramPollingConflict(new Error('Bad Gateway')), false);
});
