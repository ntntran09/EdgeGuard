/**
 * In-memory OTP store — đủ dùng cho single-process server.
 * Key: `${userId}:${email}`, Value: { otp, expiresAt }
 */

const OTP_TTL_MS = 5 * 60 * 1000; // 5 phút
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function storeOtp(userId: string, email: string, otp: string) {
  otpStore.set(`${userId}:${email}`, { otp, expiresAt: Date.now() + OTP_TTL_MS });
}

export function verifyOtpDetailed(userId: string, email: string, otp: string): { valid: boolean; reason?: 'not_found' | 'expired' | 'incorrect' | 'valid' } {
  const key = `${userId}:${email}`;
  const record = otpStore.get(key);
  if (!record) return { valid: false, reason: 'not_found' };
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return { valid: false, reason: 'expired' };
  }
  if (record.otp !== otp) {
    return { valid: false, reason: 'incorrect' };
  }
  otpStore.delete(key); // dùng 1 lần thành công
  return { valid: true, reason: 'valid' };
}

