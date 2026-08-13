'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollToId(id: string): boolean {
  if (!id) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
  return true;
}

function parseSameOriginHash(href: string): { pathname: string; hashId: string } | null {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    if (!url.hash || url.hash.length < 2) return null;
    return {
      pathname: url.pathname,
      hashId: decodeURIComponent(url.hash.slice(1)),
    };
  } catch {
    return null;
  }
}

/**
 * Site-wide smooth scroll for in-page anchors (#foo) and same-origin paths with
 * hashes (/docs#vault-seats), including Docs TOC and post-navigation hashes.
 */
export function HashScroll() {
  const pathname = usePathname();

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      // Plain #section on the current page
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        if (!id || !document.getElementById(id)) return;
        event.preventDefault();
        window.history.pushState(null, '', href);
        scrollToId(id);
        return;
      }

      const parsed = parseSameOriginHash(href);
      if (!parsed) return;

      // Already on this path — smooth scroll without a full navigation
      if (parsed.pathname === window.location.pathname) {
        if (!document.getElementById(parsed.hashId)) return;
        event.preventDefault();
        window.history.pushState(
          null,
          '',
          `${parsed.pathname}${window.location.search}#${encodeURIComponent(parsed.hashId)}`,
        );
        scrollToId(parsed.hashId);
      }
      // Cross-route hashes: let Next navigate; the pathname effect scrolls after paint.
    }

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));

    let cancelled = false;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      if (scrollToId(id) || attempts >= 40) return;
      attempts += 1;
      window.setTimeout(tryScroll, 40);
    };

    // Wait a frame so the new route has painted (Docs empty # targets, etc.).
    const raf = window.requestAnimationFrame(() => tryScroll());
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [pathname]);

  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash;
      if (!hash || hash.length < 2) return;
      scrollToId(decodeURIComponent(hash.slice(1)));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return null;
}
