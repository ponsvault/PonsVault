'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ConnectButton } from '@/components/connect-button';
import { XSocialLink } from '@/components/x-social-link';
import { cn } from '@/lib/utils';

const links = [
  { href: '/', label: 'Home' },
  { href: '/explore', label: 'Explore' },
  { href: '/launch', label: 'Launch' },
  { href: '/docs', label: 'Docs' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cn('nav', scrolled && 'is-scrolled')}>
      <div className="nav-inner">
        <div className="nav-left">
          <Link href="/" className="pv-brand" aria-label="PonsVault home">
            <span className="pv-brand-mark">P</span>
            <span className="pv-brand-text">PonsVault</span>
          </Link>
        </div>

        <nav className="nav-product-links nav-product-links-center" aria-label="Product">
          {links.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn('nav-product-link', active && 'is-active')}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="nav-right">
          <XSocialLink />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
