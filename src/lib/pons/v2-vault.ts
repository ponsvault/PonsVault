import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Hex,
  type TransactionReceipt,
} from 'viem';

import { findRwaAsset } from '@/lib/rwa/assets';

import { PONS_DEFAULT_CONFIG_ID } from './constants';
import type { LaunchFormInput } from './types';
import {
  findV2PairToken,
  isV2VaultLauncherDeployed,
  PONSVAULT_V2_DEPLOYMENT,
} from './v2-deployments';
import { vaultTemplateId, type VaultTemplateId } from './vault';

/* -------------------------------------------------------------------------- */
/* deployment                                                                 */
/* -------------------------------------------------------------------------- */

export const PONSVAULT_V2_LAUNCHER = PONSVAULT_V2_DEPLOYMENT.launcher.trim();

export function v2VaultLauncherAddress(): `0x${string}` {
  if (!isV2VaultLauncherDeployed()) {
    throw new Error('PonsVault v2 launcher address is not configured.');
  }
  return getAddress(PONSVAULT_V2_LAUNCHER) as `0x${string}`;
}

/** Templates registered on the deployed v2 registry. */
export const V2_VAULT_TEMPLATES: Exclude<VaultTemplateId, 'none'>[] = [
  'buyback-burn',
  'staking',
  'rwa',
];

export function isV2VaultTemplate(
  id: VaultTemplateId,
): id is 'buyback-burn' | 'staking' | 'rwa' {
  return id === 'buyback-burn' || id === 'staking' || id === 'rwa';
}

/* -------------------------------------------------------------------------- */
/* abi                                                                        */
/* -------------------------------------------------------------------------- */

const SOCIALS_COMPONENTS = [
  { name: 'twitter', type: 'string' },
  { name: 'telegram', type: 'string' },
  { name: 'discord', type: 'string' },
  { name: 'website', type: 'string' },
  { name: 'farcaster', type: 'string' },
] as const;

const TOKEN_PARAMS_COMPONENTS = [
  { name: 'name', type: 'string' },
  { name: 'symbol', type: 'string' },
  { name: 'logo', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'socials', type: 'tuple', components: SOCIALS_COMPONENTS },
  { name: 'creatorFeeRecipient', type: 'address' },
  { name: 'creatorTaxBps', type: 'uint16' },
  { name: 'buybackEnabled', type: 'bool' },
  { name: 'expectedEconomics', type: 'bytes32' },
  { name: 'salt', type: 'bytes32' },
] as const;

const BUYBACK_CONFIG_COMPONENTS = [
  { name: 'burnBps', type: 'uint16' },
  { name: 'treasury', type: 'address' },
  { name: 'minHarvest', type: 'uint256' },
] as const;

const STAKING_CONFIG_COMPONENTS = [{ name: 'minHarvest', type: 'uint256' }] as const;

const RWA_CONFIG_COMPONENTS = [
  { name: 'rwaAsset', type: 'address' },
  { name: 'rwaPoolFee', type: 'uint24' },
  { name: 'minHarvestWei', type: 'uint256' },
] as const;

