import type { Metadata } from 'next';
import { isAddress, type Address } from 'viem';
import { notFound } from 'next/navigation';

import { TokenDetail } from '@/components/token-detail';
import { readTokenOnchainMetadata } from '@/lib/pons/token-state';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;

  if (!isAddress(token)) {
    return { title: 'Token · PonsVault' };
  }

  try {
    const metadata = await readTokenOnchainMetadata(token as Address);
    return {
      title: `${metadata.name} (${metadata.symbol}) · PonsVault`,
      description: metadata.description || `Trade ${metadata.name} on Robinhood Chain through PonsVault.`,
    };
  } catch {
    return { title: 'Token · PonsVault' };
  }
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isAddress(token)) {
    notFound();
  }

  return (
    <main className="bridge-main pv-token-page">
      <TokenDetail token={token as Address} />
    </main>
  );
}
