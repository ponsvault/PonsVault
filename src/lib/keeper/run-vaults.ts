import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  formatEther,
  http,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';
import { PONSVAULT_DEPLOYMENT } from '@/lib/pons/deployments';
import { PONS_WETH } from '@/lib/pons/contracts';
import { PONS_TOKEN_ABI } from '@/lib/pons/token-state';
import {
  PONSVAULT_LAUNCHER_ABI,
  isVaultLauncherDeployed,
  vaultLauncherAddress,
} from '@/lib/pons/vault';
import { PONSVAULT_V2_DEPLOYMENT, isV2VaultLauncherDeployed } from '@/lib/pons/v2-deployments';
import {
  PONSVAULT_V2_LAUNCHER_ABI,
  PONS_V2_VAULT_FACTORY_ABI,
  v2VaultLauncherAddress,
} from '@/lib/pons/v2-vault';
import { PONS_STAKING_VAULT_ABI, PONS_VAULT_ABI } from '@/lib/pons/vault-state';
import { listPonsVaultLaunches } from '@/lib/launch-registry/store';
import { PONS_LOTTERY_VAULT_ABI } from '@/lib/lottery/abi';
import { PONS_RWA_VAULT_ABI } from '@/lib/rwa/abi';
import { quoteToWeth } from '@/lib/rwa/asset-health';
import { advanceLotteryDraw, type DrawOutcome } from './lottery-draws';
import { postPendingRoots, type RootOutcome } from './post-rwa-roots';

/**
 * Value a run must move, as a multiple of the gas it costs.
 *
 * Stops the keeper from spending more on gas than the harvest is worth. The
 * amount that opens a run is not decided here — that is the creator's own
 * `minHarvestWei`, enforced by the vault when `run` is simulated.
 */
const DEFAULT_MIN_VALUE_RATIO = 3;

/**
 * Minimum seconds between keeper runs of the same vault.
 *
 * A backstop, not the pacing control. The vaults have no cooldown — a run
 * spends everything, so the cadence is however fast trading refills past the
 * creator's `minHarvestWei`. Keeping this at the cron interval means a busy
 * token is served as soon as it qualifies, while a bug or a duplicated
 * scheduler still cannot spend a vault on gas.
 *
 * Derived from the vault's own `lastRunAt` rather than kept in memory, so it
 * survives restarts and holds across however many schedulers are pointed at
 * this endpoint. Note the gap that leaves: `lastRunAt` only moves once a run
 * confirms, so two ticks overlapping in the same window both see the old value.
 * Keep this at or above the cron interval for that reason.
 */
const DEFAULT_MIN_INTERVAL_SECONDS = 300;

type VaultTemplate = 'buyback-burn' | 'staking' | 'rwa' | 'lottery';

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
    | {
        status: 'ran';
        hash: `0x${string}`;
        weth: string;
        tokens: string;
        /** RWA only: what happened to each round's allocation after the run. */
        roots?: RootOutcome[];
        /** Lottery only: commit/reveal progress on the open round. */
        draw?: DrawOutcome;
      }
    | { status: 'would-run'; weth: string; tokens: string }
    | { status: 'not-ready'; reason: string }
    | { status: 'throttled'; nextRunIn: number }
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
 * the same call. Gas-ratio checks need the whole harvest, so buyback is scaled
 * back up by `10000 / burnBps`.
 *
 * `burnBps` cannot be zero — the vault's own `_validate` rejects that — so the
 * division is always safe.
 */
/**
 * What an RWA round is worth, in the WETH the gas comparison is denominated in.
 *
 * An RWA run returns a round id and an amount of stock, neither of which can be
 * compared to a gas cost. Selling that stock back is the honest conversion, and
 * it reads slightly low, which errs toward skipping a marginal run rather than
 * overpaying for one.
 *
 * Falls back to the creator's own floor when the pool cannot be quoted. That is
 * a real lower bound rather than a guess: `run` only gets as far as returning
 * anything if it had at least `minHarvestWei` of WETH to spend.
 */
