import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseEther,
  parseEventLogs,
  stringToHex,
  type Hex,
  type TransactionReceipt,
} from 'viem';

import { findRwaAsset } from '@/lib/rwa/assets';

import { PONS_DEFAULT_CONFIG_ID, PONS_DEFAULT_DEX_ID } from './constants';
import { PONSVAULT_DEPLOYMENT } from './deployments';
import type { LaunchFormInput, PonsLaunchMetadata } from './types';

// This module is imported by ./launch, so it must not import from it. Values
// that would come from there (the CREATE2 salt) are passed in by the caller.

/* -------------------------------------------------------------------------- */
/* templates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `none` is no longer offered in the picker — every launch gets a vault — but the
 * id stays, because it still describes tokens that were launched without one and
 * is the fallback while no launcher is configured.
 */
export type VaultTemplateId = 'none' | 'buyback-burn' | 'staking' | 'lottery' | 'rwa';

export interface VaultTemplate {
  id: VaultTemplateId;
  name: string;
  tagline: string;
  status: 'available' | 'soon';
}

export const VAULT_TEMPLATES: VaultTemplate[] = [
  {
    id: 'buyback-burn',
    name: 'Buyback & Burn',
    tagline: 'Fees buy your token off the market and burn it.',
    status: 'available',
  },
  {
    id: 'staking',
    name: 'Staking',
    tagline: 'Fees are paid out to holders who stake, pro rata.',
    status: 'available',
  },
  {
    id: 'lottery',
    name: 'Lottery',
    tagline: 'Fees fund a prize pool paid to a holder each round.',
    status: 'soon',
  },
  {
    id: 'rwa',
    name: 'RWA Dividend',
    tagline: 'Fees buy a tokenized stock. Holders claim their share — no staking needed.',
    status: 'available',
  },
];

/* -------------------------------------------------------------------------- */
/* deployment                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Address of the deployed PonsVaultLauncher.
 *
 * The launcher must be the token's deployer for fees to be sweepable by anyone,
 * so attaching a vault is only possible through it. Re-exported from
 * {@link PONSVAULT_DEPLOYMENT} because most of the app wants only this one
 * address; while it is blank the UI offers vault templates as unavailable rather
 * than building a transaction that would revert.
 */
export const PONSVAULT_LAUNCHER = PONSVAULT_DEPLOYMENT.launcher.trim();

export function isVaultLauncherDeployed(): boolean {
  return isAddress(PONSVAULT_LAUNCHER, { strict: false });
}

export function vaultLauncherAddress(): `0x${string}` {
  if (!isVaultLauncherDeployed()) {
    throw new Error('PonsVault launcher address is not configured for this network.');
  }
  return getAddress(PONSVAULT_LAUNCHER) as `0x${string}`;
}

/* -------------------------------------------------------------------------- */
/* defaults                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Starting values for the Buyback & Burn config.
 *
 * `minHarvestEth` matches the keeper's own `KEEPER_MIN_WETH` floor on purpose.
 * Both floors apply and the higher one decides, so defaulting below the keeper's
 * would show creators a threshold that does not actually pace their vault.
 */
export const BUYBACK_BURN_DEFAULTS = {
  burnPercent: '80',
  minHarvestEth: '0.025',
} as const;

/**
 * Starting values for the Staking config.
 *
 * No lock by default: an unlocked stake is the easiest thing for a holder to
 * trust, and a creator who wants one has to opt in deliberately, since it
 * cannot be lifted afterwards.
 */
export const STAKING_DEFAULTS = {
  lockDays: '0',
  minHarvestEth: '0.025',
} as const;

/** Longest lock the contract will accept, mirroring its MAX_LOCK_PERIOD. */
export const STAKING_MAX_LOCK_DAYS = 365;

/**
 * Starting values for the RWA Dividend config.
 *
 * No default asset. The choice is permanent and the three that are offered
 * differ in ways a creator should look at rather than inherit, so the form
 * makes them pick.
 */
export const RWA_DEFAULTS = {
  asset: '',
  minHarvestEth: '0.025',
} as const;

/* -------------------------------------------------------------------------- */
/* abi                                                                        */
/* -------------------------------------------------------------------------- */

const TOKEN_METADATA_COMPONENTS = [
  { name: 'name', type: 'string' },
  { name: 'symbol', type: 'string' },
  { name: 'logo', type: 'string' },
  { name: 'description', type: 'string' },
  {
    name: 'socials',
    type: 'tuple',
    components: [
      { name: 'twitter', type: 'string' },
      { name: 'telegram', type: 'string' },
      { name: 'discord', type: 'string' },
      { name: 'website', type: 'string' },
      { name: 'farcaster', type: 'string' },
    ],
  },
  { name: 'feeWallet', type: 'address' },
] as const;

