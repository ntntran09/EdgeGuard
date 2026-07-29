import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { DeviceRole, TelegramDeviceUser } from '@/types';

const DEVICE_ID = process.env.MQTT_DEVICE_ID || 'device_001';
const TRUSTED_TELEGRAM_ID_HEADER = 'x-edgeguard-telegram-id';
const TRUSTED_TELEGRAM_NAME_HEADER = 'x-edgeguard-telegram-name';

interface TelegramUserRow {
  id: string;
  telegram_id: string;
  display_name: string | null;
  role?: DeviceRole | null;
  is_active: boolean;
  email?: string | null;
  email_alert_enabled?: boolean | null;
  added_at: string;
}

export function getRequestTelegramUser(request: Request) {
  const telegramId = request.headers.get(TRUSTED_TELEGRAM_ID_HEADER)?.trim() || null;
  const displayName = request.headers.get(TRUSTED_TELEGRAM_NAME_HEADER)?.trim() || 'Người dùng Telegram';
  return { telegramId, displayName };
}

export function mapTelegramUser(row: TelegramUserRow): TelegramDeviceUser {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    displayName: row.display_name || 'Người dùng Telegram',
    role: row.role || 'admin',
    isActive: row.is_active,
    email: row.email || null,
    emailAlertEnabled: row.email_alert_enabled !== false,
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
  const req = process.env.TELEGRAM_AUTH_REQUIRED ?? process.env.NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED;
  if (req === 'false' || req === '0' || req === 'off') return true;
  if (process.env.DEBUG_ADMIN_SETTINGS === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export async function getRequester(request: Request): Promise<{
  telegramId: string | null;
  displayName: string;
  role: DeviceRole;
  user: TelegramDeviceUser | null;
}> {
  const { telegramId, displayName } = getRequestTelegramUser(request);

  if (!isSupabaseConfigured || debugAdminEnabled()) {
    const effectiveTelegramId = telegramId || adminIds()[0] || '8349107353';
    return { telegramId: effectiveTelegramId, displayName, role: 'admin', user: null };
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