async function rwaRoundValue(vault: Address, rwaBought: bigint): Promise<bigint> {
  const [asset, poolFee, minHarvestWei] = await robinhoodPublicClient.readContract({
    address: vault,
    abi: PONS_RWA_VAULT_ABI,
    functionName: 'config',
  });

  try {
    const quoted = await quoteToWeth(asset, poolFee, rwaBought);
    if (quoted !== null && quoted > 0n) return quoted;
  } catch {
    // Unreachable quoter, not an unusable pool. Fall through to the bound.
  }

  return minHarvestWei;
}

async function harvestedWeth(vault: Address, template: VaultTemplate, returned: bigint): Promise<bigint> {
  if (template === 'rwa') return rwaRoundValue(vault, returned);
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
  if (template === 'rwa') {
    // Same shape as buyback's `run`, but the returns mean something else
    // entirely: a round id and the RWA bought, not WETH and tokens. Reusing the
    // buyback branch would read round zero as "no WETH moved" and park every
    // RWA vault below the floor forever, which is silent rather than loud.
    const call = { address: vault, abi: PONS_RWA_VAULT_ABI, functionName: 'run', args: [0n] } as const;
    return {
      simulate: () => robinhoodPublicClient.simulateContract({ ...call, account }).then((r) => r.result),
      estimateGas: () => robinhoodPublicClient.estimateContractGas({ ...call, account }),
      write: () => wallet.writeContract({ ...call, account, chain: robinhoodChain }),
    };
  }

  if (template === 'lottery') {
    // Returns (roundId, prizeWeth). Prize is the whole pot — use the second slot
    // for value checks, same as RWA.
    const call = { address: vault, abi: PONS_LOTTERY_VAULT_ABI, functionName: 'run', args: [] } as const;
    return {
      simulate: () => robinhoodPublicClient.simulateContract({ ...call, account }).then((r) => r.result),
      estimateGas: () => robinhoodPublicClient.estimateContractGas({ ...call, account }),
      write: () => wallet.writeContract({ ...call, account, chain: robinhoodChain }),
    };
  }

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
  const found: VaultRef[] = [];

  if (isVaultLauncherDeployed()) {
    try {
      const logs = await robinhoodPublicClient.getContractEvents({
        address: vaultLauncherAddress(),
        abi: PONSVAULT_LAUNCHER_ABI,
        eventName: 'Launched',
        fromBlock: PONSVAULT_DEPLOYMENT.startBlock,
        toBlock: 'latest',
      });

      for (const log of logs) {
        const { token, vault } = log.args;
        if (!token || !vault) continue;
        found.push({ token, vault, symbol: '' });
      }
    } catch {
      // A safety net must not become a new way for the whole tick to fail.
    }
  }

  if (isV2VaultLauncherDeployed()) {
    try {
      const logs = await robinhoodPublicClient.getContractEvents({
        address: v2VaultLauncherAddress(),
        abi: PONSVAULT_V2_LAUNCHER_ABI,
        eventName: 'Launched',
        fromBlock: PONSVAULT_V2_DEPLOYMENT.startBlock,
        toBlock: 'latest',
      });

      for (const log of logs) {
        const { token, vault } = log.args;
        if (!token || !vault) continue;
        found.push({ token, vault, symbol: '' });
      }
    } catch {
      // Same: discovery is best-effort.
    }

    // User-as-deployer launches skip the launcher and emit VaultCreated on each factory.
    for (const factory of [
      PONSVAULT_V2_DEPLOYMENT.buybackFactory,
      PONSVAULT_V2_DEPLOYMENT.stakingFactory,
      PONSVAULT_V2_DEPLOYMENT.rwaFactory,
    ]) {
      if (!factory || factory.length !== 42) continue;
      try {
        const logs = await robinhoodPublicClient.getContractEvents({
          address: factory as `0x${string}`,
          abi: PONS_V2_VAULT_FACTORY_ABI,
          eventName: 'VaultCreated',
          fromBlock: PONSVAULT_V2_DEPLOYMENT.startBlock,
          toBlock: 'latest',
        });
        for (const log of logs) {
          const { token, vault } = log.args;
          if (!token || !vault) continue;
          found.push({ token, vault, symbol: '' });
        }
      } catch {
        // Best-effort per factory.
      }
    }
  }

  return found;
}

