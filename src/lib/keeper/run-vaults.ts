import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';
import { PONSVAULT_DEPLOYMENT } from '@/lib/pons/deployments';
import { PONS_TOKEN_ABI } from '@/lib/pons/token-state';
import {
  PONSVAULT_LAUNCHER_ABI,
  isVaultLauncherDeployed,
  vaultLauncherAddress,
} from '@/lib/pons/vault';
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
 * A backstop, not the pacing control. The vaults have no cooldown — a run
 * spends everything, so what really decides the cadence is how fast trading
 * refills the vault past the creator's floor and {@link DEFAULT_MIN_WETH}.
 * Keeping this at the cron interval means a busy token is served as soon as it
 * qualifies, while a bug or a duplicated scheduler still cannot spend a vault
 * on gas.
 *
 * Derived from the vault's own `lastRunAt` rather than kept in memory, so it
 * survives restarts and holds across however many schedulers are pointed at
 * this endpoint. Note the gap that leaves: `lastRunAt` only moves once a run
 * confirms, so two ticks overlapping in the same window both see the old value.
 * Keep this at or above the cron interval for that reason.
 */
const DEFAULT_MIN_INTERVAL_SECONDS = 300;

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
 *
 * `weth` is always the whole harvest, not the part any one template happens to
 * return. See {@link harvestedWeth} for why those differ.
 */
export type VaultRunOutcome = VaultRef &
  (
    | { status: 'ran'; hash: `0x${string}`; weth: string; tokens: string }
    | { status: 'would-run'; weth: string; tokens: string }
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

export interface RunDueVaultsOptions {
  /**
   * Decide everything, send nothing.
   *
   * Every threshold here is invisible from the outside until a run either
   * happens or conspicuously does not, which makes a change to the decision
   * logic hard to check without waiting for the next real burn. This runs the
   * same path and stops at the write, so "what would the keeper do right now"
   * is answerable on demand.
   */
  dryRun?: boolean;
}

function keeperAccount() {
  const key = (process.env.KEEPER_PRIVATE_KEY ?? '').trim();
  if (!key) throw new Error('KEEPER_PRIVATE_KEY is not set.');
  return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
}

/**
 * Why a call failed, in the most specific form available.
 *
 * The vaults revert with custom errors rather than strings, and viem renders
 * those as a message whose useful half — the error itself — sits on a second
 * line. Truncating at the newline, as this used to, logged every distinct
 * failure as the identical prefix `reverted with the following signature:`,
 * which made "nobody has staked" and "no fees yet" indistinguishable in the
 * tick history. Walking the error for the decoded name is what makes the
 * outcome readable; the string and shortMessage paths remain for reverts that
 * come from outside our own contracts, such as the router's.
 */
function reasonOf(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) {
        const args = reverted.data?.args;
        return args && args.length > 0 ? `${name}(${args.join(', ')})` : name;
      }
      if (reverted.reason) return reverted.reason;
      if (reverted.signature) return `Unrecognised error ${reverted.signature}`;
    }
  }

  if (!(error instanceof Error)) return 'Unknown error';
  const match = /reverted with the following reason:\s*\n?(.+)/.exec(error.message);
  if (match) return match[1].trim();
  const short = (error as { shortMessage?: string }).shortMessage;
  return (short ?? error.message).split('\n')[0].slice(0, 200);
}

const BPS_DENOMINATOR = 10_000n;

/**
 * A buyback vault's `burnBps`, read once and kept for the life of the process.
 *
 * Vault config is immutable, so the value read now is the value forever.
 */
const burnBpsCache = new Map<Address, bigint>();

async function burnBpsOf(vault: Address): Promise<bigint> {
  const cached = burnBpsCache.get(vault);
  if (cached !== undefined) return cached;

  const [burnBps] = await robinhoodPublicClient.readContract({
    address: vault,
    abi: PONS_VAULT_ABI,
    functionName: 'config',
  });

  const value = BigInt(burnBps);
  burnBpsCache.set(vault, value);
  return value;
}

