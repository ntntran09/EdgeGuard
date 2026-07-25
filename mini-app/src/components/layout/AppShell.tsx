'use client';

import { useEffect, useState } from 'react';
import { BottomNav } from './BottomNav';
import { DesktopSidebar } from './DesktopSidebar';
import type { TelegramWebApp } from '@/types';

interface AppShellProps {
  children: React.ReactNode;
}

type TelegramAuthState = 'checking' | 'authenticated' | 'denied';

const telegramAuthRequired = process.env.NEXT_PUBLIC_TELEGRAM_AUTH_REQUIRED === 'true';

function postTelegramAuthDebug(reason: string, tg?: TelegramWebApp | null, details: { status?: number; error?: string } = {}) {
  const platform = typeof (tg as TelegramWebApp & { platform?: unknown } | null | undefined)?.platform === 'string'
    ? (tg as TelegramWebApp & { platform?: string }).platform
    : null;
  void fetch('/api/auth/debug', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      reason,
      href: window.location.href,
      tgExists: Boolean(tg),
      initDataLength: tg?.initData?.length || 0,
      platform,
      status: details.status ?? null,
      error: details.error ?? null,
    }),
  }).catch(() => {});
}

export function AppShell({ children }: AppShellProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [authState, setAuthState] = useState<TelegramAuthState>(
    telegramAuthRequired ? 'checking' : 'authenticated'
  );
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    const frameId = window.requestAnimationFrame(() => {
      checkDesktop();
      setMounted(true);
    });
    window.addEventListener('resize', checkDesktop);
    
    // Apply Telegram theme
    const tg = window.Telegram?.WebApp;
    if (tg) {
      const scheme = tg.colorScheme;
      document.documentElement.setAttribute('data-theme', scheme);
      tg.ready();
      tg.expand();
    } else {
      // Dev fallback: check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }

    if (telegramAuthRequired) {
      const initData = tg?.initData;
      if (!initData) {
        queueMicrotask(() => {
          postTelegramAuthDebug('missing_init_data', tg);
          setAuthMessage('HÃ£y má»Ÿ dashboard báº±ng nÃºt Mini App trong bot Telegram Ä‘Ã£ cáº¥u hÃ¬nh.');
          setAuthState('denied');
        });
      } else {
        void fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ initData }),
        }).then(async (response) => {
          if (!response.ok) {
            const data = await response.json().catch(() => null) as { error?: string } | null;
            const message = data?.error || 'Telegram authentication failed.';
            postTelegramAuthDebug('auth_response_not_ok', tg, { status: response.status, error: message });
            setAuthMessage(message);
            setAuthState('denied');
            return;
          }
          setAuthState('authenticated');
        }).catch((error: unknown) => {
          postTelegramAuthDebug('auth_request_failed', tg, { error: error instanceof Error ? error.message : 'unknown_error' });
          setAuthMessage(error instanceof Error ? error.message : 'KhÃ´ng thá»ƒ xÃ¡c thá»±c Telegram.');
          setAuthState('denied');
        });
      }
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', checkDesktop);
    };
  }, []);

  if (!mounted || authState === 'checking') {
    return (
      <div className="app-content">
        <main className="page-container">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
            <div className="loading-spinner" style={{ width: 32, height: 32, borderWidth: 3, borderColor: 'var(--hint)', borderTopColor: 'var(--accent-primary)' }} />
          </div>
        </main>
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className="app-content">
        <main className="page-container">
          <section className="bento-card" style={{ maxWidth: 480, margin: '15vh auto', textAlign: 'center' }}>
            <h1 className="text-heading-2">KhÃ´ng cÃ³ quyá»n truy cáº­p</h1>
            <p style={{ color: 'var(--hint)', marginTop: 12 }}>{authMessage}</p>
          </section>
        </main>
      </div>
    );
  }
  return (
    <>
      {isDesktop && <DesktopSidebar />}
      <div className="app-content">
        <main className="page-container animate-fade-in">
          {children}
        </main>
      </div>
      {!isDesktop && <BottomNav />}
    </>
  );
}

