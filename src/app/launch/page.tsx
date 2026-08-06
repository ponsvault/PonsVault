import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { LaunchForm } from '@/components/launch-form';
import { Reveal } from '@/components/ui/reveal';

export const metadata: Metadata = {
  title: 'Launch a token · PonsVault V2',
  description:
    'Launch on the open pons v2 factory with a PonsVault attached — pair against stocks or USDG, choose Buyback & Burn or Staking.',
};

export default function LaunchPage() {
  return (
    <main className="pv-page">
      <section className="pv-page-hero pv-launch-hero">
        <div className="pv-shell">
          <Link href="/explore" className="pv-back" aria-label="Back to Explore">
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Back</span>
          </Link>

          <Reveal>
            <p className="pv-index">
              <span className="pv-badge pv-badge-live">V2</span>
              PonsVault
            </p>
            <h1 className="pv-h1 pv-page-title">Launch your token</h1>
            <p className="pv-body pv-measure pv-page-lead">
              Open pons v2 factory on Robinhood Chain. Pick a pairing asset, attach a vault to your
              creator fees, and sign from your own wallet.
            </p>
          </Reveal>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <div className="pv-shell pv-page-body">
        <Reveal delay={0.06}>
          <LaunchForm />
        </Reveal>
      </div>
    </main>
  );
}
