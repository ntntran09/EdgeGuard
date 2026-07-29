import nodemailer from 'nodemailer';
import fs from 'fs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createEmailService(options = {}) {
  const user = options.user || process.env.EMAIL_USER;
  const pass = options.pass || process.env.EMAIL_PASS;
  const receiver = options.receiver || process.env.EMAIL_RECEIVER;
  const ready = Boolean(options.enabled !== false && user && pass);

  const transporter = ready
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      })
    : null;

  return {
    async sendImage(
      imagePath,
      caption = '',
      subject = 'EdgeGuard Alert Notification',
      customReceivers = null,
      alertInfo = {}
    ) {
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
        const accentColor = severity === 'danger'
          ? '#dc2626'
          : severity === 'warning'
            ? '#d97706'
            : '#2563eb';
        const severityText = severity === 'danger'
          ? 'Nguy hiểm'
          : severity === 'warning'
            ? 'Cảnh báo'
            : 'Thông báo';
        const formattedTime = alertInfo.time
          || new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const alertType = alertInfo.typeLabel || 'Sự kiện an ninh';
        const alertMessage = alertInfo.message
          || caption
          || 'Phát hiện sự kiện an ninh từ hệ thống EdgeGuard.';
        const webAppUrl = alertInfo.webAppUrl
          || alertInfo.telegramBotLink
          || process.env.TELEGRAM_BOT_LINK
          || 'https://t.me';

        const htmlContent = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 24px; background: #f6f7f9; color: #111827; font-family: Arial, sans-serif; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .header { padding: 18px 20px; border-left: 5px solid ${accentColor}; border-bottom: 1px solid #e5e7eb; }
    .title { margin: 0; font-size: 18px; line-height: 1.35; color: #111827; }
    .content { padding: 18px 20px 20px; }
    .row { margin: 0 0 10px; font-size: 15px; line-height: 1.45; }
    .label { font-weight: 700; color: #374151; }
    .severity { color: ${accentColor}; font-weight: 700; }
    .image { display: block; width: 100%; max-width: 520px; margin: 16px auto 0; border: 1px solid #e5e7eb; border-radius: 6px; }
    .cta { margin-top: 18px; }
    .button { display: inline-block; padding: 10px 14px; border-radius: 6px; background: #111827; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 700; }
    .footer { padding: 14px 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">EDGEGUARD SECURITY</h1>
    </div>
    <div class="content">
      <p class="row"><span class="label">Mức độ:</span> <span class="severity">${escapeHtml(severityText)}</span></p>
      <p class="row"><span class="label">Loại:</span> ${escapeHtml(alertType)}</p>
      <p class="row"><span class="label">Mô tả:</span> ${escapeHtml(alertMessage)}</p>
      <p class="row"><span class="label">Thời gian:</span> ${escapeHtml(formattedTime)}</p>
      ${hasImage ? '<img src="cid:captured_image" alt="Ảnh cảnh báo" class="image" />' : ''}
      <div class="cta">
        <a href="${escapeHtml(webAppUrl)}" class="button">Mở EdgeGuard Telegram App</a>
      </div>
    </div>
    <div class="footer">
      Email này được gửi tự động từ hệ thống EdgeGuard. Thông báo email trùng loại được giới hạn tối đa 1 lần mỗi phút.
    </div>
  </div>
</body>
</html>
        `;

        const mailOptions = {
          from: `"EdgeGuard System" <${user}>`,
          to: Array.isArray(targetReceivers) ? targetReceivers.join(', ') : targetReceivers,
          subject,
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
