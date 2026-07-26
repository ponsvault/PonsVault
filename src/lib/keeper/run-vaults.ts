import { createWalletClient, formatEther, http, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';
import { PONS_STAKING_VAULT_ABI, PONS_VAULT_ABI } from '@/lib/pons/vault-state';
import { listPonsVaultLaunches } from '@/lib/launch-registry/store';

/**
 * Value a run must move, as a multiple of the gas it costs.
 *
 * A floor against spending more on gas than the run is worth. On its own this
 * is far too weak to be the only throttle: gas here costs fractions of a cent,
 * so almost any dust clears it. The two limits below do the real work.
 */
const DEFAULT_MIN_VALUE_RATIO = 3;

/**
 * WETH a run should spend before the keeper bothers, regardless of gas.
 *
 * Not an economic limit — a run costs a few cents of gas, so almost any amount
 * pays for itself. It is a legibility one: fees trickle in continuously, and
 * without a floor the keeper burns whatever landed in the last few minutes,
 * turning the burn history into dust entries instead of events worth reading.
 */
const DEFAULT_MIN_WETH = '0.025';

/**
 * How long a vault may sit on fees it cannot yet justify burning.
 *
 * A flat floor alone punishes exactly the tokens that can least afford it: a
 * quiet launch would show "nothing burned yet" for a week, on the page where
 * someone is deciding whether the vault does anything at all. Past this age the
 * floor drops to {@link DEFAULT_DUST_WETH}, so slow tokens still burn daily and
 * busy ones still burn in meaningful chunks.
 */
const DEFAULT_MAX_IDLE_SECONDS = 86_400;

/** The floor once a vault is overdue. Still ~60x the gas a run costs. */
const DEFAULT_DUST_WETH = '0.002';

/**
 * Minimum seconds between keeper runs of the same vault.
 *
 * Derived from the vault's own `lastRunAt` rather than kept in memory, so it
 * survives restarts and holds across however many schedulers are pointed at
 * this endpoint. A creator's on-chain cooldown is honoured on top of this
 * whenever it is the stricter of the two.
 */
const DEFAULT_MIN_INTERVAL_SECONDS = 3600;

type VaultTemplate = 'buyback-burn' | 'staking';

interface VaultRef {
  token: Address;
  vault: Address;
  symbol: string;
  template?: VaultTemplate;
}

/**
 * `weth` and `tokens` are what a run moved, deliberately named for neither
 * template: buyback-and-burn spends the WETH and burns the tokens, staking
 * hands both to its stakers.
 */
export type VaultRunOutcome = VaultRef &
  (
    | { status: 'ran'; hash: `0x${string}`; weth: string; tokens: string }
    | { status: 'not-ready'; reason: string }
    | { status: 'throttled'; nextRunIn: number }
    | { status: 'below-floor'; weth: string; floor: string }
    | { status: 'uneconomic'; weth: string; gasCost: string }
    | { status: 'failed'; reason: string }
  );

export interface KeeperTickResult {
  keeper: Address;
  balance: string;
  checked: number;
  ran: number;
  outcomes: VaultRunOutcome[];
}

function keeperAccount() {
  const key = (process.env.KEEPER_PRIVATE_KEY ?? '').trim();
  if (!key) throw new Error('KEEPER_PRIVATE_KEY is not set.');
  return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
}

/** Reverts carry the contract's own reason; anything else is a plain message. */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';
  const match = /reverted with the following reason:\s*\n?(.+)/.exec(error.message);
  if (match) return match[1].trim();
  const short = (error as { shortMessage?: string }).shortMessage;
  return (short ?? error.message).split('\n')[0].slice(0, 200);
}

/** The creator's own cooldown, which sits at a different index per template. */
async function readCooldown(vault: Address, template: VaultTemplate): Promise<number> {
  if (template === 'staking') {
    const config = await robinhoodPublicClient.readContract({
      address: vault,
      abi: PONS_STAKING_VAULT_ABI,
      functionName: 'config',
    });
    return Number(config[2]);
  }

  const config = await robinhoodPublicClient.readContract({
    address: vault,
    abi: PONS_VAULT_ABI,
    functionName: 'config',
  });
  return Number(config[3]);
}

type Keeper = ReturnType<typeof keeperAccount>;
type Wallet = ReturnType<typeof createWalletClient>;

/**
 * The three ways the keeper touches `run`, bound to one template.
 *
 * Each template has its own `run` signature, and viem resolves argument and
 * return types from the ABI, so the call cannot be built once and reused
 * across both. Choosing the template here keeps each call concretely typed
 * and leaves the decision logic below template-agnostic.
 */
function vaultRunner(vault: Address, template: VaultTemplate, account: Keeper, wallet: Wallet) {
  if (template === 'staking') {
    const call = { address: vault, abi: PONS_STAKING_VAULT_ABI, functionName: 'run', args: [] } as const;
    return {
      simulate: () => robinhoodPublicClient.simulateContract({ ...call, account }).then((r) => r.result),
      estimateGas: () => robinhoodPublicClient.estimateContractGas({ ...call, account }),
      write: () => wallet.writeContract({ ...call, account, chain: robinhoodChain }),
    };
  }

  const call = { address: vault, abi: PONS_VAULT_ABI, functionName: 'run', args: [0n] } as const;
  return {
    simulate: () => robinhoodPublicClient.simulateContract({ ...call, account }).then((r) => r.result),
    estimateGas: () => robinhoodPublicClient.estimateContractGas({ ...call, account }),
    write: () => wallet.writeContract({ ...call, account, chain: robinhoodChain }),
  };
}

