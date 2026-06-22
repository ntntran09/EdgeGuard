import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { DeviceRole, TelegramDeviceUser } from '@/types';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';

interface TelegramUserRow {
  id: string;
  telegram_id: string;
  display_name: string | null;
  role?: DeviceRole | null;
  is_active: boolean;
  added_at: string;
}

export function getRequestTelegramUser(request: Request) {
  const telegramId = request.headers.get('x-telegram-user-id')?.trim() || null;
  const displayName = request.headers.get('x-telegram-user-name')?.trim() || 'Telegram user';
  return { telegramId, displayName };
}

export function mapTelegramUser(row: TelegramUserRow): TelegramDeviceUser {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    displayName: row.display_name || 'Telegram user',
    role: row.role || 'admin',
    isActive: row.is_active,
    addedAt: row.added_at,
  };
}

function adminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function debugAdminEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.DEBUG_ADMIN_SETTINGS === 'true';
}

export async function getRequester(request: Request): Promise<{
  telegramId: string | null;
  displayName: string;
  role: DeviceRole;
  user: TelegramDeviceUser | null;
}> {
  const { telegramId, displayName } = getRequestTelegramUser(request);

  if (!isSupabaseConfigured || debugAdminEnabled()) {
    return { telegramId, displayName, role: 'admin', user: null };
  }

  if (!telegramId) {
    return { telegramId: null, displayName, role: 'user', user: null };
  }

  if (adminIds().includes(telegramId)) {
    const { data } = await supabase
      .from('telegram_device_users')
      .upsert({
        device_id: DEVICE_ID,
        telegram_id: telegramId,
        display_name: displayName,
        role: 'admin',
        is_active: true,
      }, { onConflict: 'device_id,telegram_id' })
      .select()
      .single();

    return {
      telegramId,
      displayName,
      role: 'admin',
      user: data ? mapTelegramUser(data) : null,
    };
  }

  const { data } = await supabase
    .from('telegram_device_users')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .eq('telegram_id', telegramId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) {
    return { telegramId, displayName, role: 'user', user: null };
  }

  return {
    telegramId,
    displayName,
    role: 'admin',
    user: mapTelegramUser(data),
  };
}

export async function requireAdmin(request: Request) {
  const requester = await getRequester(request);
  return {
    ...requester,
    ok: requester.role === 'admin',
  };
}

export { DEVICE_ID };
