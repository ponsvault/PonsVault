'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Coins, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { erc20Abi, formatEther, parseEther, type Address } from 'viem';
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';

import { robinhoodChain } from '@/lib/pons/chain';
import { PONS_CHAIN_ID } from '@/lib/pons/constants';
import { describeCadence, formatTokens, formatWeth, supplyPercent } from '@/lib/pons/vault-format';
import {
  PONS_STAKING_VAULT_ABI,
  formatDuration,
  type StakingVaultState,
} from '@/lib/pons/vault-state';
import { cn, explorerAddressUrl, shortAddress } from '@/lib/utils';

interface TokenStakingPanelProps {
  token: Address;
  symbol: string;
  state: StakingVaultState;
  /** Seconds since epoch, ticked by the parent. Zero before the client hydrates. */
  nowSeconds: number;
  /** What the next run will collect on top of what the vault already holds. */
  harvestable: bigint;
  /** Creator cut of pool fees, e.g. 70. Used only for the queued label. */
  creatorSharePercent?: number;
  onChanged: () => void;
}

type StakeAction = 'stake' | 'unstake' | 'claim' | 'run';

/**
 * What the payout button should do and say, given the vault's current state.
 *
 * Mirrors the buyback panel, including why `harvestable` is not `state.canRun`:
 * on-chain that only sees what has already been swept out of the locker, so it
 * reads "nothing to do" in exactly the normal case.
 */
function resolveRunAction(state: StakingVaultState, harvestable: bigint, isConnected: boolean) {
  if (state.totalStaked === 0n) {
    return {
      label: 'Nobody staked',
      disabled: true,
      hint: 'Nobody is staked yet, so there is nobody to pay. The fees keep accruing and go to whoever stakes first.',
    };
  }
  if (harvestable === 0n) {
    return {
      label: 'Nothing to pay out yet',
      disabled: true,
      hint: 'No fees have accrued since the last payout. The vault runs again once trading produces more.',
    };
  }
  if (harvestable < state.minHarvestWei) {
    return {
      label: 'Below minimum',
      disabled: true,
      hint: `Fees are accruing, but this vault waits until ${formatWeth(state.minHarvestWei)} WETH so a payout is worth its gas.`,
    };
  }
  return {
    label: isConnected ? 'Run payout' : 'Connect to run',
    disabled: false,
    hint: 'The keeper will do this on its own shortly. You can go first if you like — the call has no owner, and you pay only the gas.',
  };
}

/** A staker's own position, which only exists once a wallet is connected. */
interface Position {
  staked: bigint;
  pendingWeth: bigint;
  pendingToken: bigint;
  unlockAt: bigint;
  sharePpm: bigint;
  balance: bigint;
  allowance: bigint;
}

