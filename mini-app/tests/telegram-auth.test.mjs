import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  createTelegramSession,
  validateTelegramInitData,
  validateTelegramSession,
} from '../shared/telegram-auth.js';

const botToken = '123456789:test-token-for-unit-tests';
const nowSeconds = 1_800_000_000;

function signedInitData(overrides = {}) {
  const { includeSignature = false, ...paramOverrides } = overrides;
  const params = new URLSearchParams({
    auth_date: String(nowSeconds),
    query_id: 'test-query',
    user: JSON.stringify({ id: 42, first_name: 'Edge', last_name: 'Guard' }),
    ...(includeSignature ? { signature: 'telegram-ed25519-signature-placeholder' } : {}),
    ...paramOverrides,
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('accepts valid Telegram initData', () => {
  const result = validateTelegramInitData(signedInitData(), botToken, { nowSeconds });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, '42');
  assert.equal(result.user.displayName, 'Edge Guard');
});
test('accepts valid Telegram initData with signature field', () => {
  const result = validateTelegramInitData(signedInitData({ includeSignature: true }), botToken, { nowSeconds });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, '42');
});

test('rejects tampered Telegram initData', () => {
  const initData = signedInitData().replace('Edge', 'Attacker');
  const result = validateTelegramInitData(initData, botToken, { nowSeconds });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'signature_mismatch');
});

test('rejects expired Telegram initData', () => {
  const result = validateTelegramInitData(
    signedInitData({ auth_date: String(nowSeconds - 3601) }),
    botToken,
    { nowSeconds, maxAgeSeconds: 3600 }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'init_data_expired');
});

test('creates a signed session and rejects a modified one', () => {
  const token = createTelegramSession(
    { id: '42', displayName: 'Edge Guard', username: 'edgeguard' },
    botToken,
    { nowSeconds, maxAgeSeconds: 60 }
  );
  const valid = validateTelegramSession(token, botToken, { nowSeconds: nowSeconds + 30 });
  assert.equal(valid.ok, true);
  assert.equal(valid.session.telegramId, '42');

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(validateTelegramSession(tampered, botToken, { nowSeconds }).ok, false);
});
