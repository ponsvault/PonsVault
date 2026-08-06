import type { Address, PublicClient } from 'viem';

import { PONS_LOTTERY_VAULT_ABI } from '@/lib/lottery/abi';
import { PONS_RWA_VAULT_ABI } from '@/lib/rwa/abi';

import { PONS_WETH } from './contracts';
import { isV2VaultLauncherDeployed } from './v2-deployments';
import { PONSVAULT_V2_LAUNCHER_ABI, v2VaultLauncherAddress } from './v2-vault';
import { PONSVAULT_LAUNCHER_ABI, isVaultLauncherDeployed, vaultLauncherAddress } from './vault';

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

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
  { type: 'function', name: 'pool', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'template', stateMutability: 'pure', inputs: [], outputs: [{ type: 'string' }] },
  // Listed so a revert decodes to its name rather than a bare four-byte
  // signature. Without these viem can only report the selector, which turns
  // every distinct failure into the same unreadable line in the keeper log.
  { type: 'error', name: 'NothingToHarvest', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'InvalidBurnBps', inputs: [{ name: 'burnBps', type: 'uint16' }] },
  { type: 'error', name: 'TreasuryRequired', inputs: [] },
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
  // See the note on the buyback ABI: these exist so a revert reads as a name.
  { type: 'error', name: 'NothingToHarvest', inputs: [] },
  { type: 'error', name: 'NoStakers', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'InvalidLockPeriod', inputs: [] },
  {
    type: 'error',
    name: 'StakeTooSmall',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'minimum', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientStake',
    inputs: [
      { name: 'staked', type: 'uint256' },
      { name: 'requested', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'StakeLocked', inputs: [{ name: 'unlockAt', type: 'uint256' }] },
] as const;

/** Everything every template has, whatever it does with the fees. */
interface VaultStateBase {
  vault: Address;
  minHarvestWei: bigint;
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
  totalWethHarvested: bigint;
  totalTokensBurned: bigint;
  totalTreasuryPaid: bigint;
}

export interface StakingVaultState extends VaultStateBase {
  template: 'staking';
  /** Seconds a stake is locked, counted from the staker's most recent deposit. */
  lockPeriod: number;
  totalStaked: bigint;
  totalWethDistributed: bigint;
  totalTokenDistributed: bigint;
}

export interface RwaVaultState extends VaultStateBase {
  template: 'rwa';
  /** The stock this vault buys. Fixed at launch. */
  rwaAsset: Address;
  rwaPoolFee: number;
  /** Rounds opened so far, each one a claimable distribution. */
  roundCount: number;
  /** Bought and allocated, but not yet collected by holders. */
  undistributedRwa: bigint;
}

export interface LotteryVaultState extends VaultStateBase {
  template: 'lottery';
  entryPeriod: number;
  revealDelay: number;
  roundCount: number;
  /** Phase of the latest round, or None when none have opened. */
  phase: number;
  prizeWeth: bigint;
  entryEndsAt: number;
  revealAfter: number;
  entrantCount: number;
  winner: Address;
  totalPrizePaid: bigint;
}

export type VaultState = BuybackVaultState | StakingVaultState | RwaVaultState | LotteryVaultState;

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
  // Prefer the v2 launcher — current launches attach vaults there.
  if (isV2VaultLauncherDeployed()) {
    try {
      const vault = await client.readContract({
        address: v2VaultLauncherAddress(),
        abi: PONSVAULT_V2_LAUNCHER_ABI,
        functionName: 'vaultOf',
        args: [token],
      });
      if (vault && vault !== ZERO_ADDRESS) return vault;
    } catch {
      // Fall through to v1.
    }
  }

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

  if (template === 'staking') return fetchStakingVaultState(client, vault);
  if (template === 'rwa') return fetchRwaVaultState(client, vault);
  if (template === 'lottery') return fetchLotteryVaultState(client, vault);
  return fetchBuybackVaultState(client, vault);
}

