'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { formatEther } from 'viem';
import { useAccount, useConfig, useSwitchChain } from 'wagmi';
import { getPublicClient, getWalletClient } from 'wagmi/actions';

import { LOTTERY_PHASE, PONS_LOTTERY_VAULT_ABI } from '@/lib/lottery/abi';
import { robinhoodChain } from '@/lib/pons/chain';
import { PONS_CHAIN_ID } from '@/lib/pons/constants';
import { formatWeth } from '@/lib/pons/vault-format';
import type { LotteryVaultState } from '@/lib/pons/vault-state';

interface TokenLotteryPanelProps {
  symbol: string;
  state: LotteryVaultState;
  /** Ticking clock from the parent. 0 until the client mounts. */
  nowSeconds: number;
  onChanged: () => void;
}

function phaseLabel(phase: number): string {
  switch (phase) {
    case LOTTERY_PHASE.Entering:
      return 'Open for entries';
    case LOTTERY_PHASE.Committed:
      return 'Draw committed';
    case LOTTERY_PHASE.Drawn:
      return 'Drawn';
    case LOTTERY_PHASE.Cancelled:
      return 'Cancelled — no entrants';
    default:
      return 'Waiting for the next pot';
  }
}

/**
 * Holder side of a Lottery vault: see the pot, enter while the window is open.
 *
 * Commit/reveal stay with the keeper — holders only need Enter.
 */
export function TokenLotteryPanel({
  symbol,
  state,
  nowSeconds,
  onChanged,
}: TokenLotteryPanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const config = useConfig();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const currentRoundId = state.roundCount > 0 ? state.roundCount - 1 : null;

  const { data: entered, refetch: refetchEntered } = useQuery({
    queryKey: ['lottery-entered', state.vault, currentRoundId, address],
    enabled: Boolean(address) && currentRoundId !== null && state.phase === LOTTERY_PHASE.Entering,
    queryFn: async () => {
      const client = getPublicClient(config, { chainId: PONS_CHAIN_ID });
      if (!client || !address || currentRoundId === null) return false;
      return client.readContract({
        address: state.vault,
        abi: PONS_LOTTERY_VAULT_ABI,
        functionName: 'hasEntered',
        args: [BigInt(currentRoundId), address],
      });
    },
  });

  const enterMutation = useMutation({
    mutationFn: async () => {
      if (!isConnected || !address) throw new Error('Connect a wallet to enter.');
      if (chainId !== PONS_CHAIN_ID) {
        await switchChainAsync({ chainId: PONS_CHAIN_ID });
      }
      const wallet = await getWalletClient(config, { chainId: PONS_CHAIN_ID });
      const publicClient = getPublicClient(config, { chainId: PONS_CHAIN_ID });
      if (!publicClient) throw new Error('Could not reach the chain.');

      const hash = await wallet.writeContract({
        address: state.vault,
        abi: PONS_LOTTERY_VAULT_ABI,
        functionName: 'enter',
        chain: robinhoodChain,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    onSuccess: () => {
      refetchEntered();
      onChanged();
    },
  });

  // Reading the clock during render would freeze this at mount time, leaving Enter live after the
  // window shut and sending holders into a revert. Stay closed until the parent's clock starts.
  const entryOpen =
    state.phase === LOTTERY_PHASE.Entering && nowSeconds > 0 && nowSeconds < state.entryEndsAt;
  const busy = enterMutation.isPending;

  return (
    <section className="pv-panel token-vault">
      <div className="pv-panel-bar">
        <span className="pv-panel-bar-label">vault · {symbol.toLowerCase()}</span>
        <span className="pv-badge">Lottery</span>
      </div>

      <div className="token-vault-headline">
        <div className="token-vault-headline-figure">
          {state.phase === LOTTERY_PHASE.Entering || state.phase === LOTTERY_PHASE.Committed
            ? `${formatEther(state.prizeWeth)} ETH`
            : `${formatEther(state.totalPrizePaid)} ETH`}
        </div>
        <p className="token-vault-headline-note">
          {state.phase === LOTTERY_PHASE.Entering || state.phase === LOTTERY_PHASE.Committed
            ? `Current pot · ${phaseLabel(state.phase)}`
            : state.totalPrizePaid > 0n
              ? 'Paid to winners so far.'
              : 'Fees fill a pot. Holders enter. One wallet wins.'}
        </p>
      </div>

      <p className="token-vault-claim">
        When enough fees accrue, a round opens. Hold {symbol}, press Enter before the window
        closes, and wait for the draw. One entrant wins the whole pot in WETH.
      </p>

      {entryOpen ? (
        <div className="token-rwa-headline-row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline-strong)' }}>
          <p className="token-vault-headline-note" style={{ margin: 0, marginRight: 'auto' }}>
            {entered
              ? 'You are in this round.'
              : isConnected
                ? 'Holding the token? Enter for a chance at the pot.'
                : 'Connect to enter.'}
          </p>
          {isConnected && !entered ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary token-vault-action"
              disabled={busy}
              onClick={() => enterMutation.mutate()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              <span className="ui-btn-label">
                {busy ? (isSwitching ? 'Switching network…' : 'Entering…') : 'Enter'}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {enterMutation.error ? (
        <p className="token-vault-claim">
          {enterMutation.error instanceof Error ? enterMutation.error.message : 'Enter failed.'}
        </p>
      ) : null}

      <div className="token-vault-body">
        <div className="token-vault-col">
          <header className="token-vault-col-head">
            <span>Vault</span>
          </header>
          <dl className="token-vault-rows">
            <div className="token-vault-row">
              <dt>Status</dt>
              <dd className="token-vault-prose">{phaseLabel(state.phase)}</dd>
            </div>
            <div className="token-vault-row">
              <dt>Rounds drawn</dt>
              <dd className="token-vault-prose">{state.roundCount}</dd>
            </div>
            <div className="token-vault-row">
              <dt>Entrants (current)</dt>
              <dd className="token-vault-prose">{state.entrantCount}</dd>
            </div>
            <div className="token-vault-row">
              <dt>Fees before a round</dt>
              <dd className="token-vault-prose">{formatWeth(state.minHarvestWei)}</dd>
            </div>
            <div className="token-vault-row">
              <dt>Fees waiting</dt>
              <dd className="token-vault-prose">{formatWeth(state.pendingWeth)}</dd>
            </div>
            {state.winner && state.winner !== '0x0000000000000000000000000000000000000000' ? (
              <div className="token-vault-row">
                <dt>Last winner</dt>
                <dd className="token-vault-prose">
                  {`${state.winner.slice(0, 6)}…${state.winner.slice(-4)}`}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </section>
  );
}
