import fs from 'fs';

function normalizeChatId(value) {
  const chatId = String(value || '').trim();
  return /^-?\d+$/.test(chatId) ? chatId : null;
}

function uniqueChatIds(chatIds) {
  return [...new Set((chatIds || []).map(normalizeChatId).filter(Boolean))];
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createTelegramService(options = {}) {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
  const enabled = options.enabled !== false;
  let cachedBotUsername = options.botUsername || null;

  async function getBotUsername() {
    if (cachedBotUsername) return cachedBotUsername;
    if (!enabled || !botToken) return null;

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
  }

  async function getBotLink() {
    const username = await getBotUsername();
    return username ? `https://t.me/${username}` : 'https://t.me';
  }

  async function sendMessage(text, targetChatId = chatId) {
    const normalizedChatId = normalizeChatId(targetChatId);
    if (!enabled || !botToken || !normalizedChatId) {
      console.log('[Telegram] Disabled or missing credentials.');
      return { skipped: true };
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: normalizedChatId,
          text,
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
  }

  async function sendImage(imagePath, caption = '', targetChatId = chatId) {
    const normalizedChatId = normalizeChatId(targetChatId);
    if (!enabled || !botToken || !normalizedChatId) {
      console.log('[Telegram] Disabled or missing config.');
      return { skipped: true };
    }

    try {
      const formData = new FormData();
      formData.append('chat_id', normalizedChatId);
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'Markdown');
      }

      if (typeof imagePath === 'string') {
        if (imagePath.startsWith('data:image/')) {
          const base64Data = imagePath.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const file = new File([buffer], 'alert.jpg', { type: 'image/jpeg' });
          formData.append('photo', file);
        } else if (isHttpUrl(imagePath)) {
          formData.append('photo', imagePath);
        } else if (fs.existsSync(imagePath)) {
          const fileBuffer = fs.readFileSync(imagePath);
          const file = new File([fileBuffer], 'alert.jpg', { type: 'image/jpeg' });
          formData.append('photo', file);
        } else {
          return sendMessage(caption, normalizedChatId);
        }
      } else if (imagePath) {
        formData.append('photo', imagePath, 'alert.jpg');
      } else {
        return sendMessage(caption, normalizedChatId);
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
  }

  async function sendImageToChats(chatIds, imagePath, caption = '') {
    const recipients = uniqueChatIds(chatIds);
    if (!recipients.length) {
      console.log('[Telegram] No notification recipients.');
      return { skipped: true, results: [] };
    }

    const results = [];
    for (const recipientChatId of recipients) {
      let result = await sendImage(imagePath, caption, recipientChatId);
      if (!result?.success && !result?.skipped) {
        await wait(750);
        result = await sendImage(imagePath, caption, recipientChatId);
      }
      results.push(result);
    }

    return {
      success: results.some((result) => result?.success),
      results,
    };
  }

  return {
    getBotUsername,
    getBotLink,
    sendMessage,
    sendImage,
    sendImageToChats,
  };
}