export const PONSVAULT_V2_LAUNCHER_ABI = [
  {
    type: 'function',
    name: 'launchWithVault',
    stateMutability: 'payable',
    inputs: [
      { name: 'params', type: 'tuple', components: TOKEN_PARAMS_COMPONENTS },
      { name: 'launchConfigId', type: 'uint256' },
      { name: 'pairToken', type: 'address' },
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
    type: 'function',
    name: 'canLaunch',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'ready', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'Launched',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'vault', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'curve', type: 'address', indexed: false },
      { name: 'pairToken', type: 'address', indexed: false },
      { name: 'templateId', type: 'bytes32', indexed: false },
    ],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

/* -------------------------------------------------------------------------- */
/* config                                                                     */
/* -------------------------------------------------------------------------- */

function parseMinHarvest(input: LaunchFormInput): bigint {
  const pair = findV2PairToken(input.pairToken);
  const decimals = pair?.decimals ?? 18;
  const raw = input.vaultMinHarvestEth.trim() || '0';
  return parseUnits(raw, decimals);
}

export function buildV2BuybackConfig(input: LaunchFormInput) {
  const burnBps = Math.round(Number(input.vaultBurnPercent) * 100);
  const treasury =
    burnBps >= 10_000
      ? ('0x0000000000000000000000000000000000000000' as const)
      : (getAddress(input.vaultTreasury.trim()) as `0x${string}`);
  return {
    burnBps,
    treasury,
    minHarvest: parseMinHarvest(input),
  };
}

export function buildV2StakingConfig(input: LaunchFormInput) {
  return { minHarvest: parseMinHarvest(input) };
}

export function buildV2RwaConfig(input: LaunchFormInput) {
  const asset = findRwaAsset(input.vaultRwaAsset.trim());
  if (!asset) {
    throw new Error('Choose one of the supported stocks for this vault.');
  }
  return {
    rwaAsset: asset.address,
    rwaPoolFee: asset.poolFee,
    minHarvestWei: parseMinHarvest(input),
  };
}

function encodeV2VaultConfig(input: LaunchFormInput): Hex {
  if (input.vaultTemplate === 'staking') {
    return encodeAbiParameters(
      [{ type: 'tuple', components: STAKING_CONFIG_COMPONENTS }],
      [buildV2StakingConfig(input)],
    );
  }

  if (input.vaultTemplate === 'rwa') {
    return encodeAbiParameters(
      [{ type: 'tuple', components: RWA_CONFIG_COMPONENTS }],
      [buildV2RwaConfig(input)],
    );
  }

  return encodeAbiParameters(
    [{ type: 'tuple', components: BUYBACK_CONFIG_COMPONENTS }],
    [buildV2BuybackConfig(input)],
  );
}

/**
 * Mirrors on-chain vault validation so a bad config fails in the form.
 *
 * 100% burn requires a live `defaultBuyback` on the buyback factory (curve helper).
 */
export function validateV2VaultInput(
  input: LaunchFormInput,
  options?: { buybackHelperReady?: boolean },
): string | null {
  if (!isV2VaultLauncherDeployed()) {
    return 'Vaults are not available on this network yet.';
  }
  if (!isV2VaultTemplate(input.vaultTemplate)) {
    return 'That vault template is not available on pons v2 yet.';
  }

  const pair = findV2PairToken(input.pairToken);
  if (!pair) {
    return 'Choose an approved pairing asset.';
  }

  const minHarvest = input.vaultMinHarvestEth.trim();
  if (minHarvest) {
    try {
      if (parseUnits(minHarvest, pair.decimals) < 0n) throw new Error('negative');
    } catch {
      return `Minimum harvest must be a valid ${pair.symbol} amount.`;
    }
  }

  if (input.vaultTemplate === 'staking') return null;

  if (input.vaultTemplate === 'rwa') {
    // Same-asset (pair SPCX + dividend SPCX) needs no WETH pool — the vault
    // allocates quote directly. Cross-asset picks are gated in the form by live
    // depth; the contract still requires a pool when a swap is needed.
    if (!findRwaAsset(input.vaultRwaAsset.trim())) {
      return 'Choose one of the supported stocks for this vault.';
    }
    return null;
  }

  const burnPercent = Number(input.vaultBurnPercent);
  const helperReady = options?.buybackHelperReady === true;

  if (!Number.isFinite(burnPercent) || burnPercent <= 0 || burnPercent > 100) {
    return 'Burn share must be between 0 and 100%.';
  }
  if (burnPercent === 100 && !helperReady) {
    return '100% burn needs the buyback helper wired on-chain — leave a treasury share for now.';
  }
  if (burnPercent < 100 && !isAddress(input.vaultTreasury.trim(), { strict: false })) {
    return 'Enter a treasury address for the unburned share.';
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* transaction                                                               */
/* -------------------------------------------------------------------------- */

export function encodeLaunchWithV2VaultTransaction(
  input: LaunchFormInput,
  socials: {
    twitter: string;
    telegram: string;
    discord: string;
    website: string;
    farcaster: string;
  },
  opts?: {
    name?: string;
    symbol?: string;
    creatorTaxBps?: number;
    salt?: Hex;
    launchConfigId?: bigint;
  },
) {
  if (!isV2VaultTemplate(input.vaultTemplate)) {
    throw new Error('Cannot encode a v2 vault launch without a v2 template.');
  }

  const pair = findV2PairToken(input.pairToken);
  if (!pair) throw new Error('Unknown pairing asset.');

  const name = opts?.name ?? input.name.trim();
  const symbol = opts?.symbol ?? input.symbol.trim().toUpperCase();
  const creatorTaxBps = opts?.creatorTaxBps ?? 0;
  const salt = opts?.salt ?? ZERO_BYTES32;

  return encodeFunctionData({
    abi: PONSVAULT_V2_LAUNCHER_ABI,
    functionName: 'launchWithVault',
    args: [
      {
        name,
        symbol,
        logo: input.imageUri.trim(),
        description: input.description.trim(),
        socials,
        // Overwritten by the launcher to itself, then re-pointed at the vault.
        creatorFeeRecipient: ZERO_ADDRESS,
        creatorTaxBps,
        buybackEnabled: false,
        expectedEconomics: ZERO_BYTES32,
        salt,
      },
      opts?.launchConfigId ?? PONS_DEFAULT_CONFIG_ID,
      getAddress(pair.address) as `0x${string}`,
      vaultTemplateId(input.vaultTemplate),
      encodeV2VaultConfig(input),
    ],
  });
}

export function extractV2VaultLaunch(receipt: TransactionReceipt): {
  token: `0x${string}`;
  vault: `0x${string}`;
  pairToken: `0x${string}`;
  curve: `0x${string}`;
} | null {
  const logs = parseEventLogs({
    abi: PONSVAULT_V2_LAUNCHER_ABI,
    eventName: 'Launched',
    logs: receipt.logs,
  });

  const event = logs[0];
  if (!event) return null;
  return {
    token: event.args.token,
    vault: event.args.vault,
    pairToken: event.args.pairToken,
    curve: event.args.curve,
  };
}
