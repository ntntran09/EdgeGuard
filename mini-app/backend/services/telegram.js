import fs from 'fs';

export function createTelegramService(options = {}) {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
  const ready = Boolean(options.enabled !== false && botToken && chatId);
  let cachedBotUsername = options.botUsername || null;

  return {
    async getBotUsername() {
      if (cachedBotUsername) return cachedBotUsername;
      if (!ready) return null;
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = await res.json();
        if (data.ok && data.result?.username) {
          cachedBotUsername = data.result.username;
          return cachedBotUsername;
        }
      } catch (err) {
        console.error('[Telegram] Failed to fetch bot info via getMe:', err.message);
      }
      return null;
    },

    async getBotLink() {
      const username = await this.getBotUsername();
      return username ? `https://t.me/${username}` : 'https://t.me';
    },

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
          if (imagePath.startsWith('data:image/')) {
            const base64Data = imagePath.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const file = new File([buffer], 'alert.jpg', { type: 'image/jpeg' });
            formData.append('photo', file);
          } 
          else if (fs.existsSync(imagePath)) {
            const fileBuffer = fs.readFileSync(imagePath);
            const file = new File([fileBuffer], 'alert.jpg', { type: 'image/jpeg' });
            formData.append('photo', file);
          } else {
            return this.sendMessage(caption);
          }
        } else if (imagePath) {
          formData.append('photo', imagePath, 'alert.jpg');
        } else {
          return this.sendMessage(caption);
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