async function fetchLotteryVaultState(
  client: PublicClient,
  vault: Address,
): Promise<LotteryVaultState> {
  const base = { address: vault, abi: PONS_LOTTERY_VAULT_ABI } as const;

  const [config, canRunResult, roundCount, totalPrizePaid, runCount, lastRunAt, idle] =
    await Promise.all([
      client.readContract({ ...base, functionName: 'config' }),
      client.readContract({ ...base, functionName: 'canRun' }),
      client.readContract({ ...base, functionName: 'roundCount' }),
      client.readContract({ ...base, functionName: 'totalPrizePaid' }),
      client.readContract({ ...base, functionName: 'runCount' }),
      client.readContract({ ...base, functionName: 'lastRunAt' }),
      client.readContract({ ...base, functionName: 'idleBalances' }),
    ]);

  const count = Number(roundCount);
  let phase = 0;
  let prizeWeth = 0n;
  let entryEndsAt = 0;
  let revealAfter = 0;
  let entrantCount = 0;
  let winner = ZERO_ADDRESS as Address;

  if (count > 0) {
    const [round, entrants] = await Promise.all([
      client.readContract({ ...base, functionName: 'rounds', args: [BigInt(count - 1)] }),
      client.readContract({ ...base, functionName: 'entrantCount', args: [BigInt(count - 1)] }),
    ]);
    prizeWeth = BigInt(round.prizeWeth);
    entryEndsAt = Number(round.entryEndsAt);
    revealAfter = Number(round.revealAfter);
    winner = round.winner;
    phase = Number(round.phase);
    entrantCount = Number(entrants);
  }

  return {
    template: 'lottery',
    vault,
    minHarvestWei: config[0],
    entryPeriod: Number(config[1]),
    revealDelay: Number(config[2]),
    pendingWeth: idle[0],
    pendingToken: idle[1],
    roundCount: count,
    phase,
    prizeWeth,
    entryEndsAt,
    revealAfter,
    entrantCount,
    winner,
    totalPrizePaid,
    runCount,
    lastRunAt,
    canRun: canRunResult[0],
    canRunReason: canRunResult[1],
  };
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

async function fetchRwaVaultState(client: PublicClient, vault: Address): Promise<RwaVaultState> {
  const base = { address: vault, abi: PONS_RWA_VAULT_ABI } as const;

  const [config, canRunResult, roundCount, undistributedRwa, runCount, lastRunAt, token] =
    await Promise.all([
      client.readContract({ ...base, functionName: 'config' }),
      client.readContract({ ...base, functionName: 'canRun' }),
      client.readContract({ ...base, functionName: 'roundCount' }),
      client.readContract({ ...base, functionName: 'undistributedRwa' }),
      client.readContract({ ...base, functionName: 'runCount' }),
      client.readContract({ ...base, functionName: 'lastRunAt' }),
      client.readContract({ ...base, functionName: 'token' }),
    ]);

  // Read as plain balances rather than through a vault getter: this template
  // spends its whole WETH balance on every run and burns the token side, so
  // there is no encumbered portion to subtract.
  const [pendingWeth, pendingToken] = await Promise.all([
    client.readContract({
      address: PONS_WETH,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [vault],
    }),
    client.readContract({
      address: token,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [vault],
    }),
  ]);

  return {
    template: 'rwa',
    vault,
    rwaAsset: config[0],
    rwaPoolFee: Number(config[1]),
    minHarvestWei: config[2],
    pendingWeth,
    pendingToken,
    roundCount: Number(roundCount),
    undistributedRwa,
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

  return {
    template: 'buyback-burn',
    vault,
    burnBps: Number(config[0]),
    treasury: config[1],
    minHarvestWei: config[2],
    pendingWeth: idle[0],
    pendingToken: idle[1],
    totalWethHarvested,
    totalTokensBurned,
    totalTreasuryPaid,
    runCount,
    lastRunAt,
    canRun: canRunResult[0],
    canRunReason: canRunResult[1],
  };
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}
