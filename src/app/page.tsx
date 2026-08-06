'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

import { HeroProduct } from '@/components/hero-product';
import { Reveal } from '@/components/ui/reveal';
import { PONSVAULT_GITHUB_URL, PONSVAULT_X_URL } from '@/components/x-social-link';

export default function HomePage() {
  return (
    <main className="pv-home">
      <Hero />
      <LogoStrip />
      <Features />
      <HowItWorks />
      <Templates />
      <FinalCta />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section className="pv-hero">
      <div className="pv-hero-glow" aria-hidden="true" />
      <div className="pv-hero-grid" aria-hidden="true" />

      <div className="pv-shell pv-hero-inner">
        <div className="pv-hero-copy">
          <Reveal y={10}>
            <p className="pv-hero-kicker">
              <span className="pv-dot pv-pulse-dot" />
              Live on pons v2
              <span className="pv-hero-kicker-sep" />
              Robinhood Chain
            </p>
          </Reveal>

          <Reveal delay={0.05} y={16}>
            <h1 className="pv-hero-title">
              <span className="pv-hero-brand">
                PonsVault
                <span className="pv-hero-v2"> V2</span>
              </span>
              <span className="pv-hero-line">Launch tokens with a vault attached.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.1} y={12}>
            <div className="pv-hero-subrow">
              <p className="pv-hero-lead">
                Creator fees land in your pairing asset. The contract spends them on buybacks or
                staking — every time, without an operator.
              </p>
              <div className="pv-hero-actions">
                <Link href="/launch" className="pv-btn pv-btn-primary pv-btn-lg">
                  Start a launch
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link href="/docs" className="pv-link pv-hero-docs">
                  Read the docs
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="pv-hero-stage">
          <HeroProduct />
        </div>
      </div>

      <div className="pv-hero-fade" aria-hidden="true" />
    </section>
  );
}

const STRIP = ['AAPL', 'NVDA', 'TSLA', 'GOOGL', 'GME', 'SPY', 'SPCX', 'USDG'];

