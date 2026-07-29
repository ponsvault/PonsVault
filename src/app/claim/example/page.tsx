import type { Metadata } from 'next';
import Link from 'next/link';

import { MigrationClaimDemo } from '@/components/migration-claim-demo';
import { Reveal } from '@/components/ui/reveal';
import { PONSVAULT_GITHUB_URL } from '@/components/x-social-link';
import { explorerAddressUrl, shortAddress } from '@/lib/utils';

const OLD_TOKEN = 'MEOW';
const NEW_TOKEN = 'MEOW';
const OLD_CA = '0x2e9c3B1C6E7703D1784b2B8F80ef4e99D76b3E56';
const PROJECT_X = 'https://x.com/tigerincmeow';

export const metadata: Metadata = {
  title: `$${NEW_TOKEN} migration claim · PonsVault`,
  description: `Claim page example for the $${OLD_TOKEN} → $${NEW_TOKEN} migration onto Pons. Holders connect their wallet and claim their allocation from a verified Merkle claim contract.`,
};

const STEPS = [
  {
    title: 'Snapshot',
    body: `We take a snapshot of every $${OLD_TOKEN} holder at a fixed block on the old contract.`,
  },
  {
    title: 'Allocate',
    body: `Each wallet gets a fixed share of the new $${NEW_TOKEN}. That list becomes a Merkle tree on-chain.`,
  },
  {
    title: 'Claim',
    body: 'Holders connect here and claim themselves. No manual airdrops, no sending to hundreds of wallets.',
  },
] as const;

export default function ExampleClaimPage() {
  return (
    <main className="mig">
      <section className="mig-hero">
        <div className="pv-shell mig-hero-inner">
          <Reveal>
            <p className="pv-index">
              Token distribution ·{' '}
              <a href={PROJECT_X} target="_blank" rel="noreferrer">
                @tigerincmeow
              </a>
            </p>
            <h1 className="pv-h1 mig-title">{`Claim your $${NEW_TOKEN}.`}</h1>
            <p className="pv-body mig-lead">
              {`Migration of $${OLD_TOKEN} onto Pons. We snapshot holders of the old token, generate 1:1 allocations, and fund a verified open-source claim contract. Connect the wallet that held $${OLD_TOKEN} and claim the new $${NEW_TOKEN} yourself.`}
            </p>
            <p className="mig-example-tag">
              {`This page is a walkthrough for the $${NEW_TOKEN} community. Claims here are simulated — nothing is live on-chain yet.`}
            </p>
          </Reveal>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <div className="pv-shell mig-layout">
        <div className="mig-main">
          <Reveal>
            <MigrationClaimDemo symbol={NEW_TOKEN} />
          </Reveal>

          <Reveal delay={0.06}>
            <section className="mig-meta">
              <h2 className="mig-meta-title">Migration details</h2>
              <div className="mig-meta-pair">
                <div className="mig-meta-side">
                  <span>Old token</span>
                  <strong>{`$${OLD_TOKEN}`}</strong>
                  <span className="mig-meta-sub">Old contract</span>
                  <a
                    className="mig-mono mig-ca"
                    href={explorerAddressUrl(OLD_CA)}
                    target="_blank"
                    rel="noreferrer"
                    title={OLD_CA}
                  >
                    {shortAddress(OLD_CA)}
                  </a>
                </div>
                <div className="mig-meta-side">
                  <span>New token</span>
                  <strong>{`$${NEW_TOKEN}`}</strong>
                  <span className="mig-meta-sub">New contract</span>
                  <span className="mig-mono mig-ca-pending">Published after deploy</span>
                </div>
              </div>
              <ul className="mig-meta-list">
                <li>
                  <span>Claim contract</span>
                  <strong className="mig-mono">Verified · open source</strong>
                </li>
                <li>
                  <span>Community</span>
                  <strong>
                    <a href={PROJECT_X} target="_blank" rel="noreferrer">
                      @tigerincmeow
                    </a>
                  </strong>
                </li>
              </ul>
            </section>
          </Reveal>
        </div>

        <aside className="mig-aside">
          <Reveal delay={0.08}>
            <p className="mig-aside-label">How this migration works</p>
            <ol className="mig-steps">
              {STEPS.map((step, i) => (
                <li key={step.title}>
                  <span className="mig-step-n">{i + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mig-aside-trust">
              <p>
                The claim contract is fully verified and open source — same standard as
                the rest of PonsVault. Anyone can inspect the code on GitHub and the
                bytecode on the explorer.
              </p>
              <div className="mig-aside-links">
                <a href={PROJECT_X} target="_blank" rel="noreferrer">
                  X · @tigerincmeow
                </a>
                <a href={PONSVAULT_GITHUB_URL} target="_blank" rel="noreferrer">
                  GitHub
                </a>
                <Link href="/docs">Docs</Link>
              </div>
            </div>
          </Reveal>
        </aside>
      </div>
    </main>
  );
}
