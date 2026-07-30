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

async function attachmentFromImage(imagePath, cid) {
  if (typeof imagePath !== 'string') return { attachment: null, hasImage: false };

  if (imagePath.startsWith('data:image/')) {
    const contentType = imagePath.match(/^data:(image\/[\w.+-]+);base64,/)?.[1] || 'image/jpeg';
    const base64Data = imagePath.replace(/^data:image\/[\w.+-]+;base64,/, '');
    return {
      hasImage: true,
      attachment: {
        filename: 'alert_capture.jpg',
        content: Buffer.from(base64Data, 'base64'),
        cid,
        contentType,
        contentDisposition: 'inline',
      },
    };
  }

  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    try {
      const response = await fetch(imagePath);
      if (!response.ok) return { attachment: null, hasImage: false };
      return {
        hasImage: true,
        attachment: {
          filename: 'alert_capture.jpg',
          content: Buffer.from(await response.arrayBuffer()),
          cid,
          contentType: response.headers.get('content-type') || 'image/jpeg',
          contentDisposition: 'inline',
        },
      };
    } catch (error) {
      console.warn('[Email] Failed to fetch remote image for attachment:', error.message);
      return { attachment: null, hasImage: false };
    }
  }

  if (fs.existsSync(imagePath)) {
    return {
      hasImage: true,
      attachment: {
        filename: 'alert_capture.jpg',
        path: imagePath,
        cid,
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
      },
    };
  }

  return { attachment: null, hasImage: false };
}

function severityLabel(severity) {
  if (severity === 'danger') return 'Nguy hiểm';
  if (severity === 'warning') return 'Cảnh báo';
  return 'Thông báo';
}

function severityColor(severity) {
  if (severity === 'danger') return '#dc2626';
  if (severity === 'warning') return '#d97706';
  return '#2563eb';
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
        const inlineImageCid = 'captured_image@edgeguard';
        const { attachment: attachmentOptions, hasImage } = await attachmentFromImage(imagePath, inlineImageCid);
        const severity = String(alertInfo.severity || 'danger').toLowerCase();
        const accentColor = severityColor(severity);
        const severityText = severityLabel(severity);
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
        const imageUrl = typeof imagePath === 'string' && imagePath.startsWith('http') ? imagePath : '';

        const buttonBlock = webAppUrl ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;">
        <tr>
          <td bgcolor="#111827" style="border-radius:6px;">
            <a href="${escapeHtml(webAppUrl)}" target="_blank" style="display:block;padding:12px 16px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;line-height:1.2;">Mở EdgeGuard Telegram App</a>
          </td>
        </tr>
      </table>` : '';

        const imageBlock = hasImage ? `
      <a href="${escapeHtml(imageUrl || webAppUrl)}" style="display:block;margin:18px 0 0;text-decoration:none;">
        <img src="cid:${inlineImageCid}" alt="Ảnh cảnh báo" width="520" style="display:block;width:100%;max-width:520px;height:auto;margin:0 auto;border:1px solid #e5e7eb;border-radius:6px;" />
      </a>` : '';

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
      ${buttonBlock}
      ${imageBlock}
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
          imageSource: imageUrl ? 'inline-cid-from-remote-url' : hasImage ? 'inline-data-or-file' : 'none',
        }));
        const info = await transporter.sendMail(mailOptions);
        console.log('[Email] Sent alert email successfully to:', mailOptions.to, info.messageId);
        return { success: true, info };
      } catch (error) {
        console.error('[Email] Failed to send alert email:', error.message);
        return { success: false, error: error.message };
      }
    },
  };
}
