import type { Address, PublicClient } from 'viem';

import { PONSVAULT_LAUNCHER_ABI, isVaultLauncherDeployed, vaultLauncherAddress } from './vault';

/** Reads and actions exposed by a deployed PonsBuybackBurnVault. */
export const PONS_VAULT_ABI = [
  {
    type: 'function',
    name: 'config',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'burnBps', type: 'uint16' },
      { name: 'treasury', type: 'address' },
      { name: 'minHarvestWei', type: 'uint256' },
      { name: 'cooldown', type: 'uint32' },
      { name: 'twapWindow', type: 'uint32' },
      { name: 'maxTickDeviation', type: 'int24' },
    ],
  },
  {
    type: 'function',
    name: 'canRun',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'ready', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'function',
    name: 'idleBalances',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'wethBalance', type: 'uint256' },
      { name: 'tokenBalance', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'isOracleReady',
    stateMutability: 'view',
    inputs: [{ name: 'window', type: 'uint32' }],
    outputs: [{ name: 'ready', type: 'bool' }],
  },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'totalWethHarvested', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalTokensBurned', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalTreasuryPaid', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'runCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastRunAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'run',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amountOutMinimum', type: 'uint256' }],
    outputs: [
      { name: 'wethSpent', type: 'uint256' },
      { name: 'tokensBurned', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'primeOracle',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'observationCardinalityNext', type: 'uint16' }],
    outputs: [],
  },
  { type: 'function', name: 'pool', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'template', stateMutability: 'pure', inputs: [], outputs: [{ type: 'string' }] },
] as const;

/** Reads and actions exposed by a deployed PonsStakingVault. */
export const PONS_STAKING_VAULT_ABI = [
  {
    type: 'function',
    name: 'config',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'lockPeriod', type: 'uint32' },
      { name: 'minHarvestWei', type: 'uint256' },
      { name: 'cooldown', type: 'uint32' },
    ],
  },
  {
    type: 'function',
    name: 'canRun',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'ready', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'function',
    name: 'unencumberedBalances',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'weth', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'positionOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'staked', type: 'uint256' },
      { name: 'pendingWeth', type: 'uint256' },
      { name: 'pendingToken', type: 'uint256' },
      { name: 'unlockAt', type: 'uint256' },
      { name: 'sharePpm', type: 'uint256' },
    ],
  },
  { type: 'function', name: 'totalStaked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'totalWethDistributed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalTokenDistributed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'runCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lastRunAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'run',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [
      { name: 'wethDistributed', type: 'uint256' },
      { name: 'tokenDistributed', type: 'uint256' },
    ],
  },
  { type: 'function', name: 'stake', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'unstake', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [
      { name: 'wethOut', type: 'uint256' },
      { name: 'tokenOut', type: 'uint256' },
    ],
  },
  { type: 'function', name: 'template', stateMutability: 'pure', inputs: [], outputs: [{ type: 'string' }] },
] as const;

/** Just enough of the V3 pool to see how much oracle history it can hold. */
const POOL_SLOT0_ABI = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
] as const;

/**
 * Observation slots requested when priming a pool's oracle.
 *
 * pons pools start at cardinality 1, which cannot serve a TWAP. The buffer then
 * fills as trades land in distinct blocks.
 */
export const ORACLE_CARDINALITY_TARGET = 64;

/** Everything every template has, whatever it does with the fees. */
interface VaultStateBase {
  vault: Address;
  minHarvestWei: bigint;
  cooldown: number;
  /** Fees sitting in the vault that have not been acted on yet. */
  pendingWeth: bigint;
  pendingToken: bigint;
  runCount: bigint;
  lastRunAt: bigint;
  canRun: boolean;
  canRunReason: string;
}

export interface BuybackVaultState extends VaultStateBase {
  template: 'buyback-burn';
  burnBps: number;
  treasury: Address;
  twapWindow: number;
  maxTickDeviation: number;
  totalWethHarvested: bigint;
  totalTokensBurned: bigint;
  totalTreasuryPaid: bigint;
  /** The TWAP can be read over the configured window right now. */
  oracleReady: boolean;
  /**
   * The pool has been asked to keep more than one observation.
   *
   * Priming and readiness are different things: priming only allocates the
   * buffer, which then fills as trades land in later blocks. Without this, a
   * primed-but-still-filling oracle is indistinguishable from an unprimed one
   * and the UI keeps asking to prime a pool that is already primed.
   */
  oraclePrimed: boolean;
}

export interface StakingVaultState extends VaultStateBase {
  template: 'staking';
  /** Seconds a stake is locked, counted from the staker's most recent deposit. */
  lockPeriod: number;
  totalStaked: bigint;
  totalWethDistributed: bigint;
  totalTokenDistributed: bigint;
}

export type VaultState = BuybackVaultState | StakingVaultState;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Address of the vault attached to `token`, or null when there is none.
 *
 * The launcher is the only authority on this, which is what lets the server
 * record a launch's vault without trusting whatever the client claimed.
 */
export async function resolveVaultAddress(
  client: PublicClient,
  token: Address,
): Promise<Address | null> {
  if (!isVaultLauncherDeployed()) return null;

  const vault = await client.readContract({
    address: vaultLauncherAddress(),
    abi: PONSVAULT_LAUNCHER_ABI,
    functionName: 'vaultOf',
    args: [token],
  });

  if (!vault || vault === ZERO_ADDRESS) return null;
  return vault;
}

