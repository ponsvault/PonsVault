'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight, Flame } from 'lucide-react';

import { SHOWCASE_VAULT_TOKEN } from '@/lib/pons/showcase-vault';

/**
 * Live $VAULT control surface — same data as the hero, denser layout.
 */

interface ShowcaseRun {
  time: string;
  label: string;
  value: string;
  unit: string;
  burn: boolean;
}

interface ShowcaseResponse {
  symbol: string;
  pairSymbol: string;
  burnBps: number;
  treasuryBps: number;
  minHarvest: string;
  pending: string;
  totalBurned: string;
  canRun: boolean;
  runs: ShowcaseRun[];
  href: string;
}

async function fetchShowcase(): Promise<ShowcaseResponse> {
  const response = await fetch('/api/vault/showcase');
  if (!response.ok) throw new Error('Could not load $VAULT stats.');
  return response.json();
}

export function VaultPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['showcase-vault'],
    queryFn: fetchShowcase,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const symbol = data?.symbol ?? SHOWCASE_VAULT_TOKEN.symbol;
  const pair = data?.pairSymbol ?? SHOWCASE_VAULT_TOKEN.pairSymbol;
  const href = data?.href ?? `/launchpad/${SHOWCASE_VAULT_TOKEN.token}`;
  const burnPercent = data ? data.burnBps / 100 : null;

  const config: [string, string][] = [
    ['Template', 'Buyback & Burn'],
    ['Pair', pair],
    ['Burn share', burnPercent != null ? `${burnPercent}%` : '…'],
    ['Buys every', data ? `${data.minHarvest} ${pair} in fees` : '…'],
  ];

  const activity =
    data?.runs.map((run) => ({
      time: run.time,
      label: run.label === 'Bought' ? 'Bought back' : run.label,
      value: `${run.value} ${run.unit}`,
      burn: run.burn,
    })) ??
    (isLoading
      ? [{ time: '…', label: 'Loading', value: '…', burn: false }]
      : [
          {
            time: '—',
            label: 'Burned',
            value: `${data?.totalBurned ?? '—'} ${symbol}`,
            burn: true,
          },
        ]);

  return (
    <div className="pv-panel vault-panel">
      <div className="pv-panel-bar">
        <div className="pv-panel-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="pv-panel-bar-label">vault · ${symbol}</span>
        <span className="pv-badge">Live</span>
        <span className={`pv-badge ${data?.canRun ? 'pv-badge-live' : ''} vault-panel-live`}>
          {data?.canRun ? (
            <>
              <span className="pv-dot pv-pulse-dot" />
              Ready
            </>
          ) : (
            <>
              <span className="pv-dot" />
              Active
            </>
          )}
        </span>
      </div>

      <div className="vault-panel-body">
        <section className="vault-panel-col">
          <header className="vault-panel-col-head">
            <span>Configuration</span>
            <span className="pv-badge">Immutable</span>
          </header>
          <dl className="vault-panel-rows">
            {config.map(([label, value]) => (
              <div key={label} className="vault-panel-row">
                <dt>{label}</dt>
                <dd className="pv-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="vault-panel-col">
          <header className="vault-panel-col-head">
            <span>Recent runs</span>
            <span className="pv-mono vault-panel-count">
              {data ? `${data.totalBurned} burned` : '…'}
            </span>
          </header>
          <ul className="vault-panel-activity">
            {activity.map((item, index) => (
              <li key={index}>
                <span className="pv-mono vault-panel-time">{item.time}</span>
                <span className="vault-panel-label">
                  {item.burn ? <Flame className="h-3 w-3" strokeWidth={2} /> : null}
                  {item.label}
                </span>
                <span className="pv-mono vault-panel-value">{item.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="vault-panel-foot">
        <div className="vault-panel-pending">
          <span className="vault-panel-pending-label">Pending fees</span>
          <span className="pv-mono vault-panel-pending-value">
            {data ? `${data.pending} ${pair}` : '…'}
          </span>
        </div>
        <div className="vault-panel-actions">
          <span className="vault-panel-hint">Callable by anyone</span>
          <Link href={href} className="pv-btn pv-btn-primary">
            Open vault
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
