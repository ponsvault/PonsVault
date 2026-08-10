/**
 * Backfill the scripted SPCX RWA test launch into ponsvault_launches.
 *
 *   npx tsx --conditions=react-server scripts/record-spcx-test-launch.ts
 */
import { readFileSync } from 'fs';
import { createPublicClient, http, type Address, type Hex } from 'viem';

import { recordPonsVaultLaunch } from '../src/lib/launch-registry/store';
import { robinhoodChain } from '../src/lib/pons/chain';
import { ROBINHOOD_RPC_URL } from '../src/lib/pons/constants';
import { PONS_TOKEN_ABI } from '../src/lib/pons/token-state';
import { extractV2VaultLaunch } from '../src/lib/pons/v2-vault';

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

const TX =
  (process.env.SPCX_LAUNCH_TX?.trim() as Hex | undefined) ??
  '0x6784aca7f223eeb7817674e5ef74cd3bd16e45ac82c8a96604f742b040314007';

async function main() {
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC_URL),
  });

  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: TX }),
    client.getTransaction({ hash: TX }),
  ]);

  if (receipt.status !== 'success') {
    throw new Error(`Launch tx not successful: ${TX}`);
  }

  const launched = extractV2VaultLaunch(receipt);
  if (!launched) throw new Error('Launched event missing');

  const token = launched.token as Address;
  const [name, symbol, description, logo, block] = await Promise.all([
    client.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'name' }),
    client.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'symbol' }),
    client.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'description',
    }),
    client.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'logo' }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ]);

  const record = await recordPonsVaultLaunch({
    token: launched.token,
    name,
    symbol,
    description,
    logo,
    deployer: transaction.from,
    feeWallet: launched.vault,
    vault: launched.vault,
    vaultTemplate: 'rwa',
    transactionHash: TX,
    launchedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    everGraduated: false,
  });

  console.log('recorded', record.token, record.symbol, record.name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
