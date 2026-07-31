import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return transporter;
}

export async function sendEmailOtp(toEmail: string, otp: string, userName: string) {
  const t = getTransporter();
  const from = process.env.EMAIL_USER;
  if (!t || !from) {
    console.warn('[Email OTP] Email not configured.');
    return { skipped: true };
  }
  await t.sendMail({
    from: `"EdgeGuard Security" <${from}>`,
    to: toEmail,
    subject: 'Mã xác nhận đăng ký Email cảnh báo - EdgeGuard',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f9f9f9; border-radius: 12px;">
        <h2 style="color: #1a1d24; margin-bottom: 8px;">🔐 Xác nhận Email cảnh báo</h2>
        <p style="color: #555;">Xin chào <strong>${userName}</strong>,</p>
        <p style="color: #555;">Bạn đã yêu cầu đăng ký email này để nhận cảnh báo khẩn cấp từ hệ thống <strong>EdgeGuard</strong>.</p>
        <div style="background: #1a1d24; color: #4ade80; font-size: 32px; font-weight: 700; letter-spacing: 10px; text-align: center; padding: 20px; border-radius: 10px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #888; font-size: 13px;">Mã có hiệu lực trong <strong>5 phút</strong>. Không chia sẻ mã này với ai.</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="color: #aaa; font-size: 12px;">Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email này.</p>
      </div>`,
  });
  console.log('[Email OTP] Sent OTP to:', toEmail);
  return { success: true };
}

export async function sendEmailRegistrationNotice(toEmail: string, userName: string, action: 'registered' | 'removed') {
  const t = getTransporter();
  const from = process.env.EMAIL_USER;
  if (!t || !from) return { skipped: true };

  const isRegistered = action === 'registered';
  await t.sendMail({
    from: `"EdgeGuard Security" <${from}>`,
    to: toEmail,
    subject: isRegistered
      ? '✅ Email của bạn đã được đăng ký nhận cảnh báo - EdgeGuard'
      : '❌ Email của bạn đã bị xóa khỏi danh sách cảnh báo - EdgeGuard',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f9f9f9; border-radius: 12px;">
        <h2 style="color: ${isRegistered ? '#16a34a' : '#dc2626'}; margin-bottom: 8px;">
          ${isRegistered ? '✅ Đăng ký thành công' : '❌ Đã hủy đăng ký'}
        </h2>
        <p style="color: #555;">Xin chào <strong>${userName}</strong>,</p>
        <p style="color: #555;">
          ${isRegistered
            ? `Email <strong>${toEmail}</strong> đã được đăng ký thành công để nhận cảnh báo khẩn cấp từ hệ thống <strong>EdgeGuard</strong>.`
            : `Email <strong>${toEmail}</strong> đã bị <strong>xóa</strong> khỏi danh sách nhận cảnh báo của hệ thống <strong>EdgeGuard</strong>.`
          }
        </p>
        <p style="color: #888; font-size: 13px;">Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ quản trị viên ngay lập tức.</p>
      </div>`,
  });
  console.log('[Email Notice] Sent', action, 'notice to:', toEmail);
  return { success: true };
}
