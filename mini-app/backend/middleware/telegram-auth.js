import {
  createInternalApiKey,
  INTERNAL_API_KEY_HEADER,
  parseAdminTelegramIds,
  parseCookieHeader,
  TELEGRAM_SESSION_COOKIE,
  TELEGRAM_TRUSTED_ID_HEADER,
  TELEGRAM_TRUSTED_NAME_HEADER,
  validateTelegramSession,
} from '../../shared/telegram-auth.js';
import { config } from '../config.js';

const ACCESS_CACHE_TTL_MS = 30_000;

function reject(response, status, error) {
  response.status(status).json({ ok: false, error });
}

export function createTelegramAuthMiddleware({ supabaseService }) {
  const adminIds = parseAdminTelegramIds(config.telegram.adminIds);
  const internalApiKey = createInternalApiKey(config.telegram.botToken);
  const accessCache = new Map();

  async function hasAccess(telegramId) {
    if (adminIds.has(telegramId)) return true;
    const cached = accessCache.get(telegramId);
    if (cached && cached.expiresAt > Date.now()) return cached.allowed;

    const allowed = await supabaseService.isTelegramUserActive({
      deviceId: config.mqtt.deviceId,
      telegramId,
    });
    accessCache.set(telegramId, {
      allowed,
      expiresAt: Date.now() + ACCESS_CACHE_TTL_MS,
    });
    return allowed;
  }

  return async (request, response, next) => {
    delete request.headers[TELEGRAM_TRUSTED_ID_HEADER];
    delete request.headers[TELEGRAM_TRUSTED_NAME_HEADER];

    if (!config.telegram.authRequired) {
      next();
      return;
    }

    if (request.path === '/auth/telegram' || request.path === '/auth/debug') {
      next();
      return;
    }

    const suppliedInternalKey = request.get(INTERNAL_API_KEY_HEADER) || '';
    if (internalApiKey && suppliedInternalKey === internalApiKey) {
      next();
      return;
    }

    if (request.path.startsWith('/mqtt')) {
      reject(response, 403, 'Direct MQTT API access is not allowed.');
      return;
    }

    if (!config.telegram.botToken) {
      reject(response, 503, 'Telegram authentication is not configured.');
      return;
    }

    const cookies = parseCookieHeader(request.get('cookie'));
    const result = validateTelegramSession(
      cookies.get(TELEGRAM_SESSION_COOKIE),
      config.telegram.botToken
    );
    if (!result.ok) {
      reject(response, 401, 'Open this dashboard from the configured Telegram Mini App.');
      return;
    }

    try {
      if (!(await hasAccess(result.session.telegramId))) {
        reject(response, 403, 'This Telegram account is waiting for administrator approval.');
        return;
      }
    } catch (error) {
      console.error('[Telegram Auth] Access lookup failed:', error instanceof Error ? error.message : error);
      reject(response, 503, 'Cannot verify Telegram access right now.');
      return;
    }

    request.headers[TELEGRAM_TRUSTED_ID_HEADER] = result.session.telegramId;
    request.headers[TELEGRAM_TRUSTED_NAME_HEADER] = result.session.displayName;
    next();
  };
}