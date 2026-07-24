import { redactSecrets, sanitizeForClient } from "@/lib/security/redact";
import { describe, expect, it } from "vitest";

describe("Security redaction", () => {
  it("redact explicit API key và token-like", () => {
    const secret = "ei_abcdefghijklmnopqrstuvwxyz";
    expect(redactSecrets(`x-api-key=${secret}`, [secret])).toContain("[REDACTED]");
    expect(redactSecrets(`x-api-key=${secret}`, [secret])).not.toContain(secret);
  });

  it("loại trường credential khỏi object lồng nhau", () => {
    expect(sanitizeForClient({ ok: true, apiKey: "secret", nested: { authorization: "bearer" } })).toEqual({ ok: true, nested: {} });
  });
});
