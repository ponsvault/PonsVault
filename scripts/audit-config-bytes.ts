/**
 * Prints the exact vault-config bytes the launch form would send.
 *
 * Goes through `encodeLaunchWithVaultTransaction` and decodes the result, so
 * this is the real calldata a wallet would sign rather than a reconstruction.
 * Feeds `contracts/test/VaultConfigDecoding.t.sol`, which decodes these same
 * literals with the factories' own `abi.decode`. Between them they cover the one
 * seam nothing else touches: the browser encodes this blob and the contract
 * decodes it, and neither language alone can catch a mismatch.
 */
import { decodeFunctionData, hexToString, trim } from 'viem';

import { PONSVAULT_LAUNCHER_ABI, encodeLaunchWithVaultTransaction } from '../src/lib/pons/vault';
import type { LaunchFormInput, PonsLaunchMetadata } from '../src/lib/pons/types';

const metadata: PonsLaunchMetadata = {
  name: 'Audit',
  symbol: 'AUD',
  logo: '',
  description: '',
  socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
  feeWallet: '0x0000000000000000000000000000000000000000',
};

const base = {
  name: 'Audit',
  symbol: 'AUD',
  description: '',
  logoUrl: '',
  twitter: '',
  telegram: '',
  discord: '',
  website: '',
  farcaster: '',
  devBuyEth: '',
  vaultTemplate: 'buyback-burn',
  vaultBurnPercent: '80',
  vaultTreasury: '0x1111111111111111111111111111111111111111',
  vaultMinHarvestEth: '0.025',
  vaultStakingLockDays: '0',
} as unknown as LaunchFormInput;

const cases: Array<[string, LaunchFormInput]> = [
  ['buyback_partialBurn', base],
  ['buyback_fullBurn', { ...base, vaultBurnPercent: '100', vaultTreasury: '' }],
  ['staking_noLock', { ...base, vaultTemplate: 'staking' } as LaunchFormInput],
  [
    'staking_thirtyDayLock',
    { ...base, vaultTemplate: 'staking', vaultStakingLockDays: '30' } as LaunchFormInput,
  ],
];

const salt = `0x${'11'.repeat(32)}` as const;

for (const [label, input] of cases) {
  const calldata = encodeLaunchWithVaultTransaction(metadata, input, salt);
  const { args } = decodeFunctionData({ abi: PONSVAULT_LAUNCHER_ABI, data: calldata });
  const [, , , , templateId, vaultConfig] = args as readonly [
    unknown,
    unknown,
    unknown,
    unknown,
    `0x${string}`,
    `0x${string}`,
  ];

  console.log(`${label}`);
  console.log(`  templateId ${templateId}  (${hexToString(trim(templateId, { dir: 'right' }))})`);
  console.log(`  config     ${vaultConfig}`);
}
