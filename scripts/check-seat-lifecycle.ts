/**
 * Exercises the parts of a live seat series that a normal run never reaches.
 *
 * Tier upgrades, reward elections, a weighted split across seats and a liquidation all need either
 * a second wallet or a week of waiting, so they were only ever covered by Forge tests against
 * freshly deployed contracts. This runs them against the real deployed series on a fork of
 * mainnet: same bytecode, same state, nothing spent.
 *
 * Usage: KEEPER_KEY=0x… npm run seats:check-lifecycle
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  http,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import {
  ERC721_ABI,
  PONS_SEAT_ACTIVATION_ABI,
  PONS_SEAT_AMM_ABI,
  PONS_SEAT_BOOSTER_ABI,
  PONS_SEAT_COLLECTION_ABI,
  PONS_SEAT_LOAN_ABI,
  PONS_SEAT_SERIES_REGISTRY_ABI,
} from '@/lib/seats/abis';
import { PONS_SEAT_DEPLOYMENT } from '@/lib/seats/deployments';

const MAINNET_RPC = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const SERIES_ID = BigInt(process.env.SERIES_ID ?? '0');
const PORT = 8551;
const RPC = `http://127.0.0.1:${PORT}`;

const SNIPE_FEE = parseEther('0.0015');
/** Seats nobody has minted, so the run does not depend on who owns what today. */
const SEAT_A = 100n;
const SEAT_B = 101n;
const SEAT_LOAN = 102n;
const SEAT_C = 103n;

/** foundry installs outside the default PATH of a non-login shell often enough to be worth this. */
function anvilBin() {
  const installed = `${homedir()}/.foundry/bin/anvil`;
  return existsSync(installed) ? installed : 'anvil';
}

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`   ${ok ? 'OK  ' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}
function step(label: string) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}`);
}

