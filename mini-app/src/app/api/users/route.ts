import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, mapTelegramUser, requireAdmin } from '@/lib/server-auth';

export async function GET(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ users: [] }, { status: 403 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ users: [] });
  }

  const { data, error } = await supabase
    .from('telegram_device_users')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .order('added_at', { ascending: false });

  if (error) {
    return NextResponse.json({ users: [] }, { status: 400 });
  }

  return NextResponse.json({ users: (data || []).map(mapTelegramUser) });
}

export async function POST(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được thêm người dùng' }, { status: 403 });
  }

  const { telegramId, displayName } = await request.json();
  if (!telegramId) {
    return NextResponse.json({ ok: false, error: 'telegramId là bắt buộc' }, { status: 422 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      ok: true,
      user: {
        id: crypto.randomUUID(),
        telegramId,
        displayName: displayName || 'Người dùng Telegram',
        role: 'user',
        isActive: true,
        addedAt: new Date().toISOString(),
      },
    }, { status: 201 });
  }

  const { data, error } = await supabase
    .from('telegram_device_users')
    .upsert({
      device_id: DEVICE_ID,
      telegram_id: String(telegramId),
      display_name: displayName || 'Người dùng Telegram',
      role: 'user',
      is_active: true,
    }, { onConflict: 'device_id,telegram_id' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, user: mapTelegramUser(data) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được cấp quyền người dùng' }, { status: 403 });
  }

  const { id, isActive } = await request.json();
  if (!id || typeof isActive !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'id và isActive là bắt buộc' }, { status: 422 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
  }

  const { data: target, error: lookupError } = await supabase
    .from('telegram_device_users')
    .select('*')
    .eq('device_id', DEVICE_ID)
    .eq('id', id)
    .maybeSingle();
  if (lookupError || !target) {
    return NextResponse.json({ ok: false, error: lookupError?.message || 'User not found' }, { status: 404 });
  }

  const bootstrapAdminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (target.role === 'admin' || bootstrapAdminIds.includes(String(target.telegram_id))) {
    return NextResponse.json({ ok: false, error: 'Không thể thay đổi quyền admin gốc' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('telegram_device_users')
    .update({ is_active: isActive })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, user: mapTelegramUser(data) });
}
export async function DELETE(request: Request) {
  const requester = await requireAdmin(request);
  if (!requester.ok) {
    return NextResponse.json({ ok: false, error: 'Chỉ admin mới được xóa người dùng' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from('telegram_device_users')
    .update({ is_active: false })
    .eq('device_id', DEVICE_ID)
    .eq('id', id)
    .neq('role', 'admin');

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
