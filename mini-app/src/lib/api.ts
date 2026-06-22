const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

function telegramHeaders() {
  if (typeof window === 'undefined') return {};

  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!user) return {};

  return {
    'x-telegram-user-id': String(user.id),
    'x-telegram-user-name': [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Telegram user',
  };
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');
  Object.entries(telegramHeaders()).forEach(([key, value]) => headers.set(key, value));

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
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
  setDoor: (action: 'lock' | 'unlock') =>
    fetchApi('/api/door', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  unlockDoor: () => fetchApi('/api/door', { method: 'POST', body: JSON.stringify({ action: 'unlock' }) }),
  triggerAlarm: (active = true) =>
    fetchApi('/api/alarm', {
      method: 'POST',
      body: JSON.stringify({ active }),
    }),
  getEvents: (filter?: string) =>
    fetchApi<{ events: import('@/types').SecurityEvent[] }>(
      `/api/events${filter ? `?filter=${filter}` : ''}`
    ),
  markEventViewed: (eventId: string) =>
    fetchApi('/api/events', {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    }),
  markEventsViewed: (eventIds: string[]) =>
    fetchApi('/api/events', {
      method: 'POST',
      body: JSON.stringify({ eventIds }),
    }),
  getCards: () => fetchApi<{ cards: import('@/types').RfidCard[]; pending: import('@/types').PendingRfidScan[] }>('/api/cards'),
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
  acceptPendingCard: (pendingId: string, name: string) =>
    fetchApi<{ card: import('@/types').RfidCard }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ pendingId, name, action: 'accept' }),
    }),
  declinePendingCard: (pendingId: string) =>
    fetchApi('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ pendingId, action: 'decline' }),
    }),
  getStatus: () => fetchApi<import('@/types').SystemStatus>('/api/status'),
  getSettings: () => fetchApi<{ settings: import('@/types').AlertConfig }>('/api/settings'),
  updateSettings: (settings: Partial<import('@/types').AlertConfig>) =>
    fetchApi('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  getMe: () => fetchApi<{ user: import('@/types').TelegramDeviceUser | null; role: import('@/types').DeviceRole }>(
    '/api/me'
  ),
  getUsers: () => fetchApi<{ users: import('@/types').TelegramDeviceUser[] }>('/api/users'),
  addUser: (telegramId: string, displayName: string) =>
    fetchApi<{ user: import('@/types').TelegramDeviceUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ telegramId, displayName }),
    }),
  deleteUser: (id: string) =>
    fetchApi(`/api/users?id=${id}`, { method: 'DELETE' }),
  getFaces: () => fetchApi<{ faces: import('@/types').KnownFace[] }>('/api/faces'),
  addFace: (displayName: string, imageUrl?: string) =>
    fetchApi<{ face: import('@/types').KnownFace }>('/api/faces', {
      method: 'POST',
      body: JSON.stringify({ displayName, imageUrl }),
    }),
  deleteFace: (id: string) =>
    fetchApi(`/api/faces?id=${id}`, { method: 'DELETE' }),
};
