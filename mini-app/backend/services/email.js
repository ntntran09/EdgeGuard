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
    async sendImage(imagePath, caption = '', subject = 'EdgeGuard Alert Capture') {
      if (!ready) {
        console.log('[Email] Disabled or missing config.');
        return { skipped: true };
      }

      try {
        let attachmentOptions = {};

        if (typeof imagePath === 'string' && imagePath.startsWith('data:image/')) {
          const base64Data = imagePath.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          attachmentOptions = {
            filename: 'alert_image.jpg',
            content: buffer,
            cid: 'captured_image',
          };
        } 
        else if (typeof imagePath === 'string' && fs.existsSync(imagePath)) {
          attachmentOptions = {
            filename: 'alert_image.jpg',
            path: imagePath,
            cid: 'captured_image',
          };
        } 
        else {
          console.warn('[Email] Invalid or missing image path/data URL.');
        }

        const mailOptions = {
          from: `"EdgeGuard System" <${user}>`,
          to: receiver,
          subject: subject,
          html: `<div style="font-family: Arial, sans-serif; padding: 15px;">
                  <h2 style="color: #d9534f;">EdgeGuard Alert Notification</h2>
                  <p>${caption ? caption.replace(/\n/g, '<br>') : ''}</p>
                  ${
                    attachmentOptions.filename
                      ? '<img src="cid:captured_image" style="max-width: 100%; border-radius: 8px;" />'
                      : ''
                  }
                 </div>`,
          attachments: attachmentOptions.filename ? [attachmentOptions] : [],
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('[Email] Send alert image successfully:', info.messageId);
        return { success: true, info };
      } catch (err) {
        console.error('[Email] Fetch error sendImage:', err.message);
        return { success: false, error: err.message };
      }
    },
  };
}