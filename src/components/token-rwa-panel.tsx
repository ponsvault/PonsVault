'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { formatUnits, type Hex } from 'viem';
import { useAccount, useConfig, useSwitchChain } from 'wagmi';
import { getPublicClient, getWalletClient } from 'wagmi/actions';

import { robinhoodChain } from '@/lib/pons/chain';
import { PONS_CHAIN_ID } from '@/lib/pons/constants';
import { formatWeth } from '@/lib/pons/vault-format';
import type { RwaVaultState } from '@/lib/pons/vault-state';
import { PONS_RWA_VAULT_ABI } from '@/lib/rwa/abi';
import { findRwaAsset } from '@/lib/rwa/assets';
import { explorerAddressUrl } from '@/lib/utils';

interface ClaimRow {
  roundId: number;
  amount: string;
  proof: Hex[];
  claimed: boolean;
  rootPosted: boolean;
  claimable: boolean;
}

/** One round, or every claimable round in a single transaction. */
type ClaimTarget = ClaimRow | 'all';

interface TokenRwaPanelProps {
  symbol: string;
  state: RwaVaultState;
  onChanged: () => void;
}

/**
 * A share of a stock, at a length somebody can read.
 *
 * Dividing a round across every holder leaves amounts with all eighteen
 * decimals populated, and printing them in full turns a figure into a string
 * nobody can compare against another. The full value is still what gets sent.
 */
