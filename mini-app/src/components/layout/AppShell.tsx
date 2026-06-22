'use client';

import { useEffect, useState } from 'react';
import { BottomNav } from './BottomNav';
import { DesktopSidebar } from './DesktopSidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);

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
    } else {
      // Dev fallback: check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', checkDesktop);
    };
  }, []);

  if (!mounted) {
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
