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
    return { title: 'Token · PonsShare' };
  }

  try {
    const metadata = await readTokenOnchainMetadata(token as Address);
    return {
      title: `${metadata.name} (${metadata.symbol}) · PonsShare`,
      description: metadata.description || `Trade ${metadata.name} on Robinhood Chain through PonsShare.`,
    };
  } catch {
    return { title: 'Token · PonsShare' };
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
    <main className="bridge-main">
      <TokenDetail token={token as Address} />
    </main>
  );
}
