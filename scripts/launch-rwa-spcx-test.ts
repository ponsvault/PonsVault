/**
 * Broadcast a same-asset RWA Dividend launch: pair SPCX + dividend SPCX.
 *
 *   npx tsx --conditions=react-server scripts/launch-rwa-spcx-test.ts
 *
 * Uses KEEPER_PRIVATE_KEY from .env.local (same key the keeper already holds).
 */
import { readFileSync } from 'fs';
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseUnits,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '../src/lib/pons/chain';
import { ROBINHOOD_RPC_URL } from '../src/lib/pons/constants';
import { fetchPonsV2Status } from '../src/lib/pons/v2-status';
import {
  encodeLaunchWithV2VaultTransaction,
  extractV2VaultLaunch,
  v2VaultLauncherAddress,
} from '../src/lib/pons/v2-vault';
import type { LaunchFormInput } from '../src/lib/pons/types';
import { findRwaAsset } from '../src/lib/rwa/assets';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq);
  let value = trimmed.slice(eq + 1);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!(key in process.env)) process.env[key] = value;
}

const SPCX = '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa' as const;

async function main() {
  const pk = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!pk) throw new Error('KEEPER_PRIVATE_KEY missing from .env.local');

  const account = privateKeyToAccount(
    (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex,
  );
  const publicClient = createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC_URL),
  });

  const status = await fetchPonsV2Status();
  if (!status.vaultCanLaunch) {
    throw new Error(`Launcher not ready: ${status.vaultCanLaunchReason}`);
  }

  const spcx = findRwaAsset(SPCX);
  if (!spcx) throw new Error('SPCX missing from curated RWA assets');

  const form: LaunchFormInput = {
    name: 'SpaceX dividend reward on pons',
    symbol: 'SPCX',
    description: 'PonsVault RWA Dividend test — same-asset SPCX payout.',
    imageUri: 'ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    twitter: 'ponsvault',
    telegram: '',
    website: 'https://ponsvault.com/explore',
    devBuyEth: '',
    pairToken: SPCX,
    creatorTaxBps: '0',
    vaultTemplate: 'rwa',
    vaultBurnPercent: '80',
    vaultTreasury: '',
    vaultMinHarvestEth: '0.01',
    vaultStakingLockDays: '0',
    vaultRwaAsset: SPCX,
    vaultLotteryEntryHours: '6',
    vaultLotteryRevealMinutes: '30',
  };

  const data = encodeLaunchWithV2VaultTransaction(
    form,
    {
      twitter: 'ponsvault',
      telegram: '',
      discord: '',
      website: 'https://ponsvault.com/explore',
      farcaster: '',
    },
    {
      name: form.name,
      symbol: form.symbol,
      creatorTaxBps: 0,
      salt: `0x${Buffer.from(`spcx-rwa-${Date.now()}`).toString('hex').padEnd(64, '0').slice(0, 64)}` as Hex,
    },
  );

  const value = BigInt(status.launchFeeWei);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('launcher', v2VaultLauncherAddress());
  console.log('from', account.address);
  console.log('fee', formatEther(value), 'ETH');
  console.log('balance', formatEther(balance), 'ETH');
  console.log('minHarvest', form.vaultMinHarvestEth, 'SPCX =', parseUnits('0.01', 18).toString());
  console.log('pair + dividend', SPCX);

  if (balance < value) throw new Error('Insufficient ETH for launch fee');

  const hash = await walletClient.sendTransaction({
    to: v2VaultLauncherAddress(),
    value,
    data,
  });
  console.log('tx', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('status', receipt.status);

  if (receipt.status !== 'success') {
    throw new Error(`Launch reverted: ${hash}`);
  }

  const launched = extractV2VaultLaunch(receipt);
  if (!launched) throw new Error('Launched event missing from receipt');

  console.log('token', launched.token);
  console.log('vault', launched.vault);
  console.log('curve', launched.curve);
  console.log('pair', launched.pairToken);
  console.log('page', `https://ponsvault.com/launchpad/${launched.token}`);
  console.log('explore', 'https://ponsvault.com/explore');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
