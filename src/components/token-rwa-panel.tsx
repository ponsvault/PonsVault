'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
 * The holder's side of an RWA Dividend vault.
 *
 * Rounds are an implementation detail of how the keeper posts allocations —
 * holders care about what they can take and what they already took. The panel
 * collapses every round into those two totals and claims through `claimMany`
 * when more than one is owed.
 */
export function TokenRwaPanel({ symbol, state, onChanged }: TokenRwaPanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

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

  const unclaimed = (claims ?? []).filter((row) => row.claimable);
  const claimedTotal = (claims ?? [])
    .filter((row) => row.claimed)
    .reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const owed = unclaimed.reduce((sum, row) => sum + BigInt(row.amount), 0n);

  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!isConnected || !address) throw new Error('Connect a wallet to claim.');
      if (unclaimed.length === 0) throw new Error('Nothing left to claim.');

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

      const hash =
        unclaimed.length === 1
          ? await wallet.writeContract({
              address: state.vault,
              abi: PONS_RWA_VAULT_ABI,
              functionName: 'claim',
              args: [
                BigInt(unclaimed[0].roundId),
                address,
                BigInt(unclaimed[0].amount),
                unclaimed[0].proof,
              ],
              chain: robinhoodChain,
              account: address,
            })
          : await wallet.writeContract({
              address: state.vault,
              abi: PONS_RWA_VAULT_ABI,
              functionName: 'claimMany',
              args: [
                unclaimed.map((row) => BigInt(row.roundId)),
                address,
                unclaimed.map((row) => BigInt(row.amount)),
                unclaimed.map((row) => row.proof),
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

  const busy = claimMutation.isPending;
  const buttonLabel = busy
    ? isSwitching
      ? 'Switching network…'
      : 'Claiming…'
    : 'Claim';

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
          {owed > 0n ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary token-vault-action"
              disabled={busy}
              onClick={() => claimMutation.mutate()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              <span className="ui-btn-label">{buttonLabel}</span>
            </button>
          ) : null}
        </div>
        <p className="token-vault-headline-note">
          {isConnected
            ? owed > 0n
              ? 'Yours to claim.'
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

      {isConnected && !claimsLoading && claims ? (
        <dl className="token-rwa-totals">
          <div className="token-rwa-total">
            <dt>Unclaimed</dt>
            <dd>
              {formatAsset(owed, assetDecimals)} {assetSymbol}
            </dd>
          </div>
          <div className="token-rwa-total">
            <dt>Claimed</dt>
            <dd>
              {formatAsset(claimedTotal, assetDecimals)} {assetSymbol}
            </dd>
          </div>
        </dl>
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
              <dt>Min fees to buy</dt>
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