function LogoStrip() {
  return (
    <section className="pv-strip" aria-label="Supported pairing assets">
      <div className="pv-shell">
        <Reveal>
          <p className="pv-strip-label">Pair against approved assets</p>
          <ul className="pv-strip-list">
            {STRIP.map((symbol, i) => (
              <Reveal key={symbol} delay={i * 0.03} as="li">
                <span className="pv-strip-item">{symbol}</span>
              </Reveal>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    title: 'Fees become a rule',
    body: 'Instead of paying a wallet, creator fees pay a vault that buys, burns, or rewards — on terms fixed at launch.',
  },
  {
    title: 'Open pons v2 factory',
    body: 'Anyone can launch. Pair against tokenized stocks or USDG. Native ETH is not approved by pons yet.',
  },
  {
    title: 'Permissionless runs',
    body: 'Anyone can trigger a vault once fees build up. No operator keys. No quiet off-switch.',
  },
];

function Features() {
  return (
    <section className="pv-section pv-features">
      <div className="pv-shell">
        <Reveal>
          <p className="pv-eyebrow">Why PonsVault</p>
          <h2 className="pv-h2 pv-section-title">A vault layer for pons launches.</h2>
        </Reveal>

        <div className="pv-feature-grid">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 0.06}>
              <article className="pv-feature">
                <span className="pv-feature-num">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="pv-h3">{feature.title}</h3>
                <p className="pv-body-sm">{feature.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'Pick a pair & vault',
    body: 'Choose an approved quote asset and either Buyback & Burn or Staking.',
  },
  {
    title: 'Launch in one tx',
    body: 'We deploy the token through pons v2, create the vault, and route fees to it.',
  },
  {
    title: 'It runs itself',
    body: 'Trading accrues fees. Anyone can press run — or our keeper does it for you.',
  },
];

function HowItWorks() {
  return (
    <section className="pv-section pv-how">
      <div className="pv-shell">
        <Reveal>
          <p className="pv-eyebrow">How it works</p>
          <h2 className="pv-h2 pv-section-title">Three steps. One signature.</h2>
        </Reveal>

        <ol className="pv-how-grid">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} as="li" delay={index * 0.06}>
              <span className="pv-how-num">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="pv-h3">{step.title}</h3>
              <p className="pv-body-sm">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

const TEMPLATES = [
  {
    name: 'Buyback & Burn',
    status: 'live' as const,
    body: 'Fees buy your token and burn it. Leave a treasury share for the rest — 100% burn waits on a buyback helper.',
  },
  {
    name: 'Staking',
    status: 'live' as const,
    body: 'Holders stake your token and earn creator fees in the pairing asset, pro rata.',
  },
  {
    name: 'Lottery',
    status: 'soon' as const,
    body: 'Fees fill a pot. Holders enter. A commit–reveal draw pays one wallet.',
  },
  {
    name: 'RWA Dividend',
    status: 'soon' as const,
    body: 'Fees buy a tokenized stock. Holders claim by balance — no staking.',
  },
];

function Templates() {
  return (
    <section className="pv-section pv-templates">
      <div className="pv-shell">
        <Reveal>
          <div className="pv-section-head">
            <div>
              <p className="pv-eyebrow">Templates</p>
              <h2 className="pv-h2 pv-section-title">Two live today. More next.</h2>
            </div>
            <Link href="/launch" className="pv-link pv-section-link">
              Launch with a vault
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Reveal>

        <div className="pv-tpl-grid">
          {TEMPLATES.map((template, index) => (
            <Reveal key={template.name} delay={index * 0.05}>
              <article className={template.status === 'soon' ? 'pv-tpl is-soon' : 'pv-tpl'}>
                <div className="pv-tpl-head">
                  <h3 className="pv-h3">{template.name}</h3>
                  {template.status === 'live' ? (
                    <span className="pv-badge pv-badge-live">
                      <span className="pv-dot" />
                      Live
                    </span>
                  ) : (
                    <span className="pv-badge">Soon</span>
                  )}
                </div>
                <p className="pv-body-sm pv-tpl-body">{template.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="pv-cta">
      <div className="pv-shell">
        <Reveal>
          <div className="pv-cta-card">
            <div>
              <h2 className="pv-h2">Ready when you are.</h2>
              <p className="pv-body pv-cta-body">
                Connect on Robinhood Chain, pick a pairing asset, and launch with a vault attached.
              </p>
            </div>
            <Link href="/launch" className="pv-btn pv-btn-primary pv-btn-lg">
              Open launchpad
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FOOTER_LINKS: {
  heading: string;
  links: { label: string; href: string; external?: boolean }[];
}[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Launch', href: '/launch' },
      { label: 'Explore', href: '/explore' },
      { label: 'Docs', href: '/docs' },
    ],
  },
  {
    heading: 'PonsVault',
    links: [
      { label: 'X', href: PONSVAULT_X_URL, external: true },
      { label: 'GitHub', href: PONSVAULT_GITHUB_URL, external: true },
    ],
  },
  {
    heading: 'Ecosystem',
    links: [
      { label: 'pons docs', href: 'https://docs.ponsfamily.com/v2', external: true },
      { label: 'Robinhood Chain', href: 'https://robinhood.com', external: true },
    ],
  },
];

function Footer() {
  return (
    <footer className="pv-footer">
      <div className="pv-shell">
        <div className="pv-footer-top">
          <div className="pv-footer-brand">
            <div className="pv-brand">
              <span className="pv-brand-text">PonsVault</span>
              <span className="pv-v2-mark">V2</span>
            </div>
            <p className="pv-body-sm pv-footer-tagline">
              Vaults for the open pons v2 factory. Independent of pons and Robinhood.
            </p>
          </div>
          <div className="pv-footer-cols">
            {FOOTER_LINKS.map((column) => (
              <div key={column.heading}>
                <h3 className="pv-footer-heading">{column.heading}</h3>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a href={link.href} target="_blank" rel="noreferrer" className="pv-link">
                          {link.label}
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <Link href={link.href} className="pv-link">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="pv-footer-bottom">
          <span className="pv-body-sm">PonsVault V2</span>
          <span className="pv-body-sm">Unaudited software. Launching a token risks total loss.</span>
        </div>
      </div>
    </footer>
  );
}
