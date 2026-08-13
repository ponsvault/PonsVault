'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Flame, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Address } from 'viem';
import { useAccount, useConnect, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';

import { robinhoodChain } from '@/lib/pons/chain';
import { PONS_CHAIN_ID } from '@/lib/pons/constants';
import {
  describeCadence,
  formatTokens,
  formatWeth,
  supplyPercent,
  toBigInt,
} from '@/lib/pons/vault-format';
import {
  PONS_VAULT_ABI,
  fetchVaultState,
  type BuybackVaultState,
} from '@/lib/pons/vault-state';
import { cn, explorerAddressUrl, shortAddress } from '@/lib/utils';

import { TokenLotteryPanel } from './token-lottery-panel';
import { TokenRwaPanel } from './token-rwa-panel';
import { TokenStakingPanel } from './token-staking-panel';

interface TokenVaultPanelProps {
  token: Address;
  symbol: string;
  /** Creator-share fees still sitting in the locker, as wei strings. */
  pendingCreatorWeth?: string | null;
  pendingCreatorToken?: string | null;
  /** Creator cut of pool fees, e.g. 70. Used only for the queued label. */
  creatorSharePercent?: number;
}

/**
 * What the action button should do and say, given the vault's current state.
 *
 * `harvestable` is deliberately not `state.canRun`. On-chain, `canRun()` only
 * looks at WETH already sitting in the vault, while `run()` sweeps the locker
 * first — so the contract reports "nothing to run" in exactly the normal case
 * where fees are waiting in the locker. Judging it on what `run()` will
 * actually collect keeps the button honest.
 */
function resolveAction(state: BuybackVaultState, harvestable: bigint, isConnected: boolean) {
  if (harvestable === 0n) {
    return {
      label: 'Nothing to burn yet',
      disabled: true,
      hint: 'No fees have accrued since the last run. The vault runs again once trading produces more.',
    };
  }
  if (harvestable < state.minHarvestWei) {
    return {
      label: 'Below minimum',
      disabled: true,
      hint: `Fees are accruing, but this vault waits until ${formatWeth(state.minHarvestWei)} WETH so a run is worth its gas.`,
    };
  }
  return {
    label: isConnected ? 'Run vault' : 'Connect to run',
    disabled: false,
    hint: 'The keeper will do this on its own shortly. You can go first if you like — the call has no owner, and you pay only the gas.',
  };
}

/**
 * Resolves which template a token's vault is and hands off to its panel.
 *
 * The templates share nothing but the fee source: different configs, different
 * stats, and in staking's case a whole interactive position. Splitting them
 * here keeps each panel able to speak plainly about what its vault does.
 */
export function TokenVaultPanel({
  token,
  symbol,
  pendingCreatorWeth,
  pendingCreatorToken,
  creatorSharePercent = 70,
}: TokenVaultPanelProps) {
  const publicClient = usePublicClient();

  // Drives the stake lock countdown. Starts at 0 so the server render and the
  // first client render agree, then ticks once a second.
  const [nowSeconds, setNowSeconds] = useState(0);
  useEffect(() => {
    const tick = () => setNowSeconds(Math.floor(Date.now() / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const {
    data: state,
    error: stateError,
    refetch,
  } = useQuery({
    queryKey: ['token-vault', token],
    queryFn: () => fetchVaultState(publicClient!, token),
    enabled: !!publicClient,
    refetchInterval: 20_000,
  });

  // A token with no vault renders nothing, but a vault we failed to read is
  // worth saying out loud: silence there looks identical to having no vault.
  if (stateError) {
    return (
      <section className="pv-panel token-vault">
        <div className="pv-panel-bar">
          <span className="pv-panel-bar-label">vault · {symbol.toLowerCase()}</span>
        </div>
        <p className="token-vault-claim">
          Could not read this token&rsquo;s vault from the chain.{' '}
          {stateError instanceof Error ? stateError.message : ''}
        </p>
      </section>
    );
  }

  if (!state) return null;

  if (state.template === 'staking') {
    return (
      <TokenStakingPanel
        token={token}
        symbol={symbol}
        state={state}
        nowSeconds={nowSeconds}
        harvestable={state.pendingWeth + toBigInt(pendingCreatorWeth)}
        creatorSharePercent={creatorSharePercent}
        onChanged={() => refetch()}
      />
    );
  }

  if (state.template === 'rwa') {
    return <TokenRwaPanel symbol={symbol} state={state} onChanged={() => refetch()} />;
  }

  if (state.template === 'lottery') {
    return (
      <TokenLotteryPanel
        symbol={symbol}
        state={state}
        nowSeconds={nowSeconds}
        onChanged={() => refetch()}
      />
    );
  }

  return (
    <BuybackVaultPanel
      symbol={symbol}
      state={state}
      pendingCreatorWeth={pendingCreatorWeth}
      pendingCreatorToken={pendingCreatorToken}
      creatorSharePercent={creatorSharePercent}
      onChanged={() => refetch()}
    />
  );
}

interface BuybackVaultPanelProps {
  symbol: string;
  state: BuybackVaultState;
  pendingCreatorWeth?: string | null;
  pendingCreatorToken?: string | null;
  creatorSharePercent: number;
  onChanged: () => void;
}

function BuybackVaultPanel({
  symbol,
  state,
  pendingCreatorWeth,
  pendingCreatorToken,
  creatorSharePercent,
  onChanged,
}: BuybackVaultPanelProps) {
  const publicClient = usePublicClient();
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [error, setError] = useState('');

  const runMutation = useMutation({
    mutationFn: async () => {
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

      const hash = await walletClient.writeContract({
        account: address,
        chain: robinhoodChain,
        address: state.vault,
        abi: PONS_VAULT_ABI,
        functionName: 'run',
        // No floor, matching the keeper. The vault buys at whatever the pool
        // quotes at that moment.
        args: [0n],
      });

      await publicClient!.waitForTransactionReceipt({ hash });
    },
    onSuccess: () => {
      setError('');
      onChanged();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Transaction failed.');
    },
  });

  const burnPercent = state.burnBps / 100;
  const treasuryPercent = 100 - burnPercent;

  // What the next run() would work with: already swept, plus still in the locker.
  const lockerWeth = toBigInt(pendingCreatorWeth);
  const lockerToken = toBigInt(pendingCreatorToken);
  const harvestable = state.pendingWeth + lockerWeth;
  const burnableNow = state.pendingToken + lockerToken;

  const action = resolveAction(state, harvestable, isConnected);
  const busy = runMutation.isPending || isConnecting || isSwitching;
  const live = !action.disabled;

  return (
    <section className="pv-panel token-vault">
      <div className="pv-panel-bar">
        <span className="pv-panel-bar-label">vault · {symbol.toLowerCase()}</span>
        <span className="pv-badge">Buyback &amp; Burn</span>
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
          <Flame className="h-4 w-4" strokeWidth={2} />
          <span className="pv-mono">
            {formatTokens(state.totalTokensBurned)} {symbol.toUpperCase()}
          </span>
        </div>
        <p className="token-vault-headline-note">
          burned so far — {supplyPercent(state.totalTokensBurned).toFixed(3)}% of total supply,
          across {state.runCount.toString()} {state.runCount === 1n ? 'run' : 'runs'}. Verify it at
          the{' '}
          <a
            href={explorerAddressUrl('0x000000000000000000000000000000000000dEaD')}
            target="_blank"
            rel="noreferrer"
          >
            burn address
          </a>
          .
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
            <strong>It runs on its own.</strong> A keeper watches for accrued fees and triggers the
            vault once enough have built up — nobody has to claim anything. The vault sweeps what
            it is owed and spends the WETH buying {symbol.toUpperCase()} on the open market at
            whatever the pool quotes at that moment.
          </p>
        </li>
        <li>
          <span className="token-vault-step-n">3</span>
          <p>
            <strong>Tokens are burned.</strong> Everything bought goes to{' '}
            <span className="pv-mono">0x…dEaD</span> in a normal transfer, permanently out of
            supply.
          </p>
        </li>
      </ol>

      <p className="token-vault-claim">
        <strong>These fees cannot be claimed.</strong> The redirect to this vault is set once, by
        the contract that deployed the token, and no function exists to point it anywhere else —
        not for the creator, and not for us. There is nothing to withdraw.
      </p>

      <div className="token-vault-body">
        <div className="token-vault-col">
          <header className="token-vault-col-head">
            <span>Configuration</span>
            <span className="pv-badge">Immutable</span>
          </header>
          <dl className="token-vault-rows">
            <div className="token-vault-row">
              <dt>Burn share</dt>
              <dd className="pv-mono">{burnPercent}% of fees</dd>
            </div>
            {treasuryPercent > 0 ? (
              <div className="token-vault-row">
                <dt>Treasury</dt>
                <dd className="pv-mono">
                  {treasuryPercent}% ·{' '}
                  <a href={explorerAddressUrl(state.treasury)} target="_blank" rel="noreferrer">
                    {shortAddress(state.treasury)}
                  </a>
                </dd>
              </div>
            ) : null}
            <div className="token-vault-row">
              <dt>Runs</dt>
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
            <span>Lifetime</span>
            <span className="pv-mono token-vault-runs">
              {state.runCount.toString()} {state.runCount === 1n ? 'run' : 'runs'}
            </span>
          </header>
          <dl className="token-vault-rows">
            <div className="token-vault-row">
              <dt>
                <Flame className="h-3 w-3" strokeWidth={2} />
                Burned
              </dt>
              <dd className="pv-mono">
                {formatTokens(state.totalTokensBurned)} {symbol.toUpperCase()}
              </dd>
            </div>
            <div className="token-vault-row">
              <dt>Supply removed</dt>
              <dd className="pv-mono">{supplyPercent(state.totalTokensBurned).toFixed(3)}%</dd>
            </div>
            {treasuryPercent > 0 ? (
              <div className="token-vault-row">
                <dt>Treasury paid</dt>
                <dd className="pv-mono">{formatWeth(state.totalTreasuryPaid)} WETH</dd>
              </div>
            ) : null}
            <div className="token-vault-row">
              <dt>Last run</dt>
              <dd className="pv-mono">
                {state.lastRunAt === 0n
                  ? 'Never'
                  : new Date(Number(state.lastRunAt) * 1000).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {error ? <div className="launchpad-alert token-vault-alert">{error}</div> : null}

      <footer className="token-vault-foot">
        <div className="token-vault-pending">
          <span className="token-vault-pending-label">Queued for the next burn</span>
          <span className="pv-mono token-vault-pending-value">
            {formatWeth(harvestable)} WETH
            {burnableNow > 0n ? ` + ${formatTokens(burnableNow)} ${symbol.toUpperCase()}` : ''}
          </span>
          <span className="token-vault-pending-scope">
            Vault share only — the {creatorSharePercent}% creator cut. Pool fees below show the
            full gross.
          </span>
          <span className="token-vault-hint">{action.hint}</span>
        </div>
        <button
          type="button"
          className={cn('ui-btn ui-btn-primary token-vault-action', action.disabled && 'is-blocked')}
          disabled={busy || action.disabled}
          onClick={() => runMutation.mutate()}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          <span className="ui-btn-label">{action.label}</span>
        </button>
      </footer>
    </section>
  );
}
