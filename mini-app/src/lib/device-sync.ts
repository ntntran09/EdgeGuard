import 'server-only';

import { backendApiUrl } from '@/lib/backend-url';

export async function syncDeviceAccessConfig() {
  try {
    const response = await fetch(backendApiUrl('/api/mqtt/sync-access'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn('[Device sync] Access config was saved but not delivered:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[Device sync] Access config was saved for the next MQTT reconnect:', error);
    return false;
  }
}
