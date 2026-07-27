'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Coins, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatEther, type Address } from 'viem';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';

import { robinhoodChain } from '@/lib/pons/chain';
import {
  formatAccruedTokenAmount,
  formatAccruedWethAmount,
  hasClaimableCreatorFees,
  isCreatorFeeClaimant,
} from '@/lib/pons/creator-fees';
import { PONS_LOCKER_ABI } from '@/lib/pons/token-state';
import { fetchVaultState } from '@/lib/pons/vault-state';
import type { TokenDetailResponse } from '@/lib/pons/types';
import { cn, explorerAddressUrl, formatUsd, shortAddress } from '@/lib/utils';

interface TokenCreatorFeesPanelProps {
  token: Address;
  detail: TokenDetailResponse;
  onClaimed: () => void;
}

function usdFromWei(raw: string, priceUsd: number): number {
  const amount = Number(formatEther(BigInt(raw)));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount * priceUsd;
}

export function TokenCreatorFeesPanel({ token, detail, onClaimed }: TokenCreatorFeesPanelProps) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [error, setError] = useState('');

  // Shares react-query's cache with TokenVaultPanel, so this costs no extra RPC.
  const { data: vaultState } = useQuery({
    queryKey: ['token-vault', token],
    queryFn: () => fetchVaultState(publicClient!, token),
    enabled: !!publicClient,
    refetchInterval: 20_000,
  });

  const rewards = detail.fees.creatorRewards;
  const deployer = detail.launch?.deployer as Address | undefined;
  const locker = detail.fees.locker as Address | null;
  const vaultOwnsFees = Boolean(vaultState);

  const canClaim = useMemo(() => {
    if (!deployer || !locker || !rewards || vaultOwnsFees) return false;
    return isCreatorFeeClaimant(
      address,
      deployer,
      rewards.payoutAddress as Address,
      detail.fees.feeRedirect as Address | null,
    );
  }, [address, deployer, detail.fees.feeRedirect, locker, rewards, vaultOwnsFees]);

  const amounts = useMemo(() => {
    if (!rewards) return null;
    return {
      grossTokenUsd: usdFromWei(rewards.grossToken, detail.market.priceUsd),
      grossWethUsd: usdFromWei(rewards.grossWeth, detail.market.ethUsd),
      vaultTokenUsd: usdFromWei(rewards.creatorToken, detail.market.priceUsd),
      vaultWethUsd: usdFromWei(rewards.creatorWeth, detail.market.ethUsd),
    };
  }, [detail.market.ethUsd, detail.market.priceUsd, rewards]);

  const claimMutation = useMutation({
    mutationFn: async () => {
      if (!walletClient || !address || !locker) {
        throw new Error('Connect the creator wallet to claim fees.');
      }

      return walletClient.writeContract({
        account: address,
        chain: robinhoodChain,
        address: locker,
        abi: PONS_LOCKER_ABI,
        functionName: 'collectFees',
        args: [token],
      });
    },
    onSuccess: async (hash) => {
      setError('');
      const { createPublicClient, http } = await import('viem');
      const { ROBINHOOD_RPC_URL } = await import('@/lib/pons/constants');
      const client = createPublicClient({
        chain: robinhoodChain,
        transport: http(ROBINHOOD_RPC_URL),
      });
      await client.waitForTransactionReceipt({ hash });
      onClaimed();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Fee claim failed.');
    },
  });

  if (!rewards || !amounts) {
    return (
      <section className="token-creator-fees">
        <header className="token-creator-fees-header">
          <Coins className="h-5 w-5 text-lime-300" />
          <div>
            <h2>Pool fees</h2>
            <p>Pool fees accrue without unlocking the permanent liquidity position.</p>
          </div>
        </header>
        <p className="token-creator-fees-state">Creator fee balances are temporarily unavailable.</p>
      </section>
    );
  }

  const splitLabel = `${detail.fees.creatorSharePercent}% creator / ${detail.fees.protocolSharePercent}% protocol`;
  const claimable = hasClaimableCreatorFees(rewards);
  const symbol = detail.metadata.symbol;
  const vaultVerb =
    vaultState?.template === 'staking' ? 'pays out to stakers' : 'buys and burns';

  return (
    <section className="token-creator-fees">
      <header className="token-creator-fees-header">
        <Coins className="h-5 w-5 text-lime-300" />
        <div>
          <h2>{vaultOwnsFees ? 'Pool fees' : 'Creator fees'}</h2>
          <p>
            {vaultOwnsFees
              ? 'Full LP fees from the pool. The vault only receives the creator share.'
              : 'Pool fees accrue without unlocking the permanent liquidity position.'}
          </p>
        </div>
      </header>

      <div className="token-creator-fees-grid">
        <div className="token-creator-fees-card">
          <span>Gross {symbol}</span>
          <strong>{formatAccruedTokenAmount(rewards.grossToken, symbol)}</strong>
          <small>{formatUsd(amounts.grossTokenUsd, 2)}</small>
        </div>
        <div className="token-creator-fees-card">
          <span>Gross WETH</span>
          <strong>{formatAccruedWethAmount(rewards.grossWeth)}</strong>
          <small>{formatUsd(amounts.grossWethUsd, 2)}</small>
        </div>
      </div>

      {vaultOwnsFees ? (
        <div className="token-creator-fees-vault-share">
          <div className="token-creator-fees-vault-share-head">
            <span>Vault receives ({detail.fees.creatorSharePercent}%)</span>
            <span className="token-creator-fees-vault-share-tag">
              not the gross · what Queued above uses
            </span>
          </div>
          <div className="token-creator-fees-grid">
            <div className="token-creator-fees-card is-vault-share">
              <span>{symbol} to vault</span>
              <strong>{formatAccruedTokenAmount(rewards.creatorToken, symbol)}</strong>
              <small>{formatUsd(amounts.vaultTokenUsd, 2)}</small>
            </div>
            <div className="token-creator-fees-card is-vault-share">
              <span>WETH to vault</span>
              <strong>{formatAccruedWethAmount(rewards.creatorWeth)}</strong>
              <small>{formatUsd(amounts.vaultWethUsd, 2)}</small>
            </div>
          </div>
        </div>
      ) : null}

      <dl className="token-creator-fees-meta">
        <div>
          <dt>Split</dt>
          <dd>{splitLabel}</dd>
        </div>
        <div>
          <dt>{vaultOwnsFees ? 'Paid to' : 'Payout wallet'}</dt>
          <dd>
            <a href={explorerAddressUrl(rewards.payoutAddress)} target="_blank" rel="noreferrer">
              {shortAddress(rewards.payoutAddress, 6)}
            </a>
            {vaultOwnsFees ? ' · vault' : null}
          </dd>
        </div>
      </dl>

      {canClaim ? (
        <button
          type="button"
          className={cn('token-creator-fees-claim', !claimable && 'is-disabled')}
          disabled={!claimable || claimMutation.isPending || !isConnected}
          onClick={() => {
            setError('');
            claimMutation.mutate();
          }}
        >
          {claimMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Claiming…
            </>
          ) : (
            'Claim fees'
          )}
        </button>
      ) : vaultOwnsFees ? (
        <p className="token-creator-fees-note">
          Nothing to claim here. Protocol keeps {detail.fees.protocolSharePercent}%; the{' '}
          {detail.fees.creatorSharePercent}% above is what the vault {vaultVerb}. Anyone can
          trigger that from the vault panel.
        </p>
      ) : (
        <p className="token-creator-fees-note">
          Connect the deployer or payout wallet to claim creator fees.
        </p>
      )}

      {error ? <p className="token-creator-fees-error">{error}</p> : null}
    </section>
  );
}
