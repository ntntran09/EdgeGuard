import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { DEVICE_ID, getRequester } from '@/lib/server-auth';
import { generateOtp, storeOtp } from '@/lib/otp-store';
import { sendEmailOtp } from '@/lib/email-alert';

/**
 * POST /api/users/email-otp
 * Body: { userId: string, email: string }
 * Sinh OTP 6 số → gửi vào email → lưu vào memory store
 */
export async function POST(request: Request) {
  const requester = await getRequester(request);
  if (!requester.telegramId) {
    return NextResponse.json({ ok: false, error: 'Chưa xác thực' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase chưa cấu hình' }, { status: 503 });
  }

  const body = await request.json();
  const { userId, email } = body as { userId?: string; email?: string };

  if (!userId || !email) {
    return NextResponse.json({ ok: false, error: 'userId và email là bắt buộc' }, { status: 422 });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(normalizedEmail)) {
    return NextResponse.json({ ok: false, error: 'Định dạng email không hợp lệ' }, { status: 422 });
  }

  // Kiểm tra user tồn tại và có quyền
  const { data: target } = await supabase
    .from('telegram_device_users')
    .select('id, telegram_id, display_name, is_active, role')
    .eq('device_id', DEVICE_ID)
    .eq('id', userId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ ok: false, error: 'Không tìm thấy người dùng' }, { status: 404 });
  }

  const isSelf = String(requester.telegramId) === String(target.telegram_id);
  const isAdmin = requester.role === 'admin';
  if (!isSelf && !isAdmin) {
    return NextResponse.json({ ok: false, error: 'Không có quyền' }, { status: 403 });
  }

  // Check email unique trên cùng thiết bị
  const { data: existing } = await supabase
    .from('telegram_device_users')
    .select('id')
    .eq('device_id', DEVICE_ID)
    .eq('email', normalizedEmail)
    .neq('id', userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: false, error: 'Email này đã được đăng ký bởi tài khoản khác trên thiết bị này' }, { status: 409 });
  }

  const otp = generateOtp();
  storeOtp(userId, normalizedEmail, otp);

  try {
    await sendEmailOtp(normalizedEmail, otp, target.display_name || 'Người dùng');
    return NextResponse.json({ ok: true, message: `Mã OTP đã được gửi tới ${normalizedEmail}` });
  } catch (err) {
    console.error('[OTP] Failed to send email:', err);
    return NextResponse.json({ ok: false, error: 'Không thể gửi email OTP. Vui lòng thử lại.' }, { status: 500 });
  }
}
