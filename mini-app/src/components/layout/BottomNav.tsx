'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeFilledIcon, LogFilledIcon, SettingsFilledIcon } from '@/components/icons/FilledIcons';

const navItems = [
  { href: '/', icon: HomeFilledIcon, label: 'Giám sát' },
  { href: '/logs', icon: LogFilledIcon, label: 'Lịch sử' },
  { href: '/settings', icon: SettingsFilledIcon, label: 'Cài đặt' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" id="bottom-navigation">
      {navItems.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            aria-label={item.label}
          >
            <span className="bottom-nav-icon"><Icon size={23} /></span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
