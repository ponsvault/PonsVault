import type { Metadata } from 'next';

import { ClaimDashboard } from '@/components/claim-dashboard';

export const metadata: Metadata = {
  title: 'Claim fees · PonsShare',
  description: 'Claim creator fees from tokens launched with social fee sharing.',
};

export default function ClaimPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <ClaimDashboard />
    </main>
  );
}
