'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { fetchRecentLaunches } from '@/lib/pons/api';
import { ponsTokenUrl } from '@/lib/pons/launch';
import { cn, ipfsToGateway } from '@/lib/utils';

export function ExploreGrid() {
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['ponsshare-launches'],
    queryFn: fetchRecentLaunches,
    refetchInterval: 20_000,
  });

  if (isLoading) {
    return <p className="text-sm text-zinc-400">Loading recent launches…</p>;
  }

  if (isError) {
    return (
      <div className="launchpad-alert">
        Failed to load launches.{' '}
        <button type="button" className="underline" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] p-6">
        <p className="text-sm text-[var(--text-muted)]">
          No tokens launched through PonsShare yet.
        </p>
        <Link href="/launch" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">
          Launch the first one →
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.map((launch) => (
        <article
          key={launch.token}
          className="rounded-3xl border border-white/10 bg-zinc-950/70 p-4 transition hover:border-lime-300/30"
        >
          <div className="flex items-start gap-3">
            <div className="relative h-12 w-12 overflow-hidden rounded-xl bg-zinc-800">
              {launch.logo ? (
                <Image
                  src={ipfsToGateway(launch.logo)}
                  alt={launch.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold text-white">{launch.name}</h2>
              <p className="text-sm text-zinc-400">{launch.symbol}</p>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs',
                launch.graduated
                  ? 'bg-lime-300/15 text-lime-300'
                  : 'bg-zinc-800 text-zinc-400',
              )}
            >
              {launch.graduated ? 'Graduated' : 'Climbing'}
            </span>
          </div>

          <p className="mt-3 line-clamp-2 text-sm text-zinc-500">{launch.description}</p>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-zinc-400">
              {launch.marketCapUsd != null
                ? `$${launch.marketCapUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} mcap`
                : 'Mcap pending'}
            </span>
            <div className="flex gap-3">
              <Link href={`/launchpad/${launch.token}`} className="text-lime-300 hover:underline">
                Trade here
              </Link>
              <a
                href={ponsTokenUrl(launch.token)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-white"
              >
                pons <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
