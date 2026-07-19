'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, KeyRound, Loader2, Wallet } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { exportFeeSharePrivateKey, fetchClaimProfile, isPrivyConfigured } from '@/lib/fee-share/api';
import { txUrl } from '@/lib/pons/launch';
import { shortAddress, ipfsToGateway } from '@/lib/utils';

export function ClaimDashboard() {
  if (!isPrivyConfigured) {
    return (
      <section className="launchpad-preview-card max-w-2xl">
        <h1 className="split-shell-title">Claim creator fees</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
          Privy is not configured yet. Add <code>NEXT_PUBLIC_PRIVY_APP_ID</code> and{' '}
          <code>PRIVY_APP_SECRET</code> to <code>.env.local</code>, then restart the dev server.
        </p>
      </section>
    );
  }

  return <ClaimDashboardInner />;
}

function ClaimDashboardInner() {
  const { ready, authenticated, login, logout, getAccessToken, user } = usePrivy();
  const [exportError, setExportError] = useState('');
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadProfile = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) throw new Error('Could not read Privy access token.');
    return fetchClaimProfile(token);
  }, [getAccessToken]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['fee-share-claim', user?.id],
    queryFn: loadProfile,
    enabled: authenticated,
  });

  async function handleExportKey() {
    setExportError('');
    setExportedKey(null);
    setCopied(false);

    const confirmed = window.confirm(
      'Exporting reveals your fee-share wallet private key. Anyone with this key controls the wallet and its funds. Continue?',
    );
    if (!confirmed) return;

    setExporting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Could not read Privy access token.');
      const result = await exportFeeSharePrivateKey(token);
      setExportedKey(result.privateKey);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export private key');
    } finally {
      setExporting(false);
    }
  }

  async function copyExportedKey() {
    if (!exportedKey) return;
    await navigator.clipboard.writeText(exportedKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (!ready) {
    return <p className="text-sm text-[var(--text-muted)]">Loading Privy…</p>;
  }

  if (!authenticated) {
    return (
      <section className="launchpad-preview-card max-w-2xl">
        <p className="home-section-label">Claim</p>
        <h1 className="mt-2 split-shell-title">Log in to claim fees</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
          Connect with the X or GitHub account that was assigned creator fees at launch. Privy keeps
          you signed in across visits — you only need to log in once on this device.
        </p>
        <button
          type="button"
          onClick={login}
          className="home-btn home-btn-primary mt-6"
        >
          <Wallet className="h-4 w-4" />
          Login with X or GitHub
        </button>
      </section>
    );
  }

  const twitterUsername = user?.twitter?.username;
  const githubUsername = user?.github?.username;
  const connectedLabel = twitterUsername
    ? `@${twitterUsername} on X`
    : githubUsername
      ? `${githubUsername} on GitHub`
      : 'Privy connected';

  return (
    <section className="space-y-6">
      <div className="launchpad-preview-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="home-section-label">Claim</p>
            <h1 className="mt-2 split-shell-title">Your PonsShare launches</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{connectedLabel}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="home-btn home-btn-secondary"
          >
            Log out
          </button>
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your launches…
          </div>
        ) : null}

        {isError ? (
          <div className="launchpad-alert mt-6">
            {error instanceof Error ? error.message : 'Failed to load claim profile'}
            <button type="button" className="ml-3 underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : null}

        {data ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] p-4">
              <p className="launchpad-label">Fee wallet</p>
              <p className="mt-1 font-mono text-sm text-white">{data.walletAddress}</p>
              {data.registryMatch && data.socialHandle ? (
                <p className="launchpad-field-note mt-2 text-[var(--accent)]">
                  Platform wallet for{' '}
                  {data.socialPlatform === 'github'
                    ? data.socialHandle
                    : `@${data.socialHandle}`}
                  {data.privyLinked ? ' · linked to your Privy account' : ' · linking on login…'}
                </p>
              ) : (
                <p className="launchpad-field-note mt-2">
                  No pre-generated social wallet found for this handle yet.
                </p>
              )}

              {data.registryMatch ? (
                <div className="mt-4 space-y-3">
                  <button
                    type="button"
                    onClick={() => handleExportKey().catch(() => undefined)}
                    disabled={exporting}
                    className="home-btn home-btn-secondary"
                  >
                    {exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Export private key
                  </button>
                  {exportError ? (
                    <p className="text-sm text-red-300">{exportError}</p>
                  ) : null}
                  {exportedKey ? (
                    <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                      <p className="text-xs text-amber-200">
                        Never share this key. Import it into MetaMask or another wallet to claim
                        fees on-chain.
                      </p>
                      <p className="mt-2 break-all font-mono text-xs text-white">{exportedKey}</p>
                      <button
                        type="button"
                        onClick={() => copyExportedKey().catch(() => undefined)}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copied ? 'Copied' : 'Copy key'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {data.launches.length === 0 ? (
              <div className="rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] p-4">
                <p className="text-sm text-[var(--text-muted)]">
                  No tokens launched through PonsShare are linked to this account yet.
                </p>
                <p className="launchpad-field-note mt-2">
                  Launches appear here when someone assigns fee sharing to your handle, or when
                  your fee wallet matches a PonsShare launch.
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {data.launches.map((launch) => (
                  <LaunchClaimCard key={launch.token} launch={launch} />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-[var(--text-subtle)]">
        Claim status syncs automatically from on-chain events. Only tokens launched through
        PonsShare are listed here.{' '}
        <Link href="/launch" className="text-[var(--accent)] hover:underline">
          Launch a token
        </Link>
      </p>
    </section>
  );
}

function LaunchClaimCard({
  launch,
}: {
  launch: {
    token: string;
    name: string;
    symbol: string;
    logo: string;
    transactionHash: string;
    feeClaimed?: boolean;
    feeClaimedAt?: string | null;
    feeClaimTxHash?: string | null;
  };
}) {
  const detailsHref = `/launchpad/${launch.token}`;

  return (
    <article className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] p-4">
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 overflow-hidden rounded-xl bg-[var(--panel-blue)]">
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
        <div>
          <p className="font-medium text-white">{launch.name}</p>
          <p className="text-sm text-[var(--text-muted)]">{launch.symbol}</p>
          {launch.feeClaimed ? (
            <p className="mt-1 text-xs text-[var(--accent)]">
              Fees claimed on-chain
              {launch.feeClaimedAt
                ? ` · ${new Date(launch.feeClaimedAt).toLocaleDateString()}`
                : ''}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-subtle)]">Fees not claimed yet</p>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="font-mono text-xs text-[var(--text-subtle)]">
          {shortAddress(launch.token, 6)}
        </p>
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <Link
            href={detailsHref}
            className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
          >
            Claim fees <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          {launch.feeClaimTxHash ? (
            <a
              href={txUrl(launch.feeClaimTxHash as `0x${string}`)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-white"
            >
              Claim tx
            </a>
          ) : (
            <a
              href={txUrl(launch.transactionHash as `0x${string}`)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-white"
            >
              Launch tx
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
