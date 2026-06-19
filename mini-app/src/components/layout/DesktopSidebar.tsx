'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeFilledIcon, LogFilledIcon, SettingsFilledIcon, ShieldFilledIcon } from '@/components/icons/FilledIcons';

const navItems = [
  { href: '/', icon: HomeFilledIcon, label: 'Giám sát' },
  { href: '/logs', icon: LogFilledIcon, label: 'Lịch sử' },
  { href: '/settings', icon: SettingsFilledIcon, label: 'Cài đặt' },
];

export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="desktop-sidebar" id="desktop-sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon"><ShieldFilledIcon size={21} /></div>
        <span className="sidebar-logo-text">EdgeGuard</span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
            >
              <span className="sidebar-item-icon"><Icon size={20} /></span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <span className="status-dot status-dot-ok" />
        <span>Secure AIoT</span>
      </div>
    </aside>
  );
}