function formatAsset(amount: bigint | string, decimals: number): string {
  const exact = formatUnits(BigInt(amount), decimals);
  const [whole, fraction] = exact.split('.');
  if (!fraction) return whole;

  const trimmed = fraction.slice(0, 6).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/**
 * Newest first. Open rounds stay above settled ones so the list answers
 * "what can I take" before it answers "what have I already taken".
 */
function sortClaims(rows: ClaimRow[]): ClaimRow[] {
  return [...rows].sort((a, b) => {
    const rank = (row: ClaimRow) => (row.claimable ? 0 : row.rootPosted ? 2 : 1);
    const byState = rank(a) - rank(b);
    if (byState !== 0) return byState;
    return b.roundId - a.roundId;
  });
}

/**
 * The holder's side of an RWA Dividend vault.
 *
 * Everything here is about one question — what is mine and can I take it — so
 * the vault's own statistics stay secondary to the claim list. Holding is the
 * only requirement, so there is deliberately nothing to opt into on this panel.
 *
 * Rounds accumulate one per keeper pass, so the list is built to stay short:
 * claimable rounds stay visible, claimed ones collapse behind a toggle, and
 * several unclaimed ones share a single Claim all that hits `claimMany`.
 */
export function TokenRwaPanel({ symbol, state, onChanged }: TokenRwaPanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [showClaimed, setShowClaimed] = useState(false);

  const asset = findRwaAsset(state.rwaAsset);
  const assetSymbol = asset?.symbol ?? 'stock';
  const assetDecimals = asset?.decimals ?? 18;

  const {
    data: claims,
    isLoading: claimsLoading,
    error: claimsError,
    refetch: refetchClaims,
  } = useQuery<ClaimRow[]>({
    queryKey: ['rwa-claims', state.vault, address],
    queryFn: async () => {
      const response = await fetch(
        `/api/rwa/claims?vault=${state.vault}&account=${address}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load your claims.');
      return body.claims as ClaimRow[];
    },
    enabled: Boolean(address) && state.roundCount > 0,
  });

  const sorted = sortClaims(claims ?? []);
  const unclaimed = sorted.filter((row) => row.claimable);
  const awaiting = sorted.filter((row) => !row.claimable && !row.claimed);
  const claimed = sorted.filter((row) => row.claimed);
  const owed = unclaimed.reduce((sum, row) => sum + BigInt(row.amount), 0n);

  // Claimable and still-open rounds stay in the list. Claimed ones are a
  // history the holder already knows about, so they sit behind a toggle once
  // there is more than one — a vault that has run for months would otherwise
  // bury the Claim button under a wall of settled rows.
  const visible = [
    ...unclaimed,
    ...awaiting,
    ...(showClaimed || claimed.length <= 1 ? claimed : []),
  ];

  const claimMutation = useMutation({
    mutationFn: async (target: ClaimTarget) => {
      if (!isConnected || !address) throw new Error('Connect a wallet to claim.');

      // Every other write path on the site does this, and a claim needs it for
      // the same reason: a wallet pointed elsewhere has no client for this
      // chain, which is indistinguishable from not being connected at all.
      if (chainId !== PONS_CHAIN_ID) {
        await switchChainAsync({ chainId: PONS_CHAIN_ID });
      }

      // Asked for after the switch rather than taken from the render that
      // queued this click. That copy still points at the chain the wallet was
      // on a moment ago, so using it fails the first press and succeeds on the
      // second — which reads as the button being broken.
      const wallet = await getWalletClient(config, { chainId: PONS_CHAIN_ID });
      const publicClient = getPublicClient(config, { chainId: PONS_CHAIN_ID });

      // Both resolved before anything is sent, so a missing one is reported
      // instead of surfacing after the claim is already on-chain.
      if (!publicClient) throw new Error('Could not reach the chain to confirm the claim.');

      const rows = target === 'all' ? unclaimed : [target];
      if (rows.length === 0) throw new Error('Nothing left to claim.');

      const hash =
        rows.length === 1
          ? await wallet.writeContract({
              address: state.vault,
              abi: PONS_RWA_VAULT_ABI,
              functionName: 'claim',
              args: [BigInt(rows[0].roundId), address, BigInt(rows[0].amount), rows[0].proof],
              chain: robinhoodChain,
              account: address,
            })
          : await wallet.writeContract({
              address: state.vault,
              abi: PONS_RWA_VAULT_ABI,
              functionName: 'claimMany',
              args: [
                rows.map((row) => BigInt(row.roundId)),
                address,
                rows.map((row) => BigInt(row.amount)),
                rows.map((row) => row.proof),
              ],
              chain: robinhoodChain,
              account: address,
            });

      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    onSuccess: () => {
      refetchClaims();
      onChanged();
    },
  });

  const claimingAll = claimMutation.isPending && claimMutation.variables === 'all';
  const busy = claimMutation.isPending;

  const pendingLabel = (sending: boolean) => {
    if (!sending) return null;
    return isSwitching ? 'Switching network…' : 'Claiming…';
  };

  return (
    <section className="pv-panel token-vault">
      <div className="pv-panel-bar">
        <span className="pv-panel-bar-label">vault · {symbol.toLowerCase()}</span>
        <span className="pv-badge">RWA Dividend</span>
      </div>

      <div className="token-vault-headline">
        <div className="token-rwa-headline-row">
          <div className="token-vault-headline-figure">
            {formatAsset(owed, assetDecimals)} {assetSymbol}
          </div>
          {unclaimed.length > 1 ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary token-vault-action"
              disabled={busy}
              onClick={() => claimMutation.mutate('all')}
            >
              {claimingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              <span className="ui-btn-label">
                {pendingLabel(claimingAll) ?? `Claim all · ${unclaimed.length}`}
              </span>
            </button>
          ) : null}
        </div>
        <p className="token-vault-headline-note">
          {isConnected
            ? owed > 0n
              ? `Yours to claim across ${unclaimed.length} round${unclaimed.length === 1 ? '' : 's'}.`
              : 'Nothing to claim yet. Hold the token when a round opens and your share appears here.'
            : `Connect a wallet to see your share of the ${assetSymbol} this vault has bought.`}
        </p>
      </div>

      <p className="token-vault-claim">
        Creator fees buy{' '}
        <a href={explorerAddressUrl(state.rwaAsset)} target="_blank" rel="noreferrer">
          {assetSymbol}
        </a>
        , split between everyone holding {symbol} at the moment each round opens. There is nothing
        to stake — your tokens never leave your wallet.
      </p>

      {isConnected && claimsLoading ? (
        <p className="token-vault-claim">
          <Loader2 className="animate-spin" size={14} /> Working out your share…
        </p>
      ) : null}

      {claimsError ? (
        <p className="token-vault-claim">
          {claimsError instanceof Error ? claimsError.message : 'Could not load your claims.'}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="token-rwa-claims">
          {visible.map((row) => {
            // Scoped to the row being sent, so pressing one round's button does
            // not put every other row into a pending state it is not in.
            const sending =
              claimMutation.isPending &&
              claimMutation.variables !== 'all' &&
              claimMutation.variables?.roundId === row.roundId;

            // One leftover round keeps its own Claim. Several share Claim all
            // above, so the rows stay amounts rather than a column of identical
            // buttons.
            const showRowClaim = row.claimable && unclaimed.length === 1;

            return (
              <li key={row.roundId} className="token-rwa-claim">
                <div className="token-rwa-claim-lead">
                  <span className="token-rwa-claim-round">Round {row.roundId + 1}</span>
                  <span className="token-rwa-claim-amount">
                    {formatAsset(row.amount, assetDecimals)} {assetSymbol}
                  </span>
                </div>

                {showRowClaim ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary token-vault-action"
                    disabled={busy}
                    onClick={() => claimMutation.mutate(row)}
                  >
                    {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    <span className="ui-btn-label">{pendingLabel(sending) ?? 'Claim'}</span>
                  </button>
                ) : row.claimed ? (
                  <span className="token-rwa-claim-state">Claimed</span>
                ) : row.claimable ? null : (
                  <span className="token-rwa-claim-state">Awaiting allocation</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {claimed.length > 1 ? (
        <button
          type="button"
          className="token-rwa-claimed-toggle"
          onClick={() => setShowClaimed((open) => !open)}
        >
          {showClaimed ? 'Hide claimed rounds' : `Show ${claimed.length} claimed rounds`}
        </button>
      ) : null}

      {claimMutation.error ? (
        <p className="token-vault-claim">
          {claimMutation.error instanceof Error ? claimMutation.error.message : 'Claim failed.'}
        </p>
      ) : null}

      <div className="token-vault-body">
        <div className="token-vault-col">
          <header className="token-vault-col-head">
            <span>Vault</span>
          </header>
          <dl className="token-vault-rows">
            <div className="token-vault-row">
              <dt>Buys</dt>
              <dd className="token-vault-prose">{asset ? `${asset.name} (${asset.symbol})` : 'Unknown asset'}</dd>
            </div>
            <div className="token-vault-row">
              <dt>Rounds opened</dt>
              <dd className="token-vault-prose">{state.roundCount}</dd>
            </div>
            <div className="token-vault-row">
              {/* Not the same as unclaimed: this is stock no round has a claim
                  on, which the next run allocates. */}
              <dt>Waiting for the next round</dt>
              <dd className="token-vault-prose">
                {formatAsset(state.undistributedRwa, assetDecimals)} {assetSymbol}
              </dd>
            </div>
            <div className="token-vault-row">
              <dt>Fees before a purchase</dt>
              <dd className="token-vault-prose">{formatWeth(state.minHarvestWei)}</dd>
            </div>
            <div className="token-vault-row">
              <dt>Fees waiting</dt>
              <dd className="token-vault-prose">{formatWeth(state.pendingWeth)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
