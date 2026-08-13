/**
 * Proves the one-transaction seat launch on a fork, without spending anything on mainnet.
 *
 * Everything the Create button sends goes through `PonsSeatLauncher`: the fuel launch, the first buy
 * and `createSeries` happen inside a single call, so there is one confirmation on any wallet rather
 * than one per call on wallets that cannot batch. This runs the plan the form builds against a
 * forked chain and checks that the series really came out attached to the token that call launched,
 * with the creator — not the launcher — recorded as its owner.
 *
 * Usage: npm run seats:check-batch
 */
import { spawn } from 'node:child_process';

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  numberToHex,
  parseEther,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import {
  PONS_SEAT_LAUNCHER_ABI,
  PONS_SEAT_SERIES_FACTORY_ABI,
  PONS_SEAT_SERIES_REGISTRY_ABI,
} from '@/lib/seats/abis';
import { PONS_SEAT_DEPLOYMENT } from '@/lib/seats/deployments';
import {
  FUEL_PAIR_OPTIONS,
  planLaunchedSeries,
  type FuelPairOption,
} from '@/lib/seats/fuel-launch';

const FORK_RPC = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const PORT = 8547;
const LOCAL = `http://127.0.0.1:${PORT}`;

// anvil's first default account — funded on the fork, and the address each plan is built for.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

const USDG = FUEL_PAIR_OPTIONS.find((token) => token.symbol === 'USDG')!;

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

async function waitForChain(client: PublicClient) {
  for (let i = 0; i < 60; i += 1) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('anvil did not come up');
}

/**
 * Gives an account an ERC-20 balance on the fork by writing the balances mapping directly.
 *
 * Which storage slot holds the mapping is a detail of how the token was compiled, so the slot is
 * found by trying the low ones and keeping whichever actually moves `balanceOf`.
 */
async function dealToken(rpc: string, token: Address, holder: Address, amount: bigint) {
  const publicClient = createPublicClient({ transport: http(rpc) });
  const value = numberToHex(amount, { size: 32 });

  for (let slot = 0; slot < 20; slot += 1) {
    const key = keccak256(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [holder, BigInt(slot)],
      ),
    );
    await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'anvil_setStorageAt',
        params: [token, key, value],
      }),
    });
    const balance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [holder],
    });
    if (balance === amount) return slot;
  }
  throw new Error('could not find the balances slot for the pair token');
}

async function runScenario(label: string, pair: FuelPairOption, firstBuy: bigint) {
  const account = privateKeyToAccount(KEY);
  const publicClient = createPublicClient({ transport: http(LOCAL) });
  const wallet = createWalletClient({ account, transport: http(LOCAL), chain: robinhoodChain });

  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}`);

  const nativePair = pair.address === zeroAddress;
  if (firstBuy > 0n && !nativePair) {
    const slot = await dealToken(LOCAL, pair.address as Address, account.address, firstBuy * 4n);
    console.log(`dealt ${pair.symbol} to the creator (balances slot ${slot})`);
  }

  const plan = await planLaunchedSeries(publicClient, {
    creator: account.address,
    series: {
      name: 'Fork Check Seats',
      symbol: 'FORK',
      tokenName: 'Fork Check Fuel',
      tokenSymbol: 'FORKF',
      baseTokenURI: 'ipfs://bafyfakefolder',
      maxSupply: 1111n,
      seatPrice: parseEther('666666'),
    },
    fuel: {
      pairToken: pair.address as Address,
      logo: 'ipfs://bafyfakeimage',
      description: 'fork check',
      firstBuy,
    },
  });

  const expectedCalls = nativePair || firstBuy === 0n ? 1 : 2;
  check(
    plan.calls.length === expectedCalls,
    `${plan.calls.length} wallet ${plan.calls.length === 1 ? 'prompt' : 'prompts'}, as expected`,
  );

  // Sent one at a time, which is the worst case: a wallet that cannot batch at all.
  const receipts = [];
  for (const [i, call] of plan.calls.entries()) {
    const hash = await wallet.sendTransaction({
      to: call.to,
      data: call.data,
      value: call.value ?? 0n,
      gas: 12_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`call ${i + 1} of ${label} reverted`);
    receipts.push(receipt);
  }
  console.log(
    `all ${plan.calls.length} calls succeeded · ${receipts
      .reduce((sum, r) => sum + r.gasUsed, 0n)
      .toLocaleString()} gas total`,
  );

  const launched = parseEventLogs({
    abi: PONS_SEAT_LAUNCHER_ABI,
    logs: receipts.at(-1)!.logs,
    eventName: 'SeriesLaunched',
  })[0];
  check(launched !== undefined, 'the launcher ran the whole thing in one call');
  if (!launched) return;
  const fuelToken = launched.args.fuelToken;
  console.log(`fuel token            ${fuelToken}`);

  const code = await publicClient.getCode({ address: fuelToken });
  check(Boolean(code && code !== '0x'), 'the fuel token was deployed by that call');

  const created = parseEventLogs({
    abi: PONS_SEAT_SERIES_FACTORY_ABI,
    logs: receipts.at(-1)!.logs,
    eventName: 'SeriesCreated',
  })[0];
  check(created !== undefined, 'the series was created in the same transaction');
  if (!created) return;

  // The registry is the source of truth for what the series actually runs on.
  const row = await publicClient.readContract({
    address: PONS_SEAT_DEPLOYMENT.registry as Address,
    abi: PONS_SEAT_SERIES_REGISTRY_ABI,
    functionName: 'series',
    args: [created.args.seriesId],
  });
  check(
    row[1].toLowerCase() === fuelToken.toLowerCase(),
    `series ${created.args.seriesId} runs on the launched fuel, not a minted one`,
  );
  check(
    row[0].toLowerCase() === account.address.toLowerCase(),
    'the series is recorded under the creator, not the launcher',
  );

  const fuelHeld = await publicClient.readContract({
    address: fuelToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (firstBuy > 0n) {
    check(fuelHeld > 0n, `creator holds fuel from the same call (${fuelHeld} wei)`);
  } else {
    check(fuelHeld === 0n, 'creator holds no fuel, as expected without a first buy');
  }
}

async function main() {
  const anvil = spawn(
    'anvil',
    ['--fork-url', FORK_RPC, '--port', String(PORT), '--silent', '--balance', '100'],
    { stdio: 'inherit' },
  );

  try {
    const publicClient = createPublicClient({ transport: http(LOCAL) });
    await waitForChain(publicClient);
    console.log(
      `forked chain ${await publicClient.getChainId()} at block ${await publicClient.getBlockNumber()}`,
    );

    const eth = FUEL_PAIR_OPTIONS[0];
    await runScenario('ETH pair · no first buy', eth, 0n);
    await runScenario('ETH pair · with a first buy', eth, parseEther('0.01'));
    await runScenario('USDG pair · no first buy', USDG, 0n);
    await runScenario('USDG pair · with a first buy', USDG, parseUnits('25', USDG.decimals));

    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
    if (failures > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`\n  FAIL  ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    anvil.kill('SIGTERM');
  }
}

void main();
