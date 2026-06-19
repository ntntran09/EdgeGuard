const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function fetchBackend<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`Backend Error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// Client-side API calls
export const api = {
  unlockDoor: () => fetchApi('/api/door', { method: 'POST' }),
  triggerAlarm: (active = true) =>
    fetchApi('/api/alarm', {
      method: 'POST',
      body: JSON.stringify({ active }),
    }),
  getEvents: (filter?: string) =>
    fetchApi<{ events: import('@/types').SecurityEvent[] }>(
      `/api/events${filter ? `?filter=${filter}` : ''}`
    ),
  getCards: () => fetchApi<{ cards: import('@/types').RfidCard[] }>('/api/cards'),
  addCard: (cardUid: string, name: string) =>
    fetchApi<{ card: import('@/types').RfidCard }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ cardUid, name }),
    }),
  deleteCard: (id: string) =>
    fetchApi(`/api/cards?id=${id}`, { method: 'DELETE' }),
  editCard: (id: string, updates: Partial<import('@/types').RfidCard>) =>
    fetchApi<{ card: import('@/types').RfidCard }>('/api/cards', {
      method: 'PUT',
      body: JSON.stringify({ id, ...updates }),
    }),
  getStatus: () => fetchApi<import('@/types').SystemStatus>('/api/status'),
  getSettings: () => fetchApi<{ settings: import('@/types').AlertConfig }>('/api/settings'),
  updateSettings: (settings: Partial<import('@/types').AlertConfig>) =>
    fetchApi('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
};
