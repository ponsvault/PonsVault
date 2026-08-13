import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { SeatsCreateForm } from '@/components/seats-create-form';
import { Reveal } from '@/components/ui/reveal';

export const metadata: Metadata = {
  title: 'Create a seat series · Vault Seats',
  description: 'Upload your art and launch a seat collection with a fuel token in one step.',
};

export default function SeatsCreatePage() {
  return (
    <main className="pv-page launchpad-create-page">
      <section className="pv-page-hero pv-launch-hero">
        <div className="pv-shell">
          <Link href="/seats" className="pv-back" aria-label="Back to Vault Seats">
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Back</span>
          </Link>

          <Reveal>
            <p className="pv-index">
              <span className="pv-badge pv-badge-live">Vault Seats</span>
              Create
            </p>
            <h1 className="pv-h1 pv-page-title">Create a seat series</h1>
            <p className="pv-body pv-measure pv-page-lead">
              Fill in a name, upload one picture for your seats, and choose how many seats you want.
              Your wallet creates everything in a single approval — no coding required.
            </p>
          </Reveal>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <div className="pv-shell pv-page-body">
        <Reveal delay={0.06}>
          <SeatsCreateForm />
        </Reveal>
      </div>
    </main>
  );
}
