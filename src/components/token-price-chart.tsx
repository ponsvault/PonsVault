'use client';

import type { TokenDetailTrade } from '@/lib/pons/types';
import { formatUsd } from '@/lib/utils';

interface TokenPriceChartProps {
  trades: TokenDetailTrade[];
  currentPriceUsd: number;
}

export function TokenPriceChart({ trades, currentPriceUsd }: TokenPriceChartProps) {
  const points = trades
    .filter((trade) => trade.priceUsd != null && trade.timestamp > 0)
    .slice()
    .reverse();

  if (points.length < 2) {
    return (
      <div className="token-chart-empty">
        <p className="text-sm text-[var(--text-muted)]">
          Chart builds from recent on-chain swaps. Not enough trades yet.
        </p>
        {currentPriceUsd > 0 ? (
          <p className="mt-2 text-2xl font-medium text-[var(--text-primary)]">
            {formatUsd(currentPriceUsd, 6)}
          </p>
        ) : null}
      </div>
    );
  }

  const width = 640;
  const height = 220;
  const padding = 16;
  const prices = points.map((point) => point.priceUsd ?? currentPriceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || max * 0.05 || 1;

  const path = points
    .map((point, index) => {
      const x = padding + (index / (points.length - 1)) * (width - padding * 2);
      const y =
        height -
        padding -
        (((point.priceUsd ?? currentPriceUsd) - min) / range) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const firstPrice = prices[0] ?? currentPriceUsd;
  const lastPrice = prices[prices.length - 1] ?? currentPriceUsd;
  const changePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  return (
    <div className="token-chart">
      <div className="token-chart-header">
        <div>
          <p className="token-chart-label">Price</p>
          <p className="token-chart-price">{formatUsd(lastPrice, 6)}</p>
        </div>
        <p className={changePct >= 0 ? 'token-chart-change is-up' : 'token-chart-change is-down'}>
          {changePct >= 0 ? '+' : ''}
          {changePct.toFixed(2)}%
        </p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="token-chart-svg" aria-hidden>
        <defs>
          <linearGradient id="tokenChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(212, 252, 80, 0.28)" />
            <stop offset="100%" stopColor="rgba(212, 252, 80, 0)" />
          </linearGradient>
        </defs>
        <path
          d={`${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`}
          fill="url(#tokenChartFill)"
        />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      </svg>
    </div>
  );
}
