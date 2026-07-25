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

  const canClaim = useMemo(() => {
    if (!deployer || !locker || !rewards) return false;
    return isCreatorFeeClaimant(
      address,
      deployer,
      rewards.payoutAddress as Address,
      detail.fees.feeRedirect as Address | null,
    );
  }, [address, deployer, detail.fees.feeRedirect, locker, rewards]);

  const grossTokenUsd = useMemo(() => {
    if (!rewards) return null;
    const tokens = Number(formatEther(BigInt(rewards.grossToken)));
    if (!Number.isFinite(tokens) || tokens <= 0) return 0;
    return tokens * detail.market.priceUsd;
  }, [detail.market.priceUsd, rewards]);

  const grossWethUsd = useMemo(() => {
    if (!rewards) return null;
    const weth = Number(formatEther(BigInt(rewards.grossWeth)));
    if (!Number.isFinite(weth) || weth <= 0) return 0;
    return weth * detail.market.ethUsd;
  }, [detail.market.ethUsd, rewards]);

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

  if (!rewards) {
    return (
      <section className="token-creator-fees">
        <header className="token-creator-fees-header">
          <Coins className="h-5 w-5 text-lime-300" />
          <div>
            <h2>Creator fees</h2>
            <p>Pool fees accrue without unlocking the permanent liquidity position.</p>
          </div>
        </header>
        <p className="token-creator-fees-state">Creator fee balances are temporarily unavailable.</p>
      </section>
    );
  }

  const splitLabel = `${detail.fees.creatorSharePercent}% creator / ${detail.fees.protocolSharePercent}% protocol`;
  const claimable = hasClaimableCreatorFees(rewards);

  return (
    <section className="token-creator-fees">
      <header className="token-creator-fees-header">
        <Coins className="h-5 w-5 text-lime-300" />
        <div>
          <h2>Creator fees</h2>
          <p>Pool fees accrue without unlocking the permanent liquidity position.</p>
        </div>
      </header>

      <div className="token-creator-fees-grid">
        <div className="token-creator-fees-card">
          <span>Accrued {detail.metadata.symbol}</span>
          <strong>{formatAccruedTokenAmount(rewards.grossToken, detail.metadata.symbol)}</strong>
          <small>{formatUsd(grossTokenUsd, 2)}</small>
        </div>
        <div className="token-creator-fees-card">
          <span>Accrued WETH</span>
          <strong>{formatAccruedWethAmount(rewards.grossWeth)}</strong>
          <small>{formatUsd(grossWethUsd, 2)}</small>
        </div>
      </div>

      <dl className="token-creator-fees-meta">
        <div>
          <dt>Split</dt>
          <dd>{splitLabel}</dd>
        </div>
        <div>
          <dt>Payout wallet</dt>
          <dd>
            <a href={explorerAddressUrl(rewards.payoutAddress)} target="_blank" rel="noreferrer">
              {shortAddress(rewards.payoutAddress, 6)}
            </a>
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
      ) : vaultState ? (
        <p className="token-creator-fees-note">
          A vault owns these fees — there is nothing to claim. The figures above are gross; the{' '}
          {detail.fees.creatorSharePercent}% creator share of them goes to the vault above, which{' '}
          {vaultState.template === 'staking' ? 'pays it out to stakers' : 'buys and burns with it'}.
          Anyone can trigger that.
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