/**
 * Which template a deployed vault is, read from the vault itself.
 *
 * Taken from the chain rather than from whatever the client submitted, so a
 * launch record cannot claim a template its vault does not implement.
 */
export async function resolveVaultTemplate(
  client: PublicClient,
  vault: Address,
): Promise<'buyback-burn' | 'staking'> {
  const template = await client
    .readContract({ address: vault, abi: PONS_VAULT_ABI, functionName: 'template' })
    // Vaults deployed before `template()` existed are all buyback-and-burn.
    .catch(() => 'buyback-burn');

  return template === 'staking' ? 'staking' : 'buyback-burn';
}

/**
 * Resolves the vault attached to `token`, or null when there is none.
 *
 * Returns null rather than throwing when no launcher is configured, so the
 * token page simply omits the panel on networks where vaults are not live.
 */
export async function fetchVaultState(
  client: PublicClient,
  token: Address,
): Promise<VaultState | null> {
  const vault = await resolveVaultAddress(client, token);
  if (!vault) return null;

  const template = await client
    .readContract({ address: vault, abi: PONS_VAULT_ABI, functionName: 'template' })
    .catch(() => 'buyback-burn');

  return template === 'staking'
    ? fetchStakingVaultState(client, vault)
    : fetchBuybackVaultState(client, vault);
}

async function fetchStakingVaultState(
  client: PublicClient,
  vault: Address,
): Promise<StakingVaultState> {
  const base = { address: vault, abi: PONS_STAKING_VAULT_ABI } as const;

  const [config, idle, canRunResult, totalStaked, totalWethDistributed, totalTokenDistributed, runCount, lastRunAt] =
    await Promise.all([
      client.readContract({ ...base, functionName: 'config' }),
      client.readContract({ ...base, functionName: 'unencumberedBalances' }),
      client.readContract({ ...base, functionName: 'canRun' }),
      client.readContract({ ...base, functionName: 'totalStaked' }),
      client.readContract({ ...base, functionName: 'totalWethDistributed' }),
      client.readContract({ ...base, functionName: 'totalTokenDistributed' }),
      client.readContract({ ...base, functionName: 'runCount' }),
      client.readContract({ ...base, functionName: 'lastRunAt' }),
    ]);

  return {
    template: 'staking',
    vault,
    lockPeriod: Number(config[0]),
    minHarvestWei: config[1],
    cooldown: Number(config[2]),
    pendingWeth: idle[0],
    pendingToken: idle[1],
    totalStaked,
    totalWethDistributed,
    totalTokenDistributed,
    runCount,
    lastRunAt,
    canRun: canRunResult[0],
    canRunReason: canRunResult[1],
  };
}

async function fetchBuybackVaultState(
  client: PublicClient,
  vault: Address,
): Promise<BuybackVaultState> {
  const base = { address: vault, abi: PONS_VAULT_ABI } as const;

  const [
    config,
    idle,
    canRunResult,
    totalWethHarvested,
    totalTokensBurned,
    totalTreasuryPaid,
    runCount,
    lastRunAt,
  ] = await Promise.all([
    client.readContract({ ...base, functionName: 'config' }),
    client.readContract({ ...base, functionName: 'idleBalances' }),
    client.readContract({ ...base, functionName: 'canRun' }),
    client.readContract({ ...base, functionName: 'totalWethHarvested' }),
    client.readContract({ ...base, functionName: 'totalTokensBurned' }),
    client.readContract({ ...base, functionName: 'totalTreasuryPaid' }),
    client.readContract({ ...base, functionName: 'runCount' }),
    client.readContract({ ...base, functionName: 'lastRunAt' }),
  ]);

  const twapWindow = Number(config[4]);

  // Both depend on values read above, so they cannot join the batch.
  const [oracleReady, pool] = await Promise.all([
    client.readContract({ ...base, functionName: 'isOracleReady', args: [config[4]] }),
    client.readContract({ ...base, functionName: 'pool' }),
  ]);

  let oraclePrimed = false;
  if (pool && pool !== ZERO_ADDRESS) {
    const slot0 = await client
      .readContract({ address: pool, abi: POOL_SLOT0_ABI, functionName: 'slot0' })
      .catch(() => null);
    // Cardinality 1 holds only the latest observation, so no window can be read.
    if (slot0) oraclePrimed = slot0[4] > 1;
  }

  return {
    template: 'buyback-burn',
    vault,
    burnBps: Number(config[0]),
    treasury: config[1],
    minHarvestWei: config[2],
    cooldown: Number(config[3]),
    twapWindow,
    maxTickDeviation: Number(config[5]),
    pendingWeth: idle[0],
    pendingToken: idle[1],
    totalWethHarvested,
    totalTokensBurned,
    totalTreasuryPaid,
    runCount,
    lastRunAt,
    canRun: canRunResult[0],
    canRunReason: canRunResult[1],
    oracleReady,
    oraclePrimed,
  };
}

/** Seconds remaining before the cooldown expires, or 0 when it already has. */
export function cooldownRemaining(state: VaultState, nowSeconds: number): number {
  if (state.lastRunAt === 0n) return 0;
  const readyAt = Number(state.lastRunAt) + state.cooldown;
  return Math.max(0, readyAt - nowSeconds);
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}