/**
 * Runs every vault that is currently worth running.
 *
 * Readiness is decided by simulating `run()` rather than by reading `canRun()`:
 * the latter only sees WETH already swept into the vault, while `run()` pulls
 * from the locker first, so it reports "nothing to run" in the normal case
 * where fees are still sitting in the locker. A simulation answers the only
 * question that matters — would this transaction succeed, and what would it do.
 */
export async function runDueVaults(): Promise<KeeperTickResult> {
  const account = keeperAccount();
  const wallet = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC_URL),
  });

  const minValueRatio = Number(process.env.KEEPER_MIN_VALUE_RATIO ?? DEFAULT_MIN_VALUE_RATIO);
  const minWeth = parseEther(process.env.KEEPER_MIN_WETH ?? DEFAULT_MIN_WETH);
  const dustWeth = parseEther(process.env.KEEPER_DUST_WETH ?? DEFAULT_DUST_WETH);
  const minInterval = Number(process.env.KEEPER_MIN_INTERVAL_SECONDS ?? DEFAULT_MIN_INTERVAL_SECONDS);
  const maxIdle = Number(process.env.KEEPER_MAX_IDLE_SECONDS ?? DEFAULT_MAX_IDLE_SECONDS);
  const now = Math.floor(Date.now() / 1000);

  const launches = await listPonsVaultLaunches(200);
  const vaults = launches.filter((launch) => !!launch.vault);

  const outcomes: VaultRunOutcome[] = [];
  let ran = 0;

  for (const launch of vaults) {
    const token = launch.token as Address;
    const vault = launch.vault as Address;
    const symbol = launch.symbol;

    // The templates differ in `run`'s signature and in where the cooldown sits
    // in their config, so nothing below can be built until this is known.
    let template: VaultTemplate;
    try {
      const reported = await robinhoodPublicClient.readContract({
        address: vault,
        abi: PONS_VAULT_ABI,
        functionName: 'template',
      });
      template = reported === 'staking' ? 'staking' : 'buyback-burn';
    } catch {
      // Vaults deployed before `template()` existed are all buyback-and-burn.
      template = 'buyback-burn';
    }

    const ref: VaultRef = { token, vault, symbol, template };
    const runner = vaultRunner(vault, template, account, wallet);

    // Checked before simulating: a throttled vault should cost nothing to skip.
    let overdue: boolean;
    try {
      const [lastRunAt, cooldown] = await Promise.all([
        robinhoodPublicClient.readContract({ address: vault, abi: PONS_VAULT_ABI, functionName: 'lastRunAt' }),
        readCooldown(vault, template),
      ]);

      const wait = Math.max(minInterval, cooldown);
      const nextRunAt = Number(lastRunAt) + wait;
      if (lastRunAt !== 0n && now < nextRunAt) {
        outcomes.push({ ...ref, status: 'throttled', nextRunIn: nextRunAt - now });
        continue;
      }

      // A vault that has never run counts as overdue, so a quiet launch shows
      // a burn early rather than looking inert while it creeps toward the floor.
      overdue = lastRunAt === 0n || now - Number(lastRunAt) >= maxIdle;
    } catch (error) {
      outcomes.push({ ...ref, status: 'failed', reason: reasonOf(error) });
      continue;
    }

    let weth: bigint;
    let tokens: bigint;
    try {
      [weth, tokens] = await runner.simulate();
    } catch (error) {
      outcomes.push({ ...ref, status: 'not-ready', reason: reasonOf(error) });
      continue;
    }

    // A run that moves nothing at all is a wasted transaction even if it succeeds.
    if (weth === 0n && tokens === 0n) {
      outcomes.push({ ...ref, status: 'not-ready', reason: 'Nothing to distribute' });
      continue;
    }

    // Let the fees keep accumulating rather than acting on a trickle of them —
    // unless this vault has been sitting on them long enough to look inert.
    const floor = overdue ? dustWeth : minWeth;
    if (weth < floor) {
      outcomes.push({
        ...ref,
        status: 'below-floor',
        weth: formatEther(weth),
        floor: formatEther(floor),
      });
      continue;
    }

    let gasCost: bigint;
    try {
      const [gas, gasPrice] = await Promise.all([
        runner.estimateGas(),
        robinhoodPublicClient.getGasPrice(),
      ]);
      gasCost = gas * gasPrice;
    } catch (error) {
      outcomes.push({ ...ref, status: 'failed', reason: reasonOf(error) });
      continue;
    }

    // WETH is 1:1 with the gas currency, so the two are directly comparable.
    // Token-side fees ride along on top and only make the trade better, so
    // leaving them out of the comparison keeps the guard conservative.
    if (weth < gasCost * BigInt(Math.max(1, Math.round(minValueRatio)))) {
      outcomes.push({
        ...ref,
        status: 'uneconomic',
        weth: formatEther(weth),
        gasCost: formatEther(gasCost),
      });
      continue;
    }

    try {
      // Sent one at a time: parallel sends from one account collide on nonce.
      const hash = await runner.write();
      const receipt = await robinhoodPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        outcomes.push({ ...ref, status: 'failed', reason: `Reverted in ${hash}` });
        continue;
      }
      ran += 1;
      outcomes.push({
        ...ref,
        status: 'ran',
        hash,
        weth: formatEther(weth),
        tokens: formatEther(tokens),
      });
    } catch (error) {
      outcomes.push({ ...ref, status: 'failed', reason: reasonOf(error) });
    }
  }

  const balance = await robinhoodPublicClient.getBalance({ address: account.address });

  return {
    keeper: account.address,
    balance: formatEther(balance),
    checked: vaults.length,
    ran,
    outcomes,
  };
}
