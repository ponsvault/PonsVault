'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Flame } from 'lucide-react';

import { SHOWCASE_VAULT_TOKEN } from '@/lib/pons/showcase-vault';

/**
 * Hero product stage — live $VAULT vault stats, not a caption under a mock.
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
  runCount: string;
  totalBurned: string;
  canRun: boolean;
  runs: ShowcaseRun[];
  float: { title: string; body: string };
  href: string;
  error?: string;
}

async function fetchShowcase(): Promise<ShowcaseResponse> {
  const response = await fetch('/api/vault/showcase');
  if (!response.ok) throw new Error('Could not load $VAULT stats.');
  return response.json();
}

export function HeroProduct() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['showcase-vault'],
    queryFn: fetchShowcase,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const symbol = data?.symbol ?? SHOWCASE_VAULT_TOKEN.symbol;
  const pair = data?.pairSymbol ?? SHOWCASE_VAULT_TOKEN.pairSymbol;
  const burnPercent = data ? data.burnBps / 100 : null;
  const treasuryPercent = data ? data.treasuryBps / 100 : null;
  const href = data?.href ?? `/launchpad/${SHOWCASE_VAULT_TOKEN.token}`;
  const live = data?.canRun ?? false;

  const runs: ShowcaseRun[] =
    data?.runs && data.runs.length > 0
      ? data.runs
      : [
          {
            time: '—',
            label: 'Burned',
            value: data?.totalBurned ?? (isLoading ? '…' : '—'),
            unit: symbol,
            burn: true,
          },
          {
            time: '—',
            label: 'Runs',
            value: data?.runCount ?? (isLoading ? '…' : '0'),
            unit: 'total',
            burn: false,
          },
        ];

  return (
    <div className="hero-product">
      <div className="hero-product-shell">
        <aside className="hero-product-side" aria-hidden="true">
          <div className="hero-product-brand">
            <span className="pv-brand-mark">P</span>
            <span>PonsVault</span>
          </div>
          <nav className="hero-product-nav">
            <span className="is-active">Vault</span>
            <span>Launch</span>
            <span>Explore</span>
            <span>Docs</span>
          </nav>
          <div className="hero-product-side-meta">
            <span>Pair</span>
            <strong>{pair}</strong>
          </div>
        </aside>

        <div className="hero-product-main">
          <header className="hero-product-top">
            <div>
              <p className="hero-product-kicker">Buyback &amp; Burn</p>
              <h3>
                <Link href={href} className="hero-product-token-link">
                  ${symbol}
                </Link>
              </h3>
            </div>
            <span className={`pv-badge ${live ? 'pv-badge-live' : ''}`}>
              {live ? (
                <>
                  <span className="pv-dot pv-pulse-dot" />
                  Ready
                </>
              ) : isError ? (
                'Offline'
              ) : (
                <>
                  <span className="pv-dot" />
                  Active
                </>
              )}
            </span>
          </header>

          <div className="hero-product-stats">
            <div>
              <span>Burn share</span>
              <strong>{burnPercent != null ? `${burnPercent}%` : '…'}</strong>
            </div>
            <div>
              <span>Treasury</span>
              <strong>{treasuryPercent != null ? `${treasuryPercent}%` : '…'}</strong>
            </div>
            <div>
              <span>Pending</span>
              <strong className="pv-mono">
                {data ? `${data.pending} ${pair}` : '…'}
              </strong>
            </div>
            <div>
              <span>Threshold</span>
              <strong className="pv-mono">
                {data ? `${data.minHarvest} ${pair}` : '…'}
              </strong>
            </div>
          </div>

          <div className="hero-product-runs">
            <div className="hero-product-runs-head">
              <span>Recent runs</span>
              <span className="pv-mono">
                {data ? `${data.totalBurned} burned` : isLoading ? '…' : '—'}
              </span>
            </div>
            <ul>
              {runs.map((run, index) => (
                <li key={`${run.time}-${run.label}-${run.value}-${index}`}>
                  <span className="pv-mono">{run.time}</span>
                  <span className="hero-product-run-label">
                    {run.burn ? <Flame className="h-3 w-3" strokeWidth={2} /> : null}
                    {run.label}
                  </span>
                  <span className="pv-mono">
                    {run.value} <em>{run.unit}</em>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <footer className="hero-product-foot">
            <span>Callable by anyone · no operator keys</span>
            <Link href={href} className="pv-btn pv-btn-primary hero-product-cta">
              Open vault
            </Link>
          </footer>
        </div>
      </div>

      <aside className="hero-product-float" aria-hidden="true">
        <span className="pv-dot pv-pulse-dot" />
        <div>
          <strong>{data?.float.title ?? 'Loading vault…'}</strong>
          <p>
            {data?.float.body ??
              (isLoading ? `Reading $${symbol} from chain…` : `$${symbol} on Robinhood Chain`)}
          </p>
        </div>
      </aside>
    </div>
  );
}
