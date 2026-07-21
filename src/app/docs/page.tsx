import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Lock, Shield, Share2, Wallet } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Docs · PonsShare',
  description:
    'What PonsShare solves, how social fee sharing works, and why we use Privy for secure login.',
};

export default function DocsPage() {
  return (
    <main className="docs-page">
      <div className="docs-container">
        <header className="docs-hero">
          <p className="docs-eyebrow">Docs</p>
          <h1 className="docs-title">What PonsShare solves</h1>
          <p className="docs-lead">
            PonsShare is a non-custodial launch layer for{' '}
            <a href="https://ponsfamily.com" target="_blank" rel="noreferrer">
              pons
            </a>{' '}
            on Robinhood Chain. It adds social fee routing on top of the same on-chain factory — without
            changing how tokens launch or trade.
          </p>
        </header>

        <section className="docs-section">
          <h2>The problem</h2>
          <p>
            On pons, the wallet that launches a token usually receives the creator share of trading fees
            (70% on current factory launches). That works when the launcher and the person who should
            earn are the same.
          </p>
          <p>It breaks down when you want to:</p>
          <ul className="docs-list">
            <li>Launch a token for a creator, promoter, or collaborator</li>
            <li>Route creator fees to a specific wallet at launch time</li>
            <li>
              Assign fees to an X or GitHub handle before that person has connected a wallet on-chain
            </li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>What we built</h2>
          <div className="docs-cards">
            <article className="docs-card">
              <Share2 className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
              <h3>Social fee sharing</h3>
              <p>
                At launch, set <code>feeWallet</code> on the pons factory call. Pons routes both the
                developer buy tokens and creator trading fees to that wallet in the same transaction.
              </p>
            </article>
            <article className="docs-card">
              <Wallet className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
              <h3>Same pons launch flow</h3>
              <p>
                Your wallet signs <code>launchToken()</code> on the active pons factory. Tokens trade in
                the same WETH pools with the same graduation rules.
              </p>
            </article>
            <article className="docs-card">
              <Lock className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
              <h3>Claim when ready</h3>
              <p>
                Fee recipients log in on <Link href="/claim">/claim</Link>, see launches linked to their
                handle, and claim creator fees on-chain when they are ready.
              </p>
            </article>
          </div>
        </section>

        <section className="docs-section">
          <h2>How fee sharing works</h2>
          <ol className="docs-steps">
            <li>
              <strong>Launch</strong> — connect your wallet on{' '}
              <Link href="/launch">/launch</Link>, upload token metadata, and optionally assign creator
              fees to another wallet or social handle.
            </li>
            <li>
              <strong>Register</strong> — PonsShare records the launch and, for social sharing, creates or
              reuses a fee wallet for that handle.
            </li>
            <li>
              <strong>Trade</strong> — the token trades on pons like any other launch. Creator fees accrue
              to the configured payout address.
            </li>
            <li>
              <strong>Claim</strong> — the fee recipient signs in, confirms ownership of the handle, and
              claims fees via the pons locker&apos;s <code>collectFees(token)</code> call.
            </li>
          </ol>
        </section>

        <section className="docs-section docs-section-highlight">
          <h2>Important: pons fee wallet behavior</h2>
          <p>
            When you assign a fee wallet at launch, pons sends <strong>both</strong> the developer buy
            tokens and future creator trading fees to that address. You pay the dev buy ETH from your
            launcher wallet, but the tokens land with the fee recipient.
          </p>
          <p className="docs-note">
            Want to launch without giving dev buy tokens to someone else? Leave developer buy at 0, or
            launch without fee sharing and keep the default payout on your wallet.
          </p>
        </section>

        <section className="docs-section docs-section-highlight">
          <div className="docs-highlight-header">
            <Shield className="h-5 w-5 text-[var(--accent)]" strokeWidth={1.75} />
            <h2>Why we use Privy for login</h2>
          </div>
          <p>
            The <Link href="/claim">Claim</Link> page uses{' '}
            <a href="https://www.privy.io" target="_blank" rel="noreferrer">
              Privy
            </a>{' '}
            for X and GitHub login instead of rolling our own auth. That keeps identity verification
            safe, standard, and auditable.
          </p>
          <ul className="docs-list">
            <li>
              <strong>OAuth, not passwords</strong> — recipients sign in with X or GitHub through
              Privy&apos;s hosted flow. PonsShare never stores social passwords.
            </li>
            <li>
              <strong>Verified handles</strong> — only the account that owns the handle can link to the
              fee wallet assigned at launch.
            </li>
            <li>
              <strong>Persistent sessions</strong> — Privy keeps you signed in securely across visits so
              recipients do not need to log in every time.
            </li>
            <li>
              <strong>Wallet linking on first login</strong> — when a handle logs in for the first time,
              their pre-generated fee wallet is linked to their Privy account.
            </li>
            <li>
              <strong>Export stays gated</strong> — private keys for social fee wallets can only be
              exported by the Privy account that owns the linked handle.
            </li>
          </ul>
          <p className="docs-note">
            PonsShare will never ask for your seed phrase. Launches always require your own wallet
            signature — Privy is used for fee-recipient identity on <code>/claim</code>, not for
            custodial control of launch funds.
          </p>
        </section>

        <section className="docs-section">
          <h2>What stays non-custodial</h2>
          <ul className="docs-list">
            <li>Launches are signed by your connected wallet — we never hold launch ETH or tokens.</li>
            <li>Fee claims happen on-chain through the pons locker contract.</li>
            <li>Token metadata, pools, and fee routing live on Robinhood Chain.</li>
            <li>PonsShare is an interface layer — not a new protocol or custodial launchpad.</li>
          </ul>
        </section>

        <section className="docs-section">
          <h2>Pages</h2>
          <div className="docs-links">
            <Link href="/launch" className="docs-link-row">
              <span>Launch a token</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/explore" className="docs-link-row">
              <span>Explore PonsShare launches</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/claim" className="docs-link-row">
              <span>Claim creator fees</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <footer className="docs-footer">
          <p>
            Unofficial layer on pons. Not affiliated with Pons Labs or Privy. Review token addresses and
            transaction previews before signing.
          </p>
        </footer>
      </div>
    </main>
  );
}
