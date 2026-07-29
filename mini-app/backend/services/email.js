import nodemailer from 'nodemailer';
import fs from 'fs';

export function createEmailService(options = {}) {
  const user = options.user || process.env.EMAIL_USER;
  const pass = options.pass || process.env.EMAIL_PASS;
  const receiver = options.receiver || process.env.EMAIL_RECEIVER;
  const ready = Boolean(options.enabled !== false && user && pass && receiver);

  const transporter = ready
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      })
    : null;

  return {
    async sendImage(imagePath, caption = '', subject = 'EdgeGuard Alert Notification', customReceivers = null, alertInfo = {}) {
      const targetReceivers = customReceivers || receiver;
      if (!ready) {
        console.log('[Email] Disabled or missing config.');
        return { skipped: true };
      }
      if (!targetReceivers || (Array.isArray(targetReceivers) && targetReceivers.length === 0)) {
        console.log('[Email] No active receiver emails found.');
        return { skipped: true };
      }

      try {
        let attachmentOptions = null;
        let hasImage = false;

        if (typeof imagePath === 'string') {
          if (imagePath.startsWith('data:image/')) {
            const base64Data = imagePath.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            attachmentOptions = {
              filename: 'alert_capture.jpg',
              content: buffer,
              cid: 'captured_image',
              contentDisposition: 'inline',
            };
            hasImage = true;
          } else if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            try {
              const res = await fetch(imagePath);
              if (res.ok) {
                const arrayBuf = await res.arrayBuffer();
                attachmentOptions = {
                  filename: 'alert_capture.jpg',
                  content: Buffer.from(arrayBuf),
                  cid: 'captured_image',
                  contentDisposition: 'inline',
                };
                hasImage = true;
              }
            } catch (err) {
              console.warn('[Email] Failed to fetch remote image for attachment:', err.message);
            }
          } else if (fs.existsSync(imagePath)) {
            attachmentOptions = {
              filename: 'alert_capture.jpg',
              path: imagePath,
              cid: 'captured_image',
              contentDisposition: 'inline',
            };
            hasImage = true;
          }
        }

        const severity = (alertInfo.severity || 'danger').toLowerCase();
        const badgeColor = severity === 'danger' ? '#dc2626' : severity === 'warning' ? '#d97706' : '#2563eb';
        const badgeText = severity === 'danger' ? '🚨 CẢNH BÁO NGUY HIỂM' : severity === 'warning' ? '⚠️ CẢNH BÁO' : 'ℹ️ THÔNG BÁO';
        const formattedTime = alertInfo.time || new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const deviceId = alertInfo.deviceId || process.env.MQTT_DEVICE_ID || 'device_001';
        const alertMessage = alertInfo.message || caption || 'Phát hiện sự kiện an ninh từ hệ thống EdgeGuard.';

        const tgWebLink = alertInfo.telegramBotLink || process.env.TELEGRAM_BOT_LINK || 'https://t.me';
        const webAppUrl = alertInfo.webAppUrl || tgWebLink;

        const htmlContent = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 24px; color: #f8fafc; }
    .container { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    .header { background: #0f172a; padding: 20px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between; }
    .title-area { padding: 24px; }
    .badge { display: inline-block; padding: 6px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; color: #ffffff; background-color: ${badgeColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    .heading { font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 16px 0; line-height: 1.4; }
    .meta-box { background: rgba(255, 255, 255, 0.04); border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; border: 1px solid rgba(255, 255, 255, 0.06); }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label { color: #94a3b8; font-weight: 500; }
    .meta-val { color: #f1f5f9; font-weight: 600; }
    .image-container { padding: 0 24px 24px 24px; text-align: center; }
    .alert-img { width: 100%; max-width: 512px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3); object-fit: cover; }
    .cta-area { padding: 0 24px 24px 24px; text-align: center; }
    .btn { display: inline-block; width: 100%; box-sizing: border-box; padding: 14px 24px; background: #3b82f6; color: #ffffff !important; font-weight: 700; text-decoration: none; border-radius: 10px; font-size: 14px; text-align: center; }
    .footer { background: #0f172a; padding: 16px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0; color: #38bdf8; font-size: 18px; font-weight: 800; tracking: 1px;">🛡️ EDGEGUARD SECURITY</h2>
    </div>
    <div class="title-area">
      <span class="badge">${badgeText}</span>
      <h1 class="heading">${alertMessage}</h1>
      <div class="meta-box">
        <div class="meta-row"><span class="meta-label">⏰ Thời gian:</span><span class="meta-val">${formattedTime}</span></div>
        <div class="meta-row"><span class="meta-label">📷 Thiết bị:</span><span class="meta-val">${deviceId}</span></div>
        <div class="meta-row"><span class="meta-label">🔒 Trạng thái:</span><span class="meta-val" style="color: ${badgeColor};">Cần chú ý</span></div>
      </div>
    </div>
    ${hasImage ? `
    <div class="image-container">
      <img src="cid:captured_image" alt="Ảnh chụp cảnh báo" class="alert-img" />
    </div>
    ` : ''}
    <div class="cta-area">
      <a href="${webAppUrl}" class="btn">🚀 Mở EdgeGuard Telegram App</a>
    </div>
    <div class="footer">
      <p style="margin: 0 0 4px 0;">Email này được gửi tự động từ hệ thống giám sát an ninh EdgeGuard.</p>
      <p style="margin: 0;">Cơ chế chống SPAM: Thông báo lặp lại cùng loại sẽ tự động gom tần suất (tối đa 1 email / 2 phút).</p>
    </div>
  </div>
</body>
</html>
        `;

        const mailOptions = {
          from: `"EdgeGuard System" <${user}>`,
          to: Array.isArray(targetReceivers) ? targetReceivers.join(', ') : targetReceivers,
          subject: `[EdgeGuard Alert] ${alertMessage}`,
          html: htmlContent,
          attachments: hasImage && attachmentOptions ? [attachmentOptions] : [],
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('[Email] Sent alert email successfully to:', mailOptions.to, info.messageId);
        return { success: true, info };
      } catch (err) {
        console.error('[Email] Failed to send alert email:', err.message);
        return { success: false, error: err.message };
      }
    },
  };
}