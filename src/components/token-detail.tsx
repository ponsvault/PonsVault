'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Globe, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { Address } from 'viem';

import { TokenCreatorFeesPanel } from '@/components/token-creator-fees-panel';
import { TokenPriceChart } from '@/components/token-price-chart';
import { TokenVaultPanel } from '@/components/token-vault-panel';
import { fetchTokenDetail } from '@/lib/pons/api';
import { txUrl } from '@/lib/pons/launch';
import {
  cn,
  explorerAddressUrl,
  formatRelativeTime,
  formatUsd,
  ipfsToGateway,
  shortAddress,
} from '@/lib/utils';

interface TokenDetailProps {
  token: Address;
}

function socialUrl(kind: string, value: string): string | null {
  const trimmed = value.trim().replace(/^@/, '');
  if (!trimmed) return null;
  if (kind === 'twitter') return `https://x.com/${trimmed}`;
  if (kind === 'telegram') return `https://t.me/${trimmed}`;
  if (kind === 'website') return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  if (kind === 'farcaster') return `https://warpcast.com/${trimmed}`;
  return null;
}

export function TokenDetail({ token }: TokenDetailProps) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['token-detail', token],
    queryFn: () => fetchTokenDetail(token),
    refetchInterval: 20_000,
  });

  if (isLoading) {
    return (
      <div className="bridge-shell token-detail-page">
        <p className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading token…
        </p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bridge-shell token-detail-page">
        <Link href="/explore" className="token-buy-back">
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          <span>Back</span>
        </Link>
        <div className="launchpad-alert mt-6">
          {error instanceof Error ? error.message : 'Failed to load token.'}{' '}
          <button type="button" className="underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const socialLinks = [
    { key: 'website', label: 'Website', href: socialUrl('website', data.metadata.socials.website) },
    { key: 'twitter', label: 'X', href: socialUrl('twitter', data.metadata.socials.twitter) },
    { key: 'telegram', label: 'Telegram', href: socialUrl('telegram', data.metadata.socials.telegram) },
    { key: 'farcaster', label: 'Farcaster', href: socialUrl('farcaster', data.metadata.socials.farcaster) },
  ].filter((link) => link.href);

  return (
    <div className="bridge-shell token-detail-page">
      <div className="token-detail-topbar">
        <Link href="/explore" className="token-buy-back">
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          <span>Back</span>
        </Link>
      </div>

      <div className="token-detail-shell token-detail-shell-single">
        <section className="token-detail-main">
          <header className="token-detail-header">
            <div className="token-detail-identity">
              <div className="token-detail-logo">
                {data.metadata.logo ? (
                  <Image
                    src={ipfsToGateway(data.metadata.logo)}
                    alt={data.metadata.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : null}
              </div>
              <div>
                <div className="token-detail-title-row">
                  <h1 className="split-shell-title">{data.metadata.name}</h1>
                  <span
                    className={cn(
                      'token-detail-badge',
                      data.graduation.graduated ? 'is-graduated' : 'is-climbing',
                    )}
                  >
                    {data.graduation.graduated ? 'Graduated' : 'Climbing'}
                  </span>
                </div>
                <p className="token-detail-symbol">${data.metadata.symbol}</p>
              </div>
            </div>

            <div className="token-detail-stats">
              <div>
                <p className="token-stat-label">Price</p>
                <p className="token-stat-value">{formatUsd(data.market.priceUsd, 6)}</p>
              </div>
              <div>
                <p className="token-stat-label">Market cap</p>
                <p className="token-stat-value">{formatUsd(data.market.marketCapUsd, 0)}</p>
              </div>
              <div>
                <p className="token-stat-label">FDV</p>
                <p className="token-stat-value">{formatUsd(data.market.fdvUsd, 0)}</p>
              </div>
            </div>
          </header>

          <div className="token-detail-progress">
            <div className="token-detail-progress-copy">
              <span>
                {data.graduation.graduated ? 'Graduated' : 'Graduation progress'}
              </span>
              <strong>
                {data.graduation.graduated
                  ? 'Threshold reached'
                  : `${data.graduation.pairedPrincipalEth} / ${data.graduation.thresholdEth} ETH`}
              </strong>
            </div>
            <div className="token-detail-progress-track">
              <div
                className="token-detail-progress-fill"
                style={{
                  width: `${Math.min(
                    (data.graduation.graduated ? 1 : data.graduation.progress) * 100,
                    100,
                  )}%`,
                }}
              />
            </div>
          </div>

          <TokenVaultPanel
            token={token}
            symbol={data.metadata.symbol}
            pendingCreatorWeth={data.fees.creatorRewards?.creatorWeth ?? null}
            pendingCreatorToken={data.fees.creatorRewards?.creatorToken ?? null}
            creatorSharePercent={data.fees.creatorSharePercent}
          />

          <TokenCreatorFeesPanel token={token} detail={data} onClaimed={() => refetch()} />

          <TokenPriceChart trades={data.trades} currentPriceUsd={data.market.priceUsd} />

          {data.metadata.description ? (
            <section className="token-detail-section">
              <h2>About</h2>
              <p>{data.metadata.description}</p>
            </section>
          ) : null}

          {socialLinks.length > 0 ? (
            <section className="token-detail-section">
              <h2>Links</h2>
              <div className="token-detail-links">
                {socialLinks.map((link) => (
                  <a key={link.key} href={link.href!} target="_blank" rel="noreferrer">
                    <Globe className="h-4 w-4" />
                    {link.label}
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <section className="token-detail-section">
            <h2>Recent trades</h2>
            {data.trades.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No recent swaps indexed yet.</p>
            ) : (
              <div className="token-trades-table-wrap">
                <table className="token-trades-table">
                  <thead>
                    <tr>
                      <th>Side</th>
                      <th>ETH</th>
                      <th>Token</th>
                      <th>Trader</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.slice(0, 12).map((trade) => (
                      <tr key={`${trade.transactionHash}-${trade.blockNumber}`}>
                        <td>
                          <span className={trade.side === 'buy' ? 'token-side-buy' : 'token-side-sell'}>
                            {trade.side}
                          </span>
                        </td>
                        <td>{trade.ethAmount.toFixed(4)}</td>
                        <td>{trade.tokenAmount.toFixed(2)}</td>
                        <td>
                          <a
                            href={explorerAddressUrl(trade.trader)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortAddress(trade.trader)}
                          </a>
                        </td>
                        <td>
                          <a href={txUrl(trade.transactionHash as `0x${string}`)} target="_blank" rel="noreferrer">
                            {formatRelativeTime(trade.timestamp)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="token-detail-section">
            <h2>On-chain</h2>
            <dl className="token-detail-facts">
              <div>
                <dt>Token</dt>
                <dd>
                  <a href={explorerAddressUrl(data.token)} target="_blank" rel="noreferrer">
                    {shortAddress(data.token, 6)}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd>
                  <a href={explorerAddressUrl(data.metadata.pool)} target="_blank" rel="noreferrer">
                    {shortAddress(data.metadata.pool, 6)}
                  </a>
                </dd>
              </div>
              {data.launch ? (
                <>
                  <div>
                    <dt>Deployer</dt>
                    <dd>
                      <a href={explorerAddressUrl(data.launch.deployer)} target="_blank" rel="noreferrer">
                        {shortAddress(data.launch.deployer, 6)}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Creator fees</dt>
                    <dd>
                      {data.fees.creatorSharePercent}% →{' '}
                      <a href={explorerAddressUrl(data.fees.creatorPayout)} target="_blank" rel="noreferrer">
                        {shortAddress(data.fees.creatorPayout, 6)}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Dev buy</dt>
                    <dd>{data.launch.initialBuyEth || '0'} ETH</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </section>
        </section>
      </div>
    </div>
  );
}
