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
            const contentType = imagePath.match(/^data:(image\/[\w.+-]+);base64,/)?.[1] || 'image/jpeg';
            const base64Data = imagePath.replace(/^data:image\/[\w.+-]+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            attachmentOptions = {
              filename: 'alert_capture.jpg',
              content: buffer,
              cid: 'captured_image@edgeguard',
              contentType,
              contentDisposition: 'inline',
            };
            hasImage = true;
          } else if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            try {
              const res = await fetch(imagePath);
              if (res.ok) {
                const arrayBuf = await res.arrayBuffer();
                const contentType = res.headers.get('content-type') || 'image/jpeg';
                attachmentOptions = {
                  filename: 'alert_capture.jpg',
                  content: Buffer.from(arrayBuf),
                  cid: 'captured_image@edgeguard',
                  contentType,
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
              cid: 'captured_image@edgeguard',
              contentType: 'image/jpeg',
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

        const imageBlock = hasImage
          ? '<img src="cid:captured_image@edgeguard" alt="Ảnh cảnh báo" style="display:block;width:100%;max-width:520px;margin:16px auto 0;border:1px solid #e5e7eb;border-radius:6px;" />'
          : imagePath && String(imagePath).startsWith('http')
            ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.45;"><a href="${escapeHtml(imagePath)}" style="color:#0f766e;text-decoration:underline;">Mở ảnh cảnh báo</a></p>`
            : '';

        const htmlContent = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
</head>
<body style="margin:0;padding:24px;background:#f6f7f9;color:#111827;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="padding:18px 20px;border-left:5px solid ${accentColor};border-bottom:1px solid #e5e7eb;">
      <h1 style="margin:0;font-size:18px;line-height:1.35;color:#111827;">EDGEGUARD SECURITY</h1>
    </div>
    <div style="padding:18px 20px 20px;">
      <p style="margin:0 0 10px;font-size:15px;line-height:1.45;"><span style="font-weight:700;color:#374151;">Mức độ:</span> <span style="color:${accentColor};font-weight:700;">${escapeHtml(severityText)}</span></p>
      <p style="margin:0 0 10px;font-size:15px;line-height:1.45;"><span style="font-weight:700;color:#374151;">Loại:</span> ${escapeHtml(alertType)}</p>
      <p style="margin:0 0 10px;font-size:15px;line-height:1.45;"><span style="font-weight:700;color:#374151;">Mô tả:</span> ${escapeHtml(alertMessage)}</p>
      <p style="margin:0 0 10px;font-size:15px;line-height:1.45;"><span style="font-weight:700;color:#374151;">Thời gian:</span> ${escapeHtml(formattedTime)}</p>
      ${imageBlock}
      <div style="margin-top:18px;">
        <a href="${escapeHtml(webAppUrl)}" style="display:inline-block;padding:10px 14px;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Mở EdgeGuard Telegram App</a>
      </div>
    </div>
    <div style="padding:14px 20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.45;">
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
          text: [
            'EDGEGUARD SECURITY',
            `Mức độ: ${severityText}`,
            `Loại: ${alertType}`,
            `Mô tả: ${alertMessage}`,
            `Thời gian: ${formattedTime}`,
            `Mở EdgeGuard Telegram App: ${webAppUrl}`,
            imagePath ? `Ảnh cảnh báo: ${imagePath}` : '',
          ].filter(Boolean).join('\n'),
          attachments: hasImage && attachmentOptions ? [attachmentOptions] : [],
        };

        console.log('[Email] Prepared alert email:', JSON.stringify({
          to: mailOptions.to,
          hasImage,
          hasButton: Boolean(webAppUrl),
          imageSource: typeof imagePath === 'string' && imagePath.startsWith('http') ? 'remote-url' : hasImage ? 'inline-data-or-file' : 'none',
        }));
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
