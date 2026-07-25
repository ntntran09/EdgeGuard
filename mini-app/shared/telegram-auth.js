import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

export const TELEGRAM_SESSION_COOKIE = 'edgeguard_telegram_session';
export const TELEGRAM_TRUSTED_ID_HEADER = 'x-edgeguard-telegram-id';
export const TELEGRAM_TRUSTED_NAME_HEADER = 'x-edgeguard-telegram-name';
export const INTERNAL_API_KEY_HEADER = 'x-edgeguard-internal-key';

const SESSION_VERSION = 1;

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(left);
  const rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function telegramSecret(botToken) {
  return hmac('WebAppData', botToken);
}

function sessionSecret(botToken) {
  return hmac('EdgeGuardTelegramSession', botToken);
}

function parseTelegramUser(rawUser) {
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser);
    const id = String(user?.id ?? '').trim();
    if (!/^-?\d+$/.test(id)) return null;

    const firstName = typeof user.first_name === 'string' ? user.first_name.trim() : '';
    const lastName = typeof user.last_name === 'string' ? user.last_name.trim() : '';
    const username = typeof user.username === 'string' ? user.username.trim() : '';

    return {
      id,
      firstName,
      lastName,
      username,
      displayName: [firstName, lastName].filter(Boolean).join(' ') || username || 'Người dùng Telegram',
    };
  } catch {
    return null;
  }
}

export function parseAdminTelegramIds(rawIds) {
  return new Set(
    String(rawIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^-?\d+$/.test(id))
  );
}

export function validateTelegramInitData(initData, botToken, options = {}) {
  if (!botToken) return { ok: false, error: 'telegram_not_configured' };
  if (typeof initData !== 'string' || !initData.trim()) {
    return { ok: false, error: 'missing_init_data' };
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return { ok: false, error: 'invalid_hash' };
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const expectedHash = hmac(telegramSecret(botToken), dataCheckString).toString('hex');
  if (!safeEqual(Buffer.from(receivedHash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
    return { ok: false, error: 'signature_mismatch' };
  }

  const nowSeconds = Number(options.nowSeconds ?? Math.floor(Date.now() / 1000));
  const maxAgeSeconds = Number(options.maxAgeSeconds ?? 3600);
  const clockSkewSeconds = Number(options.clockSkewSeconds ?? 30);
  const authDate = Number(params.get('auth_date'));

  if (!Number.isInteger(authDate)) {
    return { ok: false, error: 'invalid_auth_date' };
  }
  if (authDate > nowSeconds + clockSkewSeconds) {
    return { ok: false, error: 'auth_date_in_future' };
  }
  if (nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, error: 'init_data_expired' };
  }

  const user = parseTelegramUser(params.get('user'));
  if (!user) return { ok: false, error: 'invalid_user' };

  return { ok: true, user, authDate };
}

export function createTelegramSession(user, botToken, options = {}) {
  const nowSeconds = Number(options.nowSeconds ?? Math.floor(Date.now() / 1000));
  const maxAgeSeconds = Number(options.maxAgeSeconds ?? 12 * 60 * 60);
  const payload = {
    v: SESSION_VERSION,
    telegramId: String(user.id),
    displayName: String(user.displayName || 'Người dùng Telegram'),
    username: String(user.username || ''),
    iat: nowSeconds,
    exp: nowSeconds + maxAgeSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = hmac(sessionSecret(botToken), encodedPayload).toString('base64url');
  return `${encodedPayload}.${signature}`;
}

export function validateTelegramSession(token, botToken, options = {}) {
  if (!botToken || typeof token !== 'string') {
    return { ok: false, error: 'missing_session' };
  }

  const [encodedPayload, encodedSignature, ...extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra.length) {
    return { ok: false, error: 'invalid_session' };
  }

  const expectedSignature = hmac(sessionSecret(botToken), encodedPayload);
  let receivedSignature;
  try {
    receivedSignature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return { ok: false, error: 'invalid_session' };
  }
  if (!safeEqual(receivedSignature, expectedSignature)) {
    return { ok: false, error: 'invalid_session_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'invalid_session_payload' };
  }

  const nowSeconds = Number(options.nowSeconds ?? Math.floor(Date.now() / 1000));
  if (payload?.v !== SESSION_VERSION
      || !/^-?\d+$/.test(String(payload?.telegramId ?? ''))
      || !Number.isInteger(payload?.iat)
      || !Number.isInteger(payload?.exp)
      || payload.exp <= nowSeconds) {
    return { ok: false, error: 'expired_or_invalid_session' };
  }

  return {
    ok: true,
    session: {
      telegramId: String(payload.telegramId),
      displayName: String(payload.displayName || 'Người dùng Telegram'),
      username: String(payload.username || ''),
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    },
  };
}

export function createInternalApiKey(botToken) {
  if (!botToken) return '';
  return hmac(sessionSecret(botToken), 'EdgeGuardInternalApi').toString('base64url');
}

export function parseCookieHeader(cookieHeader) {
  const cookies = new Map();
  String(cookieHeader || '')
    .split(';')
    .forEach((entry) => {
      const separator = entry.indexOf('=');
      if (separator < 1) return;
      const key = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (!key) return;
      try {
        cookies.set(key, decodeURIComponent(value));
      } catch {
        cookies.set(key, value);
      }
    });
  return cookies;
}