const VAULT_CONFIG_COMPONENTS = [
  { name: 'burnBps', type: 'uint16' },
  { name: 'treasury', type: 'address' },
  { name: 'minHarvestWei', type: 'uint256' },
] as const;

const STAKING_CONFIG_COMPONENTS = [
  { name: 'lockPeriod', type: 'uint32' },
  { name: 'minHarvestWei', type: 'uint256' },
] as const;

const RWA_CONFIG_COMPONENTS = [
  { name: 'rwaAsset', type: 'address' },
  { name: 'rwaPoolFee', type: 'uint24' },
  { name: 'minHarvestWei', type: 'uint256' },
] as const;

/**
 * One launch entry point for every template, present and future.
 *
 * The config is `bytes` and the template is an id rather than a function name,
 * so adding a template is a registry transaction on the deployed launcher
 * rather than a new launcher address. Nothing in this file needs to change to
 * launch a template that did not exist when it was written — only the encoder
 * for that template's own parameters.
 */
export const PONSVAULT_LAUNCHER_ABI = [
  {
    type: 'function',
    name: 'launchWithVault',
    stateMutability: 'payable',
    inputs: [
      { name: 'metadata', type: 'tuple', components: TOKEN_METADATA_COMPONENTS },
      { name: 'launchConfigId', type: 'uint256' },
      { name: 'dexId', type: 'uint256' },
      { name: 'salt', type: 'bytes32' },
      { name: 'templateId', type: 'bytes32' },
      { name: 'vaultConfig', type: 'bytes' },
    ],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'vault', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'vaultOf',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'templateOf',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'creatorOf',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'event',
    name: 'Launched',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'templateId', type: 'bytes32', indexed: false },
    ],
  },
] as const;

/**
 * On-chain id for a template, as right-padded ASCII.
 *
 * Matches the contracts' `bytes32("buyback-burn")` literals and each factory's
 * `template()` string, so the same name identifies a template in the URL, the
 * database, the explorer, and the registry.
 */
export function vaultTemplateId(template: Exclude<VaultTemplateId, 'none'>): Hex {
  return stringToHex(template, { size: 32 });
}

/* -------------------------------------------------------------------------- */
/* config                                                                     */
/* -------------------------------------------------------------------------- */

