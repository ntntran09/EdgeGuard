const KEY_NAMES = /(?:api[-_ ]?key|authorization|x-api-key)/gi;
const TOKEN_LIKE = /\b(?:ei_[A-Za-z0-9_-]{12,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/g;

export function redactSecrets(value: unknown, explicitSecrets: string[] = []): string {
  let output = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of explicitSecrets.filter((item) => item.length >= 4)) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output
    .replace(/((?:api[-_ ]?key|authorization|x-api-key)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(TOKEN_LIKE, "[REDACTED]")
    .replace(KEY_NAMES, (match) => match);
}

export function sanitizeForClient<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeForClient) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/api[-_]?key|authorization|secret|credential/i.test(key)) continue;
      output[key] = sanitizeForClient(child);
    }
    return output as T;
  }
  return value;
}
