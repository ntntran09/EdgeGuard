import { sanitizeForClient } from "@/lib/security/redact";
import type { PresenceReport } from "./types";

export function exportReportJson(report: PresenceReport): string {
  return JSON.stringify(sanitizeForClient(report), null, 2);
}