const QUOTE_ASSET_ABI = [
  {
    type: 'function',
    name: 'quoteAsset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

/** True when harvest value is denominated in WETH (v1). v2 quote assets skip ETH gas ratio. */
async function harvestIsWeth(vault: Address): Promise<boolean> {
  try {
    const quote = await robinhoodPublicClient.readContract({
      address: vault,
      abi: QUOTE_ASSET_ABI,
      functionName: 'quoteAsset',
    });
    return quote.toLowerCase() === PONS_WETH.toLowerCase();
  } catch {
    // v1 buyback vaults have no quoteAsset() — harvest is WETH.
    return true;
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
  const minInterval = Number(process.env.KEEPER_MIN_INTERVAL_SECONDS ?? DEFAULT_MIN_INTERVAL_SECONDS);
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
      template =
        reported === 'staking'
          ? 'staking'
          : reported === 'rwa'
            ? 'rwa'
            : reported === 'lottery'
              ? 'lottery'
              : 'buyback-burn';
    } catch {
      // Vaults deployed before `template()` existed are all buyback-and-burn.
      template = 'buyback-burn';
    }

    const ref: VaultRef = { token, vault, symbol, template };

    // Lottery rounds need commit/reveal on a schedule independent of opening a
    // new pot — advance those first so a busy entry window still settles.
    if (template === 'lottery') {
      const draw = await advanceLotteryDraw({
        vault,
        account,
        wallet,
        dryRun: options.dryRun,
      });
      if (draw.status === 'failed') {
        outcomes.push({ ...ref, status: 'failed', reason: draw.reason });
      } else if (draw.status !== 'idle') {
        outcomes.push({
          ...ref,
          status: 'ran',
          hash: draw.hash,
          weth: '0',
          tokens: '0',
          draw,
        });
        ran += 1;
      }
    }

    const runner = vaultRunner(vault, template, account, wallet);

    // Checked before simulating: a throttled vault should cost nothing to skip.
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
    } catch (error) {
      outcomes.push({ ...ref, status: 'failed', reason: reasonOf(error) });
      continue;
    }

    let first: bigint;
    let second: bigint;
    try {
      [first, second] = await runner.simulate();
    } catch (error) {
      outcomes.push({ ...ref, status: 'not-ready', reason: reasonOf(error) });
      continue;
    }

    // Buyback and staking return (weth, tokens). RWA/lottery return (roundId,
    // amount), so the first slot is an identifier and carries no value.
    const measured = template === 'rwa' || template === 'lottery' ? second : first;
    const tokens = second;

    // Every decision below is about the whole harvest, which is not what every
    // template returns.
    const weth = await harvestedWeth(vault, template, measured);

    // A run that moves nothing at all is a wasted transaction even if it succeeds.
    // Amount gates are the creator's: `simulate` already failed under their
    // `minHarvestWei`, so anything that got this far cleared the vault's own floor.
    if (weth === 0n && tokens === 0n) {
      outcomes.push({ ...ref, status: 'not-ready', reason: 'Nothing to distribute' });
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

    // WETH harvests are 1:1 with the gas currency. v2 vaults harvest AAPL/USDG/etc.,
    // so an ETH gas ratio would falsely skip every ready vault — skip the gate there.
    if (await harvestIsWeth(vault)) {
      if (weth < gasCost * BigInt(Math.max(1, Math.round(minValueRatio)))) {
        outcomes.push({
          ...ref,
          status: 'uneconomic',
          weth: formatEther(weth),
          gasCost: formatEther(gasCost),
        });
        continue;
      }
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

      // An RWA round pays nobody until its allocation is published, so this is
      // part of the run rather than a follow-up. It is deliberately not allowed
      // to undo the run: the swap has already happened and the round exists, so
      // a failure here is reported and retried next tick, not treated as the
      // run having failed.
      let roots: RootOutcome[] | undefined;
      if (template === 'rwa') {
        try {
          roots = await postPendingRoots({ token, vault, account, wallet });
        } catch (error) {
          roots = [{ roundId: -1, status: 'failed', reason: reasonOf(error) }];
        }
      }

      outcomes.push({
        ...ref,
        status: 'ran',
        hash,
        weth: formatEther(weth),
        tokens: formatEther(tokens),
        ...(roots ? { roots } : {}),
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
