/**
 * Broadcast a same-asset RWA Dividend launch: pair SPCX + dividend SPCX.
 *
 * Uses the user-as-deployer path (factory → createVault → fee redirect) so
 * GMGN / explorers attribute DEV to the signing wallet.
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
import { PONS_DEFAULT_CONFIG_ID, ROBINHOOD_RPC_URL } from '../src/lib/pons/constants';
import { fetchPonsV2Status } from '../src/lib/pons/v2-status';
import {
  buildV2UserVaultLaunchPlan,
  extractV2FactoryLaunch,
  extractV2VaultCreated,
  PONS_V2_FACTORY_LAUNCH_ABI,
  randomLaunchSalt,
} from '../src/lib/pons/v2-vault';
import { PONS_V2 } from '../src/lib/pons/v2-deployments';
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
  if (!status.publicReady && !status.vaultCanLaunch) {
    throw new Error('Factory cannot launch right now');
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

  const socials = {
    twitter: 'ponsvault',
    telegram: '',
    discord: '',
    website: 'https://ponsvault.com/explore',
    farcaster: '',
  };

  const expectedEconomics = await publicClient.readContract({
    address: PONS_V2.factory as `0x${string}`,
    abi: PONS_V2_FACTORY_LAUNCH_ABI,
    functionName: 'previewLaunchEconomics',
    args: [PONS_DEFAULT_CONFIG_ID, SPCX],
  });

  const plan = buildV2UserVaultLaunchPlan(form, socials, {
    name: form.name,
    symbol: form.symbol,
    creatorTaxBps: 0,
    salt: randomLaunchSalt(),
    expectedEconomics,
    creator: account.address,
  });

  const value = BigInt(status.launchFeeWei);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('factory', plan.factory);
  console.log('vaultFactory', plan.vaultFactory);
  console.log('from / deployer', account.address);
  console.log('fee', formatEther(value), 'ETH');
  console.log('balance', formatEther(balance), 'ETH');
  console.log('minHarvest', form.vaultMinHarvestEth, 'SPCX =', parseUnits('0.01', 18).toString());
  console.log('pair + dividend', SPCX);

  if (balance < value) throw new Error('Insufficient ETH for launch fee');

  console.log('1/3 launchToken…');
  const hash = await walletClient.sendTransaction({
    to: plan.factory,
    value,
    data: plan.launchTokenData,
  });
  console.log('tx', hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Launch reverted: ${hash}`);

  const launched = extractV2FactoryLaunch(receipt);
  if (!launched) throw new Error('TokenLaunched event missing from receipt');
  console.log('token', launched.token);
  console.log('curve', launched.curve);
  console.log('on-chain deployer', launched.deployer);

  console.log('2/3 createVault…');
  const vaultHash = await walletClient.sendTransaction({
    to: plan.vaultFactory,
    data: plan.createVaultData(launched.token),
  });
  console.log('tx', vaultHash);
  const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultHash });
  if (vaultReceipt.status !== 'success') {
    throw new Error(`Vault create reverted: ${vaultHash}`);
  }
  const vaultCreated = extractV2VaultCreated(vaultReceipt);
  if (!vaultCreated) throw new Error('VaultCreated event missing');
  console.log('vault', vaultCreated.vault);

  console.log('3/3 transferCreatorFeeRecipient…');
  const feeHash = await walletClient.sendTransaction({
    to: plan.factory,
    data: plan.transferFeeData(launched.token, vaultCreated.vault),
  });
  console.log('tx', feeHash);
  const feeReceipt = await publicClient.waitForTransactionReceipt({ hash: feeHash });
  if (feeReceipt.status !== 'success') {
    throw new Error(`Fee redirect reverted: ${feeHash}`);
  }

  console.log('page', `https://ponsvault.com/launchpad/${launched.token}`);
  console.log('explore', 'https://ponsvault.com/explore');

  try {
    const { recordPonsVaultLaunch } = await import(
      '../src/lib/launch-registry/store'
    );
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    await recordPonsVaultLaunch({
      token: launched.token,
      name: form.name,
      symbol: form.symbol,
      description: form.description,
      logo: form.imageUri,
      deployer: account.address,
      feeWallet: vaultCreated.vault,
      vault: vaultCreated.vault,
      vaultTemplate: 'rwa',
      transactionHash: hash,
      launchedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
      everGraduated: false,
    });
    console.log('recorded in ponsvault_launches');
  } catch (err) {
    console.warn('record skipped:', err instanceof Error ? err.message : err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
