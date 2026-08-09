'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Coins, Flame, Rocket } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { Reveal } from '@/components/ui/reveal';
import { fetchRecentLaunches } from '@/lib/pons/api';
import type { PonsLaunchRecord, VaultStat } from '@/lib/pons/types';
import { VAULT_TEMPLATES } from '@/lib/pons/vault';
import { cn, formatUsd, ipfsToGateway } from '@/lib/utils';

type ExploreSort = 'newest' | 'marketcap';

function sortLaunches(launches: PonsLaunchRecord[], sort: ExploreSort): PonsLaunchRecord[] {
  if (sort === 'newest') return launches;

  return [...launches].sort((a, b) => {
    const aCap = a.marketCapUsd ?? 0;
    const bCap = b.marketCapUsd ?? 0;
    if (bCap !== aCap) return bCap - aCap;
    // Stable fallback when market data is missing.
    return (b.launchedAt ?? '').localeCompare(a.launchedAt ?? '');
  });
}

/** Compact token count: 14391858.74 → "14.4M". */
function formatCompact(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return '0';
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(0);
}

function templateName(id: string | null | undefined): string | null {
  return VAULT_TEMPLATES.find((entry) => entry.id === id)?.name ?? null;
}

const VAULT_STAT_VERB: Record<VaultStat['kind'], string> = {
  burn: 'burned',
  stake: 'staked',
  dividend: 'paid out',
  prize: 'won',
};

const VAULT_STAT_IDLE: Record<VaultStat['kind'], string> = {
  burn: 'Nothing burned yet',
  stake: 'Nobody staked yet',
  dividend: 'No dividend paid yet',
  prize: 'No raffle paid yet',
};

export function ExploreGrid() {
  const [sort, setSort] = useState<ExploreSort>('newest');
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['ponsvault-launches'],
    queryFn: fetchRecentLaunches,
    refetchInterval: 20_000,
  });

  const launches = useMemo(() => sortLaunches(data, sort), [data, sort]);

  if (isLoading) {
    return (
      <div className="pv-explore-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="pv-skeleton-card" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="pv-error" style={{ marginBottom: 80 }}>
        <span>Could not load launches right now.</span>
        <button type="button" className="pv-error-retry" onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="pv-empty" style={{ marginBottom: 80 }}>
        <span className="pv-empty-icon">
          <Rocket className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <p className="pv-empty-title">No launches yet</p>
        <p className="pv-empty-body">
          Nothing has been launched through PonsVault V2 so far. Be the first token with a vault
          attached from block one.
        </p>
        <Link href="/launch" className="pv-btn pv-btn-primary">
          Launch the first one
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="pv-explore">
      <div className="pv-explore-toolbar" role="group" aria-label="Sort launches">
        <button
          type="button"
          className={cn('pv-explore-sort', sort === 'newest' && 'is-active')}
          onClick={() => setSort('newest')}
          aria-pressed={sort === 'newest'}
        >
          Newest
        </button>
        <button
          type="button"
          className={cn('pv-explore-sort', sort === 'marketcap' && 'is-active')}
          onClick={() => setSort('marketcap')}
          aria-pressed={sort === 'marketcap'}
        >
          Highest market cap
        </button>
      </div>

      <div className="pv-explore-grid">
      {launches.map((launch, index) => {
        const progress = launch.graduationProgressPct ?? 0;
        const template = templateName(launch.vaultTemplate);
        const stat = launch.vaultStat;
        const statAmount = stat ? Number(stat.amount) : 0;

        return (
          <Reveal key={launch.token} delay={Math.min(index, 5) * 0.04}>
            <article className="pv-token-card">
              <Link href={`/launchpad/${launch.token}`} className="pv-token-link">
                <div className="pv-token-head">
                  <div className="pv-token-logo">
                    {launch.logo ? (
                      <Image
                        src={ipfsToGateway(launch.logo)}
                        alt={launch.name}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="pv-token-logo-fallback">
                        {launch.symbol?.slice(0, 2).toUpperCase() ?? '??'}
                      </span>
                    )}
                  </div>

                  <div className="pv-token-names">
                    <h2 className="pv-token-name">{launch.name}</h2>
                    <p className="pv-token-symbol">${launch.symbol}</p>
                  </div>

                  <span
                    className={cn('pv-token-status', launch.graduated && 'pv-token-status-live')}
                  >
                    {launch.graduated ? 'Graduated' : 'Climbing'}
                  </span>
                </div>

                <p className="pv-token-desc">{launch.description}</p>

                {template ? (
                  <div className="pv-token-vault">
                    <span className="pv-token-vault-template">{template}</span>
                    {stat && statAmount > 0 ? (
                      <span className="pv-token-vault-burn">
                        {stat.kind === 'burn' ? (
                          <Flame className="h-3 w-3" strokeWidth={2} />
                        ) : (
                          <Coins className="h-3 w-3" strokeWidth={2} />
                        )}
                        {formatCompact(stat.amount)} {stat.unit ?? launch.symbol}{' '}
                        {VAULT_STAT_VERB[stat.kind]}
                        {/* A dividend is paid in a stock, so a share of this
                            token's supply would be a meaningless number. */}
                        {stat.unit ? null : ` · ${stat.percent.toFixed(2)}%`}
                      </span>
                    ) : (
                      <span className="pv-token-vault-idle">
                        {VAULT_STAT_IDLE[stat?.kind ?? 'burn']}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="pv-token-vault">
                    <span className="pv-token-vault-none">No vault · fees go to the creator</span>
                  </div>
                )}

                <dl className="pv-token-stats">
                  <div>
                    <dt>Price</dt>
                    <dd>{formatUsd(launch.priceUsd, 6)}</dd>
                  </div>
                  <div>
                    <dt>Market cap</dt>
                    <dd>{formatUsd(launch.marketCapUsd, 0)}</dd>
                  </div>
                  <div>
                    <dt>Graduation</dt>
                    <dd>
                      {launch.graduationProgressPct != null ? `${progress.toFixed(0)}%` : '—'}
                    </dd>
                  </div>
                </dl>

                <div className="pv-token-progress">
                  <div
                    className="pv-token-progress-fill"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>

                <div className="pv-token-foot">
                  <span>View token</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            </article>
          </Reveal>
        );
      })}
      </div>
    </div>
  );
}