export function TokenStakingPanel({
  token,
  symbol,
  state,
  nowSeconds,
  harvestable,
  creatorSharePercent = 70,
  onChanged,
}: TokenStakingPanelProps) {
  const publicClient = usePublicClient();
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const { data: position, refetch: refetchPosition } = useQuery<Position | null>({
    queryKey: ['staking-position', state.vault, address],
    enabled: !!publicClient && !!address,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [result, balance, allowance] = await Promise.all([
        publicClient!.readContract({
          address: state.vault,
          abi: PONS_STAKING_VAULT_ABI,
          functionName: 'positionOf',
          args: [address!],
        }),
        publicClient!.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address!],
        }),
        publicClient!.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address!, state.vault],
        }),
      ]);

      return {
        staked: result[0],
        pendingWeth: result[1],
        pendingToken: result[2],
        unlockAt: result[3],
        sharePpm: result[4],
        balance,
        allowance,
      };
    },
  });

  const mutation = useMutation({
    mutationFn: async (action: StakeAction) => {
      if (!isConnected || !address) {
        const connector = connectors[0];
        if (!connector) throw new Error('No wallet connector available.');
        connect({ connector });
        return;
      }
      if (chainId !== PONS_CHAIN_ID) {
        await switchChainAsync({ chainId: PONS_CHAIN_ID });
      }
      if (!walletClient) throw new Error('Connect your wallet first.');

      const base = { account: address, chain: robinhoodChain } as const;

      // Both take no arguments. `claim` pays the caller what they have already
      // earned; `run` harvests and credits every staker and is open to anyone.
      if (action === 'claim' || action === 'run') {
        const hash = await walletClient.writeContract({
          ...base,
          address: state.vault,
          abi: PONS_STAKING_VAULT_ABI,
          functionName: action,
        });
        await publicClient!.waitForTransactionReceipt({ hash });
        return;
      }

      const value = parseEther(amount.trim() || '0');
      if (value <= 0n) throw new Error('Enter an amount.');

      if (action === 'stake') {
        // Approved for exactly this deposit rather than an unlimited allowance:
        // the extra click is cheaper than leaving a standing claim on a wallet.
        if ((position?.allowance ?? 0n) < value) {
          const approval = await walletClient.writeContract({
            ...base,
            address: token,
            abi: erc20Abi,
            functionName: 'approve',
            args: [state.vault, value],
          });
          await publicClient!.waitForTransactionReceipt({ hash: approval });
        }

        const hash = await walletClient.writeContract({
          ...base,
          address: state.vault,
          abi: PONS_STAKING_VAULT_ABI,
          functionName: 'stake',
          args: [value],
        });
        await publicClient!.waitForTransactionReceipt({ hash });
        return;
      }

      const hash = await walletClient.writeContract({
        ...base,
        address: state.vault,
        abi: PONS_STAKING_VAULT_ABI,
        functionName: 'unstake',
        args: [value],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
    },
    onSuccess: () => {
      setError('');
      setAmount('');
      refetchPosition();
      onChanged();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Transaction failed.');
    },
  });

  const busy = mutation.isPending || isConnecting || isSwitching;

  const locked =
    !!position && position.unlockAt > 0n && nowSeconds > 0 && BigInt(nowSeconds) < position.unlockAt;
  const unlockIn = locked ? Number(position!.unlockAt) - nowSeconds : 0;
  const hasRewards = !!position && (position.pendingWeth > 0n || position.pendingToken > 0n);
  const sharePercent = position ? Number(position.sharePpm) / 10_000 : 0;

  const runAction = resolveRunAction(state, harvestable, isConnected);
  const live = !runAction.disabled;

  return (
    <section className="pv-panel token-vault">
      <div className="pv-panel-bar">
        <span className="pv-panel-bar-label">vault · {symbol.toLowerCase()}</span>
        <span className="pv-badge">Staking</span>
        <span className={cn('pv-badge token-vault-status', live && 'pv-badge-live')}>
          {live ? (
            <>
              <span className="pv-dot pv-pulse-dot" />
              Ready
            </>
          ) : (
            'Idle'
          )}
        </span>
      </div>

      <div className="token-vault-headline">
        <div className="token-vault-headline-figure">
          <Coins className="h-4 w-4" strokeWidth={2} />
          <span className="pv-mono">{formatWeth(state.totalWethDistributed)} WETH</span>
        </div>
        <p className="token-vault-headline-note">
          paid to stakers so far, across {state.runCount.toString()}{' '}
          {state.runCount === 1n ? 'payout' : 'payouts'}. Currently{' '}
          {formatTokens(state.totalStaked)} {symbol.toUpperCase()} is staked —{' '}
          {supplyPercent(state.totalStaked).toFixed(2)}% of supply.
        </p>
      </div>

      <ol className="token-vault-steps">
        <li>
          <span className="token-vault-step-n">1</span>
          <p>
            <strong>Fees accrue.</strong> Every trade pays a 1% pool fee. The creator&rsquo;s share
            of it is redirected to this vault at launch instead of to a wallet.
          </p>
        </li>
        <li>
          <span className="token-vault-step-n">2</span>
          <p>
            <strong>It pays out on its own.</strong> A keeper triggers the vault once enough fees
            have built up. The vault sweeps what it is owed and credits every staker in proportion
            to what they have staked — no snapshot, no allowlist, nobody deciding who gets what.
          </p>
        </li>
        <li>
          <span className="token-vault-step-n">3</span>
          <p>
            <strong>You claim whenever.</strong> Rewards are paid in WETH, plus any{' '}
            {symbol.toUpperCase()} the pool earned on the token side. They sit in the vault under
            your name until you take them.
          </p>
        </li>
      </ol>

      <p className="token-vault-claim">
        <strong>The creator cannot take these fees.</strong> The redirect to this vault is set once,
        by the contract that deployed the token, and no function exists to point it anywhere else.
        The vault can only pay stakers — it has no withdrawal for anyone else, including us.
      </p>

      <div className="token-vault-body">
        <div className="token-vault-col">
          <header className="token-vault-col-head">
            <span>Configuration</span>
            <span className="pv-badge">Immutable</span>
          </header>
          <dl className="token-vault-rows">
            <div className="token-vault-row">
              <dt>Reward</dt>
              <dd className="token-vault-prose">
                All creator fees, split by share of the staking pool
              </dd>
            </div>
            <div className="token-vault-row">
              <dt>Lock</dt>
              <dd className="token-vault-prose">
                {state.lockPeriod === 0
                  ? 'None — unstake whenever you want'
                  : `${formatDuration(state.lockPeriod)} from your last deposit. Rewards stay claimable throughout.`}
              </dd>
            </div>
            <div className="token-vault-row">
              <dt>Payouts</dt>
              <dd className="token-vault-prose">{describeCadence(state)}</dd>
            </div>
            <div className="token-vault-row">
              <dt>Contract</dt>
              <dd className="pv-mono">
                <a href={explorerAddressUrl(state.vault)} target="_blank" rel="noreferrer">
                  {shortAddress(state.vault)}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="token-vault-col">
          <header className="token-vault-col-head">
            <span>Your position</span>
            {position && position.staked > 0n ? (
              <span className="pv-mono token-vault-runs">{sharePercent.toFixed(2)}% of pool</span>
            ) : null}
          </header>
          {!isConnected ? (
            <p className="token-vault-prose">Connect a wallet to stake and see what you have earned.</p>
          ) : (
            <dl className="token-vault-rows">
              <div className="token-vault-row">
                <dt>Staked</dt>
                <dd className="pv-mono">
                  {formatTokens(position?.staked ?? 0n)} {symbol.toUpperCase()}
                </dd>
              </div>
              <div className="token-vault-row">
                <dt>Claimable</dt>
                <dd className="pv-mono">
                  {formatWeth(position?.pendingWeth ?? 0n)} WETH
                  {position && position.pendingToken > 0n
                    ? ` + ${formatTokens(position.pendingToken)} ${symbol.toUpperCase()}`
                    : ''}
                </dd>
              </div>
              <div className="token-vault-row">
                <dt>Wallet</dt>
                <dd className="pv-mono">
                  {formatTokens(position?.balance ?? 0n)} {symbol.toUpperCase()}
                </dd>
              </div>
              <div className="token-vault-row">
                <dt>Unstake</dt>
                <dd className="pv-mono">
                  {locked ? `Locked for ${formatDuration(unlockIn)}` : 'Open'}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      {error ? <div className="launchpad-alert token-vault-alert">{error}</div> : null}

      <div className="token-stake-form">
        <label className="token-stake-input">
          <span className="launchpad-label">Amount</span>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`Amount of ${symbol.toUpperCase()} to stake or unstake`}
          />
          <button
            type="button"
            className="token-stake-max"
            onClick={() => {
              const max = position?.balance ?? 0n;
              if (max > 0n) setAmount(formatEther(max));
            }}
            disabled={!position || position.balance === 0n}
          >
            Max
          </button>
        </label>

        <div className="token-stake-actions">
          <button
            type="button"
            className="ui-btn ui-btn-primary token-vault-action"
            disabled={busy}
            onClick={() => mutation.mutate('stake')}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            <span className="ui-btn-label">{isConnected ? 'Stake' : 'Connect to stake'}</span>
          </button>
          <button
            type="button"
            className={cn('ui-btn token-vault-action', locked && 'is-blocked')}
            disabled={busy || locked || !position || position.staked === 0n}
            onClick={() => mutation.mutate('unstake')}
          >
            <span className="ui-btn-label">
              {locked ? `Locked ${formatDuration(unlockIn)}` : 'Unstake'}
            </span>
          </button>
          <button
            type="button"
            className={cn('ui-btn token-vault-action', !hasRewards && 'is-blocked')}
            disabled={busy || !hasRewards}
            onClick={() => mutation.mutate('claim')}
          >
            <span className="ui-btn-label">Claim</span>
          </button>
        </div>
      </div>

      <footer className="token-vault-foot">
        <div className="token-vault-pending">
          <span className="token-vault-pending-label">Queued for the next payout</span>
          <span className="pv-mono token-vault-pending-value">{formatWeth(harvestable)} WETH</span>
          <span className="token-vault-pending-scope">
            Vault share only — the {creatorSharePercent}% creator cut. Pool fees below show the
            full gross.
          </span>
          <span className="token-vault-hint">{runAction.hint}</span>
        </div>
        <button
          type="button"
          className={cn(
            'ui-btn ui-btn-primary token-vault-action',
            runAction.disabled && 'is-blocked',
          )}
          disabled={busy || runAction.disabled}
          onClick={() => mutation.mutate('run')}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          <span className="ui-btn-label">{runAction.label}</span>
        </button>
      </footer>
    </section>
  );
}
