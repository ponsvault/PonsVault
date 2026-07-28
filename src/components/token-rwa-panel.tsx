'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { formatUnits, type Address, type Hex } from 'viem';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';

import { robinhoodChain } from '@/lib/pons/chain';
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
 * The holder's side of an RWA Dividend vault.
 *
 * Everything here is about one question — what is mine and can I take it — so
 * the vault's own statistics stay secondary to the claim list. Holding is the
 * only requirement, so there is deliberately nothing to opt into on this panel.
 */
export function TokenRwaPanel({ symbol, state, onChanged }: TokenRwaPanelProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

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

  const claimMutation = useMutation({
    mutationFn: async (row: ClaimRow) => {
      if (!walletClient || !address || !publicClient) throw new Error('Connect a wallet first.');

      const hash = await walletClient.writeContract({
        address: state.vault,
        abi: PONS_RWA_VAULT_ABI,
        functionName: 'claim',
        args: [BigInt(row.roundId), address, BigInt(row.amount), row.proof],
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

  const unclaimed = (claims ?? []).filter((row) => row.claimable);
  const owed = unclaimed.reduce((sum, row) => sum + BigInt(row.amount), 0n);

  return (
    <section className="pv-panel token-vault">
      <div className="pv-panel-bar">
        <span className="pv-panel-bar-label">vault · {symbol.toLowerCase()}</span>
        <span className="pv-badge">RWA Dividend</span>
      </div>

      <div className="token-vault-headline">
        <div className="token-vault-headline-figure">
          {formatUnits(owed, assetDecimals)} {assetSymbol}
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

      {claims && claims.length > 0 ? (
        <ol className="token-vault-steps">
          {claims.map((row) => (
            <li key={row.roundId}>
              <span className="token-vault-step-n">{row.roundId + 1}</span>
              <span>
                {formatUnits(BigInt(row.amount), assetDecimals)} {assetSymbol}
                {row.claimed ? ' · claimed' : row.rootPosted ? '' : ' · awaiting allocation'}
              </span>
              {row.claimable ? (
                <button
                  type="button"
                  className="pv-button"
                  disabled={claimMutation.isPending}
                  onClick={() => claimMutation.mutate(row)}
                >
                  {claimMutation.isPending ? 'Claiming…' : 'Claim'}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
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
              <dt>Waiting to be claimed</dt>
              <dd className="token-vault-prose">
                {formatUnits(state.undistributedRwa, assetDecimals)} {assetSymbol}
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
