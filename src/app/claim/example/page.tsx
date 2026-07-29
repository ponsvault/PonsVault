import type { Metadata } from 'next';
import Link from 'next/link';

import { MigrationClaimDemo } from '@/components/migration-claim-demo';
import { Reveal } from '@/components/ui/reveal';
import { PONSVAULT_GITHUB_URL } from '@/components/x-social-link';

export const metadata: Metadata = {
  title: 'Example migration claim · PonsVault',
  description:
    'Example of a custom token distribution page for a migration onto Pons. Holders connect their wallet and claim their allocation from a verified Merkle claim contract.',
};

const STEPS = [
  {
    title: 'Snapshot',
    body: 'We take a snapshot of every holder of the old token at a fixed block.',
  },
  {
    title: 'Allocate',
    body: 'Each wallet gets a fixed share of the new token. That list becomes a Merkle tree on-chain.',
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
            <p className="pv-index">Token distribution · Example</p>
            <h1 className="pv-h1 mig-title">Claim your EXAMPLE tokens.</h1>
            <p className="pv-body mig-lead">
              A custom distribution page for a migration onto Pons. We snapshot
              holders, generate allocations, and fund a verified open-source claim
              contract. Your community connects and claims — no airdrop spreadsheet.
            </p>
            <p className="mig-example-tag">
              This page is a walkthrough for projects evaluating a migration. Nothing
              here is live on-chain.
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
            <MigrationClaimDemo />
          </Reveal>

          <Reveal delay={0.06}>
            <section className="mig-meta">
              <h2 className="mig-meta-title">What your community would see</h2>
              <ul className="mig-meta-list">
                <li>
                  <span>Old token</span>
                  <strong>NOXA</strong>
                </li>
                <li>
                  <span>New token</span>
                  <strong>EXAMPLE</strong>
                </li>
                <li>
                  <span>Ratio</span>
                  <strong>1 : 1</strong>
                </li>
                <li>
                  <span>Snapshot</span>
                  <strong>Block · example</strong>
                </li>
                <li>
                  <span>Claim contract</span>
                  <strong className="mig-mono">Verified · open source</strong>
                </li>
                <li>
                  <span>Deadline</span>
                  <strong>90 days after launch</strong>
                </li>
              </ul>
            </section>
          </Reveal>
        </div>

        <aside className="mig-aside">
          <Reveal delay={0.08}>
            <p className="mig-aside-label">How a live migration works</p>
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
                The claim contract is fully verified and open source — same standard
                as the rest of PonsVault. Anyone can inspect the code on GitHub and
                the bytecode on the explorer.
              </p>
              <div className="mig-aside-links">
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
