export function createTelegramService(options) {
  const ready = Boolean(options.enabled && options.botToken && options.chatId);

  return {
    async sendImage(image) {
      if (!ready) {
        console.log(`[Telegram] Disabled. Image kept locally: ${image.filename}`);
        return { skipped: true, telegramMsgLink: null };
      }

      console.log(`[Telegram] Placeholder: pretending to send ${image.filename} to chat ${options.chatId}.`);
      // Return a placeholder link as requested
      const placeholderMessageId = Math.floor(Math.random() * 10000);
      return { 
        skipped: false, 
        telegramMsgLink: `https://t.me/c/${options.chatId.replace(/^-100/, '')}/${placeholderMessageId}` 
      };
    },
  };
}
