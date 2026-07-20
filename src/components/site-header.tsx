'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ConnectButton } from '@/components/connect-button';
import { XSocialLink } from '@/components/x-social-link';
import { cn } from '@/lib/utils';

const links = [
  { href: '/', label: 'Home' },
  { href: '/explore', label: 'Explore' },
  { href: '/launch', label: 'Launch' },
  { href: '/claim', label: 'Claim' },
  { href: '/docs', label: 'Docs' },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="nav">
      <div className="nav-inner">
        <div className="nav-left">
          <Link href="/" className="nav-brand-text">
            PonsShare
          </Link>
        </div>

        <nav className="nav-product-links nav-product-links-center" aria-label="Product">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'nav-product-link',
                (link.href === '/'
                  ? pathname === '/'
                  : pathname === link.href) && 'is-active',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="nav-right">
          <XSocialLink />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