async function rpc(method: string, params: unknown[]) {
  await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
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

async function send(
  wallet: WalletClient,
  client: PublicClient,
  label: string,
  tx: { to: Address; data?: Hex; value?: bigint },
) {
  const hash = await wallet.sendTransaction({
    account: wallet.account!,
    chain: robinhoodChain,
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted`);
  return receipt;
}

/** True when a call fails, which is what a guard being in place looks like from outside. */
async function rejects(promise: Promise<unknown>): Promise<boolean> {
  return promise.then(
    () => false,
    () => true,
  );
}

async function main() {
  const key = process.env.KEEPER_KEY as Hex | undefined;
  if (!key) throw new Error('set KEEPER_KEY');
  const holder = privateKeyToAccount(key);
  // A fresh key rather than an anvil default: the well-known ones carry EIP-7702 delegations on
  // this chain, and code without onERC721Received cannot be sent a seat.
  const stranger = privateKeyToAccount(generatePrivateKey());

  // Pinning the fork block lets anvil reuse its on-disk cache between runs. Left floating, every
  // run refetches the same state and the public RPC starts answering 429.
  const upstream = createPublicClient({
    transport: http(MAINNET_RPC, { retryCount: 8, retryDelay: 2_000 }),
  });
  const forkBlock = process.env.FORK_BLOCK ?? (await upstream.getBlockNumber()).toString();

  const anvil = spawn(
    anvilBin(),
    [
      '--fork-url',
      MAINNET_RPC,
      '--fork-block-number',
      forkBlock,
      '--retries',
      '10',
      '--fork-retry-backoff',
      '5',
      // The public RPC answers 429 long before anvil's default budget is spent, and a throttled
      // fetch during genesis kills the whole run.
      '--compute-units-per-second',
      '40',
      '--port',
      String(PORT),
      '--silent',
    ],
    { stdio: 'inherit' },
  );

  try {
    const client = createPublicClient({ transport: http(RPC) });
    await waitForChain(client);
    await rpc('anvil_setBalance', [holder.address, '0xDE0B6B3A7640000']);
    await rpc('anvil_setBalance', [stranger.address, '0xDE0B6B3A7640000']);

    const wallet = createWalletClient({ account: holder, transport: http(RPC), chain: robinhoodChain });
    const other = createWalletClient({ account: stranger, transport: http(RPC), chain: robinhoodChain });

    const [, fuel, collection, amm, activation, booster, loan] = await client.readContract({
      address: PONS_SEAT_DEPLOYMENT.registry as Address,
      abi: PONS_SEAT_SERIES_REGISTRY_ABI,
      functionName: 'series',
      args: [SERIES_ID],
    });
    console.log(`forked mainnet · series ${SERIES_ID} · collection ${collection}`);

    const [seatPrice, tier0, tier1] = await Promise.all([
      client.readContract({ address: amm, abi: PONS_SEAT_AMM_ABI, functionName: 'seatPrice' }),
      client.readContract({ address: activation, abi: PONS_SEAT_ACTIVATION_ABI, functionName: 'tiers', args: [0n] }),
      client.readContract({ address: activation, abi: PONS_SEAT_ACTIVATION_ABI, functionName: 'tiers', args: [1n] }),
    ]);

    const write = (to: Address, abi: readonly unknown[], functionName: string, args?: readonly unknown[], value?: bigint) =>
      wallet.writeContract({ account: holder, chain: robinhoodChain, address: to, abi, functionName, args, value } as never);

    async function tx(
      to: Address,
      abi: readonly unknown[],
      functionName: string,
      args?: readonly unknown[],
      value?: bigint,
    ) {
      const hash = (await write(to, abi, functionName, args, value)) as Hex;
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`${functionName} reverted on-chain`);
      return receipt;
    }

    step('stock up: three seats and the approvals they need');
    await send(wallet, client, 'approve fuel', {
      to: fuel,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [amm, seatPrice * 20n] }),
    });
    for (const id of [SEAT_A, SEAT_B, SEAT_LOAN, SEAT_C]) {
      await tx(amm, PONS_SEAT_AMM_ABI, 'snipe', [id], SNIPE_FEE);
    }
    check(
      (await client.readContract({ address: collection, abi: ERC721_ABI, functionName: 'ownerOf', args: [SEAT_A] })).toLowerCase() ===
        holder.address.toLowerCase(),
      'sniped three unminted seats out of the live series',
    );

    step('activation tiers and the weight they carry');
    const weightBefore = await client.readContract({
      address: activation,
      abi: PONS_SEAT_ACTIVATION_ABI,
      functionName: 'totalWeight',
    });
    await tx(fuel, erc20Abi, 'approve', [activation, tier0[0] * 20n + tier1[0] * 20n]);
    await tx(activation, PONS_SEAT_ACTIVATION_ABI, 'activate', [SEAT_A, 0]);
    await tx(activation, PONS_SEAT_ACTIVATION_ABI, 'activate', [SEAT_B, 1]);
    const weightAfter = await client.readContract({
      address: activation,
      abi: PONS_SEAT_ACTIVATION_ABI,
      functionName: 'totalWeight',
    });
    check(weightAfter - weightBefore === tier0[1] + tier1[1], 'payroll weight grew by exactly both tiers');
    check(
      await rejects(write(activation, PONS_SEAT_ACTIVATION_ABI, 'activate', [SEAT_A, 0])),
      'activating the same seat at the same tier again is refused',
    );

    step('a round splits by weight, not by head');
    const threshold = await client.readContract({
      address: booster,
      abi: PONS_SEAT_BOOSTER_ABI,
      functionName: 'threshold',
    });
    await send(wallet, client, 'fill the pot', { to: booster, value: threshold * 4n });
    const pot = await client.readContract({ address: booster, abi: PONS_SEAT_BOOSTER_ABI, functionName: 'accruedEth' });
    const roundWeight = await client.readContract({
      address: activation,
      abi: PONS_SEAT_ACTIVATION_ABI,
      functionName: 'totalWeight',
    });
    await tx(booster, PONS_SEAT_BOOSTER_ABI, 'crank');
    const roundId = await client.readContract({ address: booster, abi: PONS_SEAT_BOOSTER_ABI, functionName: 'roundCount' });

    const walletsOf = await Promise.all(
      [SEAT_A, SEAT_B].map((id) =>
        client.readContract({ address: collection, abi: PONS_SEAT_COLLECTION_ABI, functionName: 'accountOf', args: [id] }),
      ),
    );
    for (const id of [SEAT_A, SEAT_B]) {
      await tx(booster, PONS_SEAT_BOOSTER_ABI, 'deliver', [roundId, id]);
    }
    const paid = await Promise.all(walletsOf.map((address) => client.getBalance({ address })));
    const expectedA = (pot * tier0[1]) / roundWeight;
    const expectedB = (pot * tier1[1]) / roundWeight;
    console.log(`   tier 0 seat got ${formatEther(paid[0])} ETH, tier 1 seat got ${formatEther(paid[1])} ETH`);
    check(paid[0] === expectedA && paid[1] === expectedB, 'each seat got exactly its tier share of the pot');
    check(paid[1] > paid[0], 'the higher tier really is paid more');
    check(
      await rejects(write(booster, PONS_SEAT_BOOSTER_ABI, 'deliver', [roundId, SEAT_A])),
      'the same seat cannot claim the same round twice',
    );

    step('upgrading a tier, and what it costs you');
    await tx(activation, PONS_SEAT_ACTIVATION_ABI, 'upgrade', [SEAT_A, 2]);
    const upgraded = await client.readContract({
      address: activation,
      abi: PONS_SEAT_ACTIVATION_ABI,
      functionName: 'weightOf',
      args: [SEAT_A],
    });
    const tier2 = await client.readContract({
      address: activation,
      abi: PONS_SEAT_ACTIVATION_ABI,
      functionName: 'tiers',
      args: [2n],
    });
    check(upgraded === tier2[1], 'the seat now carries the top tier weight');
    check(
      await rejects(write(activation, PONS_SEAT_ACTIVATION_ABI, 'upgrade', [SEAT_A, 0])),
      'downgrading is refused',
    );

    // Upgrading restamps activatedAt, and a round only pays seats that were on the payroll when it
    // opened — so an upgrade during an open round gives up that round's share.
    await send(wallet, client, 'fill the pot again', { to: booster, value: threshold * 2n });
    await tx(booster, PONS_SEAT_BOOSTER_ABI, 'crank');
    const openRound = await client.readContract({ address: booster, abi: PONS_SEAT_BOOSTER_ABI, functionName: 'roundCount' });
    await rpc('anvil_increaseTime', [5]);
    await tx(activation, PONS_SEAT_ACTIVATION_ABI, 'upgrade', [SEAT_B, 2]);
    check(
      await rejects(write(booster, PONS_SEAT_BOOSTER_ABI, 'deliver', [openRound, SEAT_B])),
      'upgrading mid-round forfeits that round, as designed',
    );

    step('a seat that joins in the crank\u2019s own second');
    // Blocks here can share a timestamp, so this is the case an attacker can actually set up:
    // crank and activate in one block, then claim a round whose weight never counted the seat.
    await send(wallet, client, 'fill the pot once more', { to: booster, value: threshold * 2n });
    await rpc('anvil_setAutomine', [false]);
    await write(booster, PONS_SEAT_BOOSTER_ABI, 'crank');
    await write(activation, PONS_SEAT_ACTIVATION_ABI, 'activate', [SEAT_C, 0]);
    await rpc('anvil_mine', []);
    await rpc('anvil_setAutomine', [true]);
    const sameSecondRound = await client.readContract({
      address: booster,
      abi: PONS_SEAT_BOOSTER_ABI,
      functionName: 'roundCount',
    });
    const [sameSecondInfo, joinedAt] = await Promise.all([
      client.readContract({ address: booster, abi: PONS_SEAT_BOOSTER_ABI, functionName: 'rounds', args: [sameSecondRound] }),
      client.readContract({ address: activation, abi: PONS_SEAT_ACTIVATION_ABI, functionName: 'activatedAt', args: [SEAT_C] }),
    ]);
    console.log(`   round opened at ${sameSecondInfo[3]}, seat joined at ${joinedAt}`);
    check(joinedAt === sameSecondInfo[3], 'the seat did join in the same second as the crank');
    check(
      await rejects(write(booster, PONS_SEAT_BOOSTER_ABI, 'deliver', [sameSecondRound, SEAT_C])),
      'a seat that joined in the crank\u2019s second cannot claim that round',
    );

    step('electing which tokens a seat wants to be paid in');
    await tx(booster, PONS_SEAT_BOOSTER_ABI, 'elect', [SEAT_A, [fuel], [10_000n]]);
    const election = await client.readContract({
      address: booster,
      abi: PONS_SEAT_BOOSTER_ABI,
      functionName: 'electionOf',
      args: [SEAT_A],
    });
    check(election[0][0].toLowerCase() === fuel.toLowerCase(), 'the election was recorded');
    check(
      await rejects(write(booster, PONS_SEAT_BOOSTER_ABI, 'elect', [SEAT_A, [fuel], [9_000n]])),
      'weights that do not add up to 100% are refused',
    );
    check(
      await rejects(
        write(booster, PONS_SEAT_BOOSTER_ABI, 'elect', [
          SEAT_A,
          [fuel, fuel, fuel, fuel],
          [2_500n, 2_500n, 2_500n, 2_500n],
        ]),
      ),
      'more than three tokens is refused',
    );
    check(
      await rejects(
        other.writeContract({
          account: stranger,
          chain: robinhoodChain,
          address: booster,
          abi: PONS_SEAT_BOOSTER_ABI,
          functionName: 'elect',
          args: [SEAT_A, [fuel], [10_000n]],
        } as never),
      ),
      'someone who does not hold the seat cannot elect for it',
    );

    step('an overdue loan gets liquidated, and the vault is made whole');
    const principal = await client.readContract({
      address: loan,
      abi: PONS_SEAT_LOAN_ABI,
      functionName: 'principalAmount',
    });
    const minEthFee = await client.readContract({
      address: loan,
      abi: PONS_SEAT_LOAN_ABI,
      functionName: 'minEthFee',
    });
    await tx(fuel, erc20Abi, 'transfer', [loan, principal * 2n]);
    await tx(collection, ERC721_ABI, 'approve', [loan, SEAT_LOAN]);
    await tx(loan, PONS_SEAT_LOAN_ABI, 'borrow', [SEAT_LOAN], minEthFee);

    // Fund the stranger so they can actually pay the principal a liquidation demands.
    await tx(fuel, erc20Abi, 'transfer', [stranger.address, principal * 2n]);
    const liquidate = () =>
      other.writeContract({
        account: stranger,
        chain: robinhoodChain,
        address: loan,
        abi: PONS_SEAT_LOAN_ABI,
        functionName: 'liquidate',
        args: [SEAT_LOAN],
      } as never);

    check(await rejects(liquidate()), 'a loan inside its term cannot be liquidated');

    await rpc('anvil_increaseTime', [8 * 24 * 60 * 60]);
    await rpc('anvil_mine', []);

    check(
      await rejects(liquidate()),
      'and once overdue it still fails without the principal approved',
    );

    await client.waitForTransactionReceipt({
      hash: (await other.writeContract({
        account: stranger,
        chain: robinhoodChain,
        address: fuel,
        abi: erc20Abi,
        functionName: 'approve',
        args: [loan, principal * 2n],
      } as never)) as Hex,
    });
    const vaultBefore = await client.readContract({
      address: fuel,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [loan],
    });
    await client.waitForTransactionReceipt({ hash: (await liquidate()) as Hex });
    const [seatOwner, vaultAfter] = await Promise.all([
      client.readContract({ address: collection, abi: ERC721_ABI, functionName: 'ownerOf', args: [SEAT_LOAN] }),
      client.readContract({ address: fuel, abi: erc20Abi, functionName: 'balanceOf', args: [loan] }),
    ]);
    check(seatOwner.toLowerCase() === stranger.address.toLowerCase(), 'the overdue seat went to the liquidator');
    check(vaultAfter - vaultBefore === principal, 'the loan book got its principal back, not a free seizure');
    check(
      (await client.readContract({
        address: collection,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'accountOf',
        args: [SEAT_LOAN],
      })) !== zeroAddress,
      'the seized seat still has its wallet attached',
    );

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
