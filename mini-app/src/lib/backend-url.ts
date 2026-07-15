import 'server-only';

function backendBaseUrl() {
  return process.env.BACKEND_URL
    || `http://127.0.0.1:${process.env.PORT || '4000'}`;
}

export function backendApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalizedPath, `${backendBaseUrl().replace(/\/$/, '')}/`).toString();
}