export interface VaultConfigArgs {
  burnBps: number;
  treasury: `0x${string}`;
  minHarvestWei: bigint;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function buildVaultConfig(input: LaunchFormInput): VaultConfigArgs {
  const burnBps = Math.round(Number(input.vaultBurnPercent) * 100);
  const fullBurn = burnBps === 10_000;

  return {
    burnBps,
    // The contract only requires a treasury when something is left over.
    treasury: fullBurn ? ZERO_ADDRESS : (getAddress(input.vaultTreasury.trim()) as `0x${string}`),
    minHarvestWei: parseEther(input.vaultMinHarvestEth.trim() || '0'),
  };
}

export interface StakingConfigArgs {
  lockPeriod: number;
  minHarvestWei: bigint;
}

export function buildStakingConfig(input: LaunchFormInput): StakingConfigArgs {
  return {
    lockPeriod: Math.round(Number(input.vaultStakingLockDays || '0') * 86_400),
    minHarvestWei: parseEther(input.vaultMinHarvestEth.trim() || '0'),
  };
}

export interface RwaConfigArgs {
  rwaAsset: `0x${string}`;
  rwaPoolFee: number;
  minHarvestWei: bigint;
}

/**
 * The fee tier is not the creator's to choose: it comes from the curated entry
 * for the asset they picked, because it records the pool that was measured as
 * deep enough. A creator who typed a tier could name one that exists but holds
 * nothing, and the asset is fixed forever once the vault is built.
 */
export function buildRwaConfig(input: LaunchFormInput): RwaConfigArgs {
  const asset = findRwaAsset(input.vaultRwaAsset.trim());
  if (!asset) {
    throw new Error('Choose one of the supported stocks for this vault.');
  }

  return {
    rwaAsset: asset.address,
    rwaPoolFee: asset.poolFee,
    minHarvestWei: parseEther(input.vaultMinHarvestEth.trim() || '0'),
  };
}

/**
 * Harvest pacing, which every template configures the same way.
 *
 * The harvest floor is the whole of it. A run spends everything the vault
 * holds, so it cannot repeat until trading refills it past this — which paces
 * the vault by volume rather than by a clock, and is why there is no cooldown
 * to validate here.
 */
function validateSharedVaultInput(input: LaunchFormInput): string | null {
  const minHarvest = input.vaultMinHarvestEth.trim();
  if (minHarvest) {
    try {
      if (parseEther(minHarvest) < 0n) throw new Error('negative');
    } catch {
      return 'Minimum harvest must be a valid ETH amount.';
    }
  }

  return null;
}

/**
 * Mirrors the vaults' own validation so a bad config is rejected in the form
 * rather than as an opaque revert after the user has paid gas.
 */
export function validateVaultInput(input: LaunchFormInput): string | null {
  if (input.vaultTemplate === 'none') return null;

  const template = VAULT_TEMPLATES.find((entry) => entry.id === input.vaultTemplate);
  if (!template || template.status !== 'available') {
    return 'That vault template is not available yet.';
  }
  if (!isVaultLauncherDeployed()) {
    return 'Vaults are not available on this network yet.';
  }

  const sharedError = validateSharedVaultInput(input);
  if (sharedError) return sharedError;

  if (input.vaultTemplate === 'staking') {
    const lockDays = Number(input.vaultStakingLockDays || '0');
    if (!Number.isFinite(lockDays) || lockDays < 0) {
      return 'Lock period must be zero or positive.';
    }
    if (lockDays > STAKING_MAX_LOCK_DAYS) {
      return `Lock period cannot exceed ${STAKING_MAX_LOCK_DAYS} days.`;
    }
    return null;
  }

  if (input.vaultTemplate === 'rwa') {
    // Restricted to the curated list rather than any address with a pool. The
    // vault only refuses a pool that is completely empty, and most tokenized
    // stocks on this chain sit just above that: their pools exist but hold
    // almost nothing, so every round would be lost to price impact. The asset
    // cannot be changed afterwards, so this is the only chance to catch it.
    if (!findRwaAsset(input.vaultRwaAsset.trim())) {
      return 'Choose one of the supported stocks for this vault.';
    }
    return null;
  }

  const burnPercent = Number(input.vaultBurnPercent);
  if (!Number.isFinite(burnPercent) || burnPercent <= 0 || burnPercent > 100) {
    return 'Burn share must be between 0 and 100 percent.';
  }
  const burnBps = Math.round(burnPercent * 100);
  if (burnBps !== 10_000 && !isAddress(input.vaultTreasury.trim(), { strict: false })) {
    return 'Enter a treasury address, or set the burn share to 100%.';
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* transaction                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Packs a template's parameters into the opaque `bytes` the launcher forwards
 * to that template's factory, which decodes them back into its own struct.
 *
 * A new template adds a branch here and nothing else on the launch path.
 */
function encodeVaultConfig(input: LaunchFormInput): Hex {
  if (input.vaultTemplate === 'staking') {
    return encodeAbiParameters(
      [{ type: 'tuple', components: STAKING_CONFIG_COMPONENTS }],
      [buildStakingConfig(input)],
    );
  }

  if (input.vaultTemplate === 'rwa') {
    return encodeAbiParameters(
      [{ type: 'tuple', components: RWA_CONFIG_COMPONENTS }],
      [buildRwaConfig(input)],
    );
  }

  return encodeAbiParameters(
    [{ type: 'tuple', components: VAULT_CONFIG_COMPONENTS }],
    [buildVaultConfig(input)],
  );
}

export function encodeLaunchWithVaultTransaction(
  metadata: PonsLaunchMetadata,
  input: LaunchFormInput,
  salt: Hex,
) {
  if (input.vaultTemplate === 'none') {
    throw new Error('Cannot encode a vault launch without a template.');
  }

  return encodeFunctionData({
    abi: PONSVAULT_LAUNCHER_ABI,
    functionName: 'launchWithVault',
    args: [
      {
        name: metadata.name,
        symbol: metadata.symbol,
        logo: metadata.logo,
        description: metadata.description,
        socials: metadata.socials,
        // Overwritten by the launcher, which must be the fee wallet during the
        // launch so it can re-point the redirect at the vault afterwards.
        feeWallet: metadata.feeWallet,
      },
      PONS_DEFAULT_CONFIG_ID,
      PONS_DEFAULT_DEX_ID,
      salt,
      vaultTemplateId(input.vaultTemplate),
      encodeVaultConfig(input),
    ],
  });
}

/** Reads the token and vault addresses out of the launcher's Launched event. */
export function extractVaultLaunch(
  receipt: TransactionReceipt,
): { token: `0x${string}`; vault: `0x${string}` } | null {
  const logs = parseEventLogs({
    abi: PONSVAULT_LAUNCHER_ABI,
    eventName: 'Launched',
    logs: receipt.logs,
  });

  const event = logs[0];
  if (!event) return null;
  return { token: event.args.token, vault: event.args.vault };
}
