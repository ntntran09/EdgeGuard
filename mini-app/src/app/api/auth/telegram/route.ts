import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  createTelegramSession,
  parseAdminTelegramIds,
  TELEGRAM_SESSION_COOKIE,
  validateTelegramInitData,
} from '../../../../../shared/telegram-auth.js';

export const dynamic = 'force-dynamic';

function errorResponse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const adminIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS);
  if (!botToken || !isSupabaseConfigured) {
    return errorResponse('Telegram authentication is not configured.', 503);
  }

  const body = await request.json().catch(() => null) as { initData?: unknown } | null;
  const initData = typeof body?.initData === 'string' ? body.initData : '';
  console.log('[Telegram Auth] Received initData auth request:', JSON.stringify({ present: Boolean(initData), length: initData.length }));
  const maxAgeSeconds = Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS || 3600);
  const result = validateTelegramInitData(initData, botToken, { maxAgeSeconds });

  if (!result.ok || !result.user) {
    const params = new URLSearchParams(initData);
    const authDate = Number(params.get('auth_date'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    console.warn('[Telegram Auth] initData validation failed:', JSON.stringify({
      error: result.error,
      keys: [...params.keys()].filter((key) => key !== 'hash' && key !== 'signature').sort(),
      hasHash: Boolean(params.get('hash')),
      hasSignature: Boolean(params.get('signature')),
      authDate: Number.isFinite(authDate) ? authDate : null,
      ageSeconds: Number.isFinite(authDate) ? nowSeconds - authDate : null,
      maxAgeSeconds,
    }));
    return errorResponse(`Telegram authentication failed: ${result.error || 'unknown_error'}`, 401);
  }

  const isBootstrapAdmin = adminIds.has(result.user.id);
  console.log(`[Telegram Auth] initData user ${result.user.id} (${result.user.displayName}); bootstrap admin: ${isBootstrapAdmin ? 'yes' : 'no'}`);

  if (isBootstrapAdmin) {
    const { error } = await supabase
      .from('telegram_device_users')
      .upsert({
        device_id: process.env.MQTT_DEVICE_ID || 'device_001',
        telegram_id: result.user.id,
        display_name: result.user.displayName,
        role: 'admin',
        is_active: true,
      }, { onConflict: 'device_id,telegram_id' });
    if (error) {
      console.error('[Telegram Auth] Bootstrap admin upsert failed:', error.message);
      return errorResponse('Cannot initialize the Telegram administrator.', 503);
    }
  } else {
    const { data, error } = await supabase
      .from('telegram_device_users')
      .select('id')
      .eq('device_id', process.env.MQTT_DEVICE_ID || 'device_001')
      .eq('telegram_id', result.user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) {
      console.error('[Telegram Auth] Access lookup failed:', error.message);
      return errorResponse('Cannot verify Telegram access right now.', 503);
    }
    if (!data) {
      console.warn(`[Telegram Auth] Access denied for Telegram ID ${result.user.id} (${result.user.displayName}).`);
      return errorResponse(`TÃ i khoáº£n Telegram ${result.user.displayName} (${result.user.id}) Ä‘ang chá» quáº£n trá»‹ viÃªn cáº¥p quyá»n.`, 403);
    }
  }

  const sessionMaxAgeSeconds = Number(process.env.TELEGRAM_SESSION_MAX_AGE_SECONDS || 12 * 60 * 60);
  const session = createTelegramSession(result.user, botToken, {
    maxAgeSeconds: sessionMaxAgeSeconds,
  });
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const secure = forwardedProto === 'https' || new URL(request.url).protocol === 'https:';
  const response = NextResponse.json({
    ok: true,
    user: {
      telegramId: result.user.id,
      displayName: result.user.displayName,
      username: result.user.username || null,
    },
  });
  response.cookies.set({
    name: TELEGRAM_SESSION_COOKIE,
    value: session,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeSeconds,
  });
  return response;
}

