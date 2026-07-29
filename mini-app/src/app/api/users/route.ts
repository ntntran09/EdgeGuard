import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, mapTelegramUser, requireAdmin, getRequester } from '@/lib/server-auth';
import { verifyOtpDetailed } from '@/lib/otp-store';
import { sendEmailRegistrationNotice } from '@/lib/email-alert';

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
  const requester = await getRequester(request);
  const body = await request.json();
  const { id, isActive, email, emailAlertEnabled, otp } = body;

  if (!id) {
    return NextResponse.json({ ok: false, error: 'id là bắt buộc' }, { status: 422 });
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

  const isSelf = requester.telegramId && String(requester.telegramId) === String(target.telegram_id);
  const isAdmin = requester.role === 'admin';

  if (!isAdmin && !isSelf) {
    return NextResponse.json({ ok: false, error: 'Bạn không có quyền chỉnh sửa thông tin của người dùng này' }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof isActive === 'boolean') {
    if (!isAdmin) {
      return NextResponse.json({ ok: false, error: 'Chỉ admin mới được cấp/thu hồi quyền người dùng' }, { status: 403 });
    }
    const bootstrapAdminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (target.role === 'admin' || bootstrapAdminIds.includes(String(target.telegram_id))) {
      return NextResponse.json({ ok: false, error: 'Không thể thay đổi quyền admin gốc' }, { status: 409 });
    }
    updates.is_active = isActive;
  }

  // --- Email handling with OTP verification ---
  if (email !== undefined) {
    const oldEmail: string | null = target.email ? String(target.email).trim().toLowerCase() : null;
    const normalizedEmail: string | null = email ? String(email).trim().toLowerCase() : null;

    if (normalizedEmail === oldEmail) {
      // Email giữ nguyên — chỉ bật/tắt nhận thông báo, không yêu cầu OTP
    } else if (normalizedEmail === null || normalizedEmail === '') {
      // XÓA email — không cần OTP
      updates.email = null;
      updates.email_alert_enabled = true; // reset toggle khi xóa
      if (oldEmail) {
        sendEmailRegistrationNotice(oldEmail, target.display_name || 'Người dùng', 'removed')
          .catch((e) => console.error('[Email Notice] Failed to send removal notice:', e));
      }
    } else {
      // THÊM / THAY ĐỔI sang email mới — bắt buộc verify OTP
      const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      if (!emailRegex.test(normalizedEmail)) {
        return NextResponse.json({ ok: false, error: 'Định dạng email không hợp lệ (VD: user@domain.com)' }, { status: 422 });
      }

      // Verify OTP
      if (!otp) {
        return NextResponse.json({ ok: false, error: 'Vui lòng nhập mã OTP 6 chữ số' }, { status: 422 });
      }

      const otpCheck = verifyOtpDetailed(id, normalizedEmail, String(otp));
      if (!otpCheck.valid) {
        if (otpCheck.reason === 'expired') {
          return NextResponse.json({ ok: false, error: 'Mã OTP đã hết hạn (quá 5 phút). Vui lòng bấm "Gửi lại" để lấy mã mới.' }, { status: 422 });
        }
        if (otpCheck.reason === 'incorrect') {
          return NextResponse.json({ ok: false, error: 'Mã OTP 6 chữ số không chính xác. Vui lòng kiểm tra lại.' }, { status: 422 });
        }
        return NextResponse.json({ ok: false, error: 'Mã OTP chưa được đăng ký hoặc không hợp lệ. Vui lòng bấm "Gửi OTP".' }, { status: 422 });
      }

      // Check uniqueness
      const { data: existing } = await supabase
        .from('telegram_device_users')
        .select('id')
        .eq('device_id', DEVICE_ID)
        .eq('email', normalizedEmail)
        .neq('id', id)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ ok: false, error: 'Email này đã được đăng ký bởi tài khoản khác trên thiết bị này' }, { status: 409 });
      }

      updates.email = normalizedEmail;

      // Gửi thông báo đăng ký thành công
      sendEmailRegistrationNotice(normalizedEmail, target.display_name || 'Người dùng', 'registered')
        .catch((e) => console.error('[Email Notice] Failed to send registration notice:', e));
    }
  }

  if (typeof emailAlertEnabled === 'boolean') {
    updates.email_alert_enabled = emailAlertEnabled;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, user: mapTelegramUser(target) });
  }

  const { data, error } = await supabase
    .from('telegram_device_users')
    .update(updates)
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
