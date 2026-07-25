import 'server-only';

import { backendApiHeaders, backendApiUrl } from '@/lib/backend-url';

export interface SecurityAlertInput {
  device_id?: string;
  alert_type: string;
  message: string;
  severity?: 'info' | 'warning' | 'danger';
  source?: string;
  metadata?: Record<string, unknown>;
  resolved?: boolean;
}

export async function logSecurityAlerts(alerts: SecurityAlertInput[]) {
  for (const alert of alerts) {
    const response = await fetch(backendApiUrl('/api/mqtt/events'), {
      method: 'POST',
      headers: backendApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        alertType: alert.alert_type,
        message: alert.message,
        severity: alert.severity,
        source: alert.source,
        metadata: alert.metadata,
        resolved: alert.resolved,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Event logging failed: ${await response.text()}`);
    }
  }
}
