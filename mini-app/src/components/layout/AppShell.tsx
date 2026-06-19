'use client';

import { useEffect, useState } from 'react';
import { BottomNav } from './BottomNav';
import { DesktopSidebar } from './DesktopSidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    const frameId = window.requestAnimationFrame(checkDesktop);
    window.addEventListener('resize', checkDesktop);

    const tg = window.Telegram?.WebApp;
    if (tg) {
      document.documentElement.setAttribute('data-theme', tg.colorScheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', checkDesktop);
    };
  }, []);

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
