import 'server-only';

import { createInternalApiKey, INTERNAL_API_KEY_HEADER } from '../../shared/telegram-auth.js';

function backendBaseUrl() {
  return process.env.BACKEND_URL
    || `http://127.0.0.1:${process.env.PORT || '4000'}`;
}

export function backendApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalizedPath, `${backendBaseUrl().replace(/\/$/, '')}/`).toString();
}

export function backendApiHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  const internalApiKey = createInternalApiKey(process.env.TELEGRAM_BOT_TOKEN || '');
  if (internalApiKey) result.set(INTERNAL_API_KEY_HEADER, internalApiKey);
  return result;
}
