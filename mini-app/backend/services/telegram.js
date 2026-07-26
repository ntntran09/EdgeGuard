import fs from 'fs';

export function createTelegramService(options) {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
  const ready = Boolean(options.enabled !== false && botToken && chatId);

  return {
    async sendMessage(text) {
      if (!ready) {
        console.log('[Telegram] Disabled or missing credentials.');
        return { skipped: true };
      }

      try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
          }),
        });

        const data = await res.json();
        if (!data.ok) {
          console.error('[Telegram] Error:', data.description);
          return { success: false, error: data.description };
        }

        return { success: true, data };
      } catch (err) {
        console.error('[Telegram] Fetch error:', err.message);
        return { success: false, error: err.message };
      }
    },

    async sendImage(imagePath, caption = '') {
      if (!ready) {
        console.log(`[Telegram] Disabled or missing config.`);
        return { skipped: true };
      }

      try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        if (caption) formData.append('caption', caption);

        if (typeof imagePath === 'string') {
          if (!fs.existsSync(imagePath)) {
            console.error(`[Telegram] File image not found: ${imagePath}`);
            return { success: false, error: 'File not found' };
          }
          const fileBuffer = fs.readFileSync(imagePath);
          const file = new File([fileBuffer], 'image.jpg', { type: 'image/jpeg' });
          formData.append('photo', file);
        } else {
          formData.append('photo', imagePath, 'image.jpg');
        }

        const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
        const res = await fetch(url, {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (!data.ok) {
          console.error('[Telegram] Error sendPhoto:', data.description);
          return { success: false, error: data.description };
        }

        console.log('[Telegram] Send image successfully!');
        return { success: true, data };
      } catch (err) {
        console.error('[Telegram] Fetch error sendPhoto:', err.message);
        return { success: false, error: err.message };
      }
    },
  };
}
