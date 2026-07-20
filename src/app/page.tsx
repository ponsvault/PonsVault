import Link from 'next/link';
import {
  ArrowRight,
  Coins,
  Rocket,
  Share2,
  Shield,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';

import { PONSSHARE_X_URL, XLogo } from '@/components/x-social-link';

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-hero-glow" aria-hidden="true" />
        <div className="home-container home-hero-inner">
          <p className="home-eyebrow">
            <Sparkles className="h-3.5 w-3.5" />
            Launch on pons · Share creator fees
          </p>
          <h1 className="home-title">
            Launch tokens on Robinhood Chain.
            <span className="home-title-accent"> Share fees with any X account.</span>
          </h1>
          <p className="home-lead">
            PonsShare is a non-custodial launch layer for pons — create tokens from your
            wallet, optionally route 70% creator fees to a Privy wallet tied to an X handle, and
            let them claim later.
          </p>
          <div className="home-actions">
            <Link href="/launch" className="home-btn home-btn-primary">
              Launch a token
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/explore" className="home-btn home-btn-secondary">
              Explore launches
            </Link>
            <Link href="/claim" className="home-btn home-btn-secondary">
              Claim fees
            </Link>
          </div>
          <dl className="home-stats">
            <div>
              <dt>Launch fee</dt>
              <dd>0.0005 ETH</dd>
            </div>
            <div>
              <dt>Creator share</dt>
              <dd>70%</dd>
            </div>
            <div>
              <dt>Graduation</dt>
              <dd>4.2 ETH</dd>
            </div>
            <div>
              <dt>Chain</dt>
              <dd>Robinhood · 4663</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="home-section">
        <div className="home-container">
          <div className="home-showcase">
            <div className="home-showcase-copy">
              <p className="home-section-label">Why PonsShare</p>
              <h2 className="home-section-title">
                Everything pons launches need — plus social fee routing.
              </h2>
              <p className="home-section-body">
                Use the same factory, metadata flow, and pool as pons. Add an
                optional fee-share wallet for collaborators, promoters, or creators who should
                earn on launch day without connecting a wallet first.
              </p>
              <ul className="home-checklist">
                <li>Token image upload via pons IPFS</li>
                <li>On-chain launch when pons APIs are blocked</li>
                <li>Privy pre-generated wallets per X handle</li>
                <li>Claim dashboard for fee recipients</li>
              </ul>
            </div>

            <div className="home-showcase-card" aria-hidden="true">
              <div className="home-mock-shell">
                <div className="home-mock-form">
                  <span className="home-mock-title">Launch token</span>
                  <div className="home-mock-row">
                    <span className="home-mock-field" />
                    <span className="home-mock-field" />
                  </div>
                  <span className="home-mock-field home-mock-field-wide" />
                  <span className="home-mock-upload" />
                  <span className="home-mock-share">
                    <Share2 className="h-3.5 w-3.5" />
                    Fee share → @creator
                  </span>
                  <span className="home-mock-btn">Launch token</span>
                </div>
                <div className="home-mock-preview">
                  <span className="home-mock-preview-title">Your token</span>
                  <span className="home-mock-preview-line">Launch fee · 0.0005</span>
                  <span className="home-mock-preview-line">Trading fees · 70% / 30%</span>
                  <span className="home-mock-preview-line">Graduation · 4.2 ETH</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-section-muted">
        <div className="home-container">
          <p className="home-section-label">How it works</p>
          <h2 className="home-section-title">Three steps from idea to shared fees.</h2>
          <div className="home-steps">
            <Step
              number="01"
              icon={Rocket}
              title="Launch on pons"
              body="Connect your wallet, upload artwork to IPFS, and sign launchToken on the pons factory."
            />
            <Step
              number="02"
              icon={Share2}
              title="Share with X"
              body="Optional: assign creator fees to an X handle. We pre-generate a Privy embedded wallet for them."
            />
            <Step
              number="03"
              icon={Coins}
              title="Claim later"
              body="The fee recipient logs in with X on the Claim page and accesses their launch history and wallet."
            />
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="home-container">
          <p className="home-section-label">Built for builders</p>
          <h2 className="home-section-title">Non-custodial by design.</h2>
          <div className="home-features">
            <Feature
              icon={Wallet}
              title="Wallet-native"
              body="Every launch is a transaction you sign. PonsShare never holds keys or funds."
            />
            <Feature
              icon={Users}
              title="Social fee split"
              body="Assign creator fees to an X-linked Privy wallet at launch time — recipients can claim later without connecting a wallet first."
            />
            <Feature
              icon={Shield}
              title="Resilient stack"
              body="Falls back to on-chain reads and the public Robinhood RPC when pons APIs are unreachable."
            />
          </div>
        </div>
      </section>

      <section className="home-cta">
        <div className="home-container home-cta-inner">
          <div>
            <h2 className="home-cta-title">Ready to launch?</h2>
            <p className="home-cta-body">
              Open the launchpad, connect your wallet on Robinhood Chain, and ship your token in
              minutes.
            </p>
          </div>
          <Link href="/launch" className="home-btn home-btn-primary">
            Open launchpad
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-container home-footer-inner">
          <div>
            <p className="home-footer-brand">PonsShare</p>
            <p className="home-footer-note">
              Unofficial layer on pons. Not affiliated with Pons Labs. Transactions are
              wallet-signed and may be irreversible.
            </p>
          </div>
          <nav className="home-footer-links" aria-label="Footer">
            <Link href="/launch">Launch</Link>
            <Link href="/explore">Explore</Link>
            <Link href="/claim">Claim</Link>
            <a href="https://ponsfamily.com" target="_blank" rel="noreferrer">
              pons
            </a>
            <a
              href={PONSSHARE_X_URL}
              target="_blank"
              rel="noreferrer"
              className="home-footer-x-link"
              aria-label="PonsShare on X"
            >
              <XLogo className="home-footer-x-icon" />
              @ponsshare
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function Step({
  number,
  icon: Icon,
  title,
  body,
}: {
  number: string;
  icon: typeof Rocket;
  title: string;
  body: string;
}) {
  return (
    <article className="home-step">
      <div className="home-step-top">
        <span className="home-step-number">{number}</span>
        <Icon className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
      </div>
      <h3 className="home-step-title">{title}</h3>
      <p className="home-step-body">{body}</p>
    </article>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Wallet;
  title: string;
  body: string;
}) {
  return (
    <article className="home-feature">
      <div className="home-feature-icon">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <h3 className="home-feature-title">{title}</h3>
      <p className="home-feature-body">{body}</p>
    </article>
  );
}