/**
 * The WETH a run moves in total, from whatever its template chose to return.
 *
 * Staking returns everything it distributed, so it is already the whole
 * harvest. Buyback-and-burn returns only the slice it spends on the swap —
 * `wethBalance * burnBps / 10000` — while the remainder goes to the treasury in
 * the same call. Comparing that slice against the keeper's floor understates
 * every run by a factor of `1/burnBps`, so a vault burning 40% had to reach
 * 2.5x its own `minHarvestWei` before the keeper would act, even though the
 * contract's gate had long since opened. Scaling back up puts the keeper and
 * the vault on the same quantity, which is the one the creator configured.
 *
 * `burnBps` cannot be zero — the vault's own `_validate` rejects that — so the
 * division is always safe.
 */
async function harvestedWeth(vault: Address, template: VaultTemplate, returned: bigint): Promise<bigint> {
  if (template !== 'buyback-burn') return returned;

  try {
    const burnBps = await burnBpsOf(vault);
    if (burnBps <= 0n) return returned;
    return (returned * BPS_DENOMINATOR) / burnBps;
  } catch {
    // Fall back to the understated figure rather than skipping the vault: too
    // cautious costs a delayed run, guessing high costs a wasted transaction.
    return returned;
  }
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
 * Every vault the launcher has created, read from its own `Launched` events.
 *
 * The database is the primary list because it is one query and already carries
 * symbols. But a launch that succeeded on-chain and then failed to record — a
 * closed tab, a Supabase blip — would be invisible to it: a working vault that
 * no keeper ever touches, accruing fees with nothing to spend them. Reading the
 * launcher's own log closes that gap.
 *
 * Scans from the launcher's own deployment block, since nothing it emitted can
 * predate it. A launcher emits one event per launch and nothing else, so even a
 * full scan stays cheap.
 */
async function discoverVaultsOnChain(): Promise<VaultRef[]> {
  if (!isVaultLauncherDeployed()) return [];

  try {
    const logs = await robinhoodPublicClient.getContractEvents({
      address: vaultLauncherAddress(),
      abi: PONSVAULT_LAUNCHER_ABI,
      eventName: 'Launched',
      fromBlock: PONSVAULT_DEPLOYMENT.startBlock,
      toBlock: 'latest',
    });

    return logs.flatMap((log) => {
      const { token, vault } = log.args;
      if (!token || !vault) return [];
      return [{ token, vault, symbol: '' }];
    });
  } catch {
    // A safety net must not become a new way for the whole tick to fail.
    return [];
  }
}

/** Ticker for a vault found on-chain, where no database row supplied one. */
async function tokenSymbol(token: Address): Promise<string> {
  try {
    return await robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'symbol',
    });
  } catch {
    return '???';
  }
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
export async function runDueVaults(options: RunDueVaultsOptions = {}): Promise<KeeperTickResult> {
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

  const byToken = new Map<string, VaultRef>();
  for (const launch of await listPonsVaultLaunches(200)) {
    if (!launch.vault) continue;
    byToken.set(launch.token.toLowerCase(), {
      token: launch.token as Address,
      vault: launch.vault as Address,
      symbol: launch.symbol,
    });
  }

  // Anything the database missed. Recorded rows win, since they already know the
  // ticker and cost nothing more to use.
  for (const found of await discoverVaultsOnChain()) {
    const key = found.token.toLowerCase();
    if (byToken.has(key)) continue;
    byToken.set(key, { ...found, symbol: await tokenSymbol(found.token) });
  }

  const vaults = [...byToken.values()];

  const outcomes: VaultRunOutcome[] = [];
  let ran = 0;

  for (const { token, vault, symbol } of vaults) {
    // The templates differ in `run`'s signature, so nothing below can be built
    // until this is known.
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
      const lastRunAt = await robinhoodPublicClient.readContract({
        address: vault,
        abi: PONS_VAULT_ABI,
        functionName: 'lastRunAt',
      });

      const nextRunAt = Number(lastRunAt) + minInterval;
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

    let returnedWeth: bigint;
    let tokens: bigint;
    try {
      [returnedWeth, tokens] = await runner.simulate();
    } catch (error) {
      outcomes.push({ ...ref, status: 'not-ready', reason: reasonOf(error) });
      continue;
    }

    // Every decision below is about the whole harvest, which is not what every
    // template returns.
    const weth = await harvestedWeth(vault, template, returnedWeth);

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

    if (options.dryRun) {
      outcomes.push({
        ...ref,
        status: 'would-run',
        weth: formatEther(weth),
        tokens: formatEther(tokens),
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
