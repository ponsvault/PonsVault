import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { LaunchForm } from '@/components/launch-form';

export const metadata: Metadata = {
  title: 'Launch a token · PonsShare',
  description: 'Launch a fixed-supply token on Robinhood Chain through the pons factory.',
};

export default function LaunchPage() {
  return (
    <main className="bridge-main">
      <div className="bridge-shell launchpad-create-page">
        <Link href="/explore" className="token-buy-back" aria-label="Back to Explore">
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          <span>Back</span>
        </Link>
        <LaunchForm />
      </div>
    </main>
  );
}
