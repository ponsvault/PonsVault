'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';

import { listSeatSeries } from '@/lib/seats/read';
import { isSeatInfraConfigured } from '@/lib/seats/deployments';

export function SeatsGrid() {
  const configured = isSeatInfraConfigured();
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['pons-seat-series'],
    queryFn: listSeatSeries,
    enabled: configured,
    refetchInterval: 20_000,
  });

  if (!configured) {
    return (
      <div className="pv-empty" style={{ marginBottom: 80 }}>
        <p className="pv-empty-title">Vault Seats isn’t live yet</p>
        <p className="pv-empty-body">
          The on-chain shop for seat series still needs to be connected. Check back soon, or ask the
          team if you’re testing a local build.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="pv-explore-grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="pv-skeleton-card" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="pv-error" style={{ marginBottom: 80 }}>
        <span>Could not load seat series.</span>
        <button type="button" className="pv-error-retry" onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="pv-empty" style={{ marginBottom: 80 }}>
        <p className="pv-empty-title">No series yet</p>
        <p className="pv-empty-body">
          Be the first — upload a picture, set how many seats you want, and create your series in
          one step.
        </p>
        <Link href="/seats/create" className="pv-btn pv-btn-primary">
          Create a series
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="pv-explore-grid">
      {data.map((series) => (
        <article key={series.seriesId} className="pv-token-card">
          <Link href={`/seats/${series.seriesId}`} className="pv-token-link">
            <div className="pv-token-head">
              <div className="pv-token-logo">
                <span className="pv-token-logo-fallback">
                  {series.symbol.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="pv-token-names">
                <h2 className="pv-token-name">{series.name}</h2>
                <p className="pv-token-symbol">${series.symbol}</p>
              </div>
              <span className="pv-token-status">Open</span>
            </div>
            <p className="pv-token-desc">
              {series.maxSupply} seats · buy with fuel token · earn from the fee pot
            </p>
            <div className="pv-token-vault">
              <span className="pv-token-vault-template">Vault Seats</span>
            </div>
          </Link>
        </article>
      ))}
    </div>
  );
}
