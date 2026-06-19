'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TelegramUser, TelegramWebApp } from '@/types';

export function useTelegram() {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      setWebApp(tg);
      setUser(tg.initDataUnsafe?.user || null);
      setColorScheme(tg.colorScheme || 'light');
      setIsReady(true);
    } else {
      // Development fallback when not in Telegram
      setUser({
        id: 123456789,
        first_name: 'Developer',
        last_name: 'Mode',
        username: 'dev_user',
      });
      setColorScheme(
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      );
      setIsReady(true);
    }
  }, []);

  const hapticFeedback = useCallback(
    (type: 'impact' | 'notification' | 'selection', style?: string) => {
      if (!webApp?.HapticFeedback) return;
      switch (type) {
        case 'impact':
          webApp.HapticFeedback.impactOccurred(
            (style as 'light' | 'medium' | 'heavy') || 'medium'
          );
          break;
        case 'notification':
          webApp.HapticFeedback.notificationOccurred(
            (style as 'error' | 'success' | 'warning') || 'success'
          );
          break;
        case 'selection':
          webApp.HapticFeedback.selectionChanged();
          break;
      }
    },
    [webApp]
  );

  return { webApp, user, colorScheme, isReady, hapticFeedback };
}
