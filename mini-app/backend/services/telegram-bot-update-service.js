function startRegistrationFromUpdate(update) {
  const message = update?.message;
  const from = message?.from;
  if (!message || message.chat?.type !== 'private' || !from || from.is_bot) return null;
  if (typeof message.text !== 'string' || !/^\/start(?:@\w+)?(?:\s|$)/i.test(message.text.trim())) {
    return null;
  }

  const telegramId = String(from.id ?? '').trim();
  if (!/^-?\d+$/.test(telegramId)) return null;

  const firstName = typeof from.first_name === 'string' ? from.first_name.trim() : '';
  const lastName = typeof from.last_name === 'string' ? from.last_name.trim() : '';
  const username = typeof from.username === 'string' ? from.username.trim() : '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ')
    || (username ? `@${username}` : 'Người dùng Telegram');

  return {
    chatId: String(message.chat.id),
    telegramId,
    displayName: displayName.slice(0, 160),
    username,
    languageCode: typeof from.language_code === 'string' ? from.language_code : null,
  };
}

async function telegramRequest(botToken, method, body, signal, fetchImpl) {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram ${method} failed with HTTP ${response.status}`);
  }
  return payload.result;
}

function waitBeforeRetry(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isTelegramPollingConflict(error) {
  return /terminated by other getUpdates request|only one bot instance/i.test(errorMessage(error));
}

export { startRegistrationFromUpdate, isTelegramPollingConflict };

export function createTelegramBotUpdateService(options) {
  const {
    enabled,
    botToken,
    deviceId,
    supabaseService,
    pollingTimeoutSeconds = 25,
    pollingConflictBackoffSeconds = 60,
    fetchImpl = fetch,
  } = options;
  let running = false;
  let controller = null;
  let loopPromise = null;
  let offset = 0;
  let conflictBackoffLogged = false;

  async function sendMessage(chatId, text) {
    await telegramRequest(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }, controller?.signal, fetchImpl);
  }

  async function processUpdate(update) {
    const registration = startRegistrationFromUpdate(update);
    if (!registration) return;

    try {
      await supabaseService.upsertTelegramBotUser({
        deviceId,
        telegramId: registration.telegramId,
        displayName: registration.displayName,
      });
      console.log(`[Telegram Bot] Registered /start from Telegram ID ${registration.telegramId}.`);
      await sendMessage(
        registration.chatId,
        '✅ EdgeGuard đã ghi nhận tài khoản của bạn. Quản trị viên sẽ cấp quyền truy cập dashboard khi phù hợp.'
      );
    } catch (error) {
      console.error('[Telegram Bot] Could not register /start:', error instanceof Error ? error.message : error);
      try {
        await sendMessage(
          registration.chatId,
          '⚠️ EdgeGuard chưa thể lưu tài khoản lúc này. Vui lòng thử lại /start sau.'
        );
      } catch (sendError) {
        console.error('[Telegram Bot] Could not send registration error:', sendError instanceof Error ? sendError.message : sendError);
      }
    }
  }

  async function pollLoop() {
    while (running) {
      try {
        const updates = await telegramRequest(botToken, 'getUpdates', {
          offset,
          timeout: pollingTimeoutSeconds,
          allowed_updates: ['message'],
        }, controller.signal, fetchImpl);

        for (const update of Array.isArray(updates) ? updates : []) {
          await processUpdate(update);
          if (Number.isInteger(update?.update_id)) offset = update.update_id + 1;
        }
      } catch (error) {
        if (!running || controller.signal.aborted) break;

        if (isTelegramPollingConflict(error)) {
          if (!conflictBackoffLogged) {
            console.warn(
              `[Telegram Bot] Another getUpdates poller is active. This instance will pause Telegram polling for ${pollingConflictBackoffSeconds}s and keep the dashboard running.` 
            );
            conflictBackoffLogged = true;
          }
          await waitBeforeRetry(pollingConflictBackoffSeconds * 1000);
          continue;
        }

        conflictBackoffLogged = false;
        console.error('[Telegram Bot] Polling failed:', errorMessage(error));
        await waitBeforeRetry(3000);
      }
    }
  }

  return {
    start() {
      if (running) return;
      if (!enabled) {
        console.log('[Telegram Bot] Update polling disabled.');
        return;
      }
      if (!botToken) {
        console.warn('[Telegram Bot] Missing TELEGRAM_BOT_TOKEN; update polling disabled.');
        return;
      }

      running = true;
      controller = new AbortController();
      loopPromise = pollLoop();
      console.log('[Telegram Bot] Listening for /start updates.');
    },

    async stop() {
      if (!running) return;
      running = false;
      controller?.abort();
      await loopPromise?.catch(() => {});
      controller = null;
      loopPromise = null;
    },
  };
}