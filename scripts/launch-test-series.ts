/**
 * Launches one real seat series and then exercises the whole loop against it.
 *
 * This spends money. It launches a fuel token on the pons curve, creates a series that runs on it,
 * then buys, snipes, activates, distributes, sells and takes a loan against a seat, so every moving
 * part is proven on the live chain rather than on a fork.
 *
 * Nothing is sent unless CONFIRM=1. DRY_RUN=1 runs the identical sequence against a local fork of
 * mainnet, which is free and worth doing first.
 *
 * Usage:
 *   KEEPER_KEY=0x… DRY_RUN=1 tsx scripts/launch-test-series.ts
 *   KEEPER_KEY=0x… CONFIRM=1 tsx scripts/launch-test-series.ts
 */
import { spawn } from 'node:child_process';

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  http,
  parseEther,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import {
  ERC721_ABI,
  PONS_SEAT_ACTIVATION_ABI,
  PONS_SEAT_AMM_ABI,
  PONS_SEAT_BOOSTER_ABI,
  PONS_SEAT_COLLECTION_ABI,
  PONS_SEAT_LOAN_ABI,
  PONS_SEAT_SERIES_FACTORY_ABI,
  PONS_SEAT_SERIES_REGISTRY_ABI,
} from '@/lib/seats/abis';
import { EMPTY_PROVENANCE, SEAT_LOAN_MIN_ETH_FEE } from '@/lib/seats/create-series';
import { PONS_SEAT_DEPLOYMENT } from '@/lib/seats/deployments';
import { planFuelBackedSeries } from '@/lib/seats/fuel-launch';
import { ipfsToGateway } from '@/lib/utils';

const MAINNET_RPC = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const DRY_RUN = process.env.DRY_RUN === '1';
const CONFIRM = process.env.CONFIRM === '1';
const PORT = 8548;
const EXPLORER = 'https://robinhoodchain.blockscout.com';

const SERIES = {
  name: 'test test',
  symbol: 'TEST',
  tokenSymbol: 'TESTF',
  description: '',
  supply: 1111n,
  /** Cheap on purpose, so one small fuel buy covers seats, activation and a loan. */
  seatPrice: parseEther('10000'),
  /** Lowered from the 0.05 ETH product default so a payout round is reachable in a test. */
  distributeThreshold: parseEther('0.002'),
  firstBuyEth: parseEther('0.02'),
} as const;

// 127.0.0.1 rather than localhost: node resolves localhost to ::1 first, and the dev server
// listens on IPv4.
const app = process.env.APP_URL ?? 'http://127.0.0.1:3000';

const BUY_SEAT = 1n;
const SNIPE_SEAT = 7n;
const SWAP_FEE = parseEther('0.001'); // the shop's minimum: 10% of a 0.01 ETH notional
const SNIPE_FEE = parseEther('0.0015');
const LOAN_FEE = SEAT_LOAN_MIN_ETH_FEE; // same size as a buy, split between the pot and the treasury

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`   ${ok ? 'OK  ' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}
function step(label: string) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}`);
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

/** Builds and pins the Originals pack through the running app, the same path the UI uses. */
async function buildPack() {
  const reuse = process.env.PACK_BASE_URI;
  if (reuse) {
    console.log(`   reusing pinned pack ${reuse}`);
    return {
      baseTokenURI: reuse,
      imageUri: process.env.PACK_IMAGE_URI ?? '',
      provenanceHash: (process.env.PACK_PROVENANCE ?? EMPTY_PROVENANCE) as `0x${string}`,
    };
  }
  const res = await fetch(`${app}/api/seats/originals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: SERIES.name,
      symbol: SERIES.symbol,
      description: SERIES.description,
    }),
  });
  const data = (await res.json()) as {
    placeholderUri?: string;
    provenanceHash?: `0x${string}`;
    imageUri?: string;
    error?: string;
  };
  if (!res.ok || !data.placeholderUri || !data.provenanceHash || !data.imageUri) {
    throw new Error(`pack failed: ${data.error ?? res.status}`);
  }
  // The series sells sealed, so what goes on-chain is the placeholder plus the commitment.
  return {
    baseTokenURI: data.placeholderUri,
    provenanceHash: data.provenanceHash,
    imageUri: data.imageUri,
  };
}

async function send(
  wallet: WalletClient,
  client: PublicClient,
  label: string,
  tx: { to: Address; data: Hex; value?: bigint },
) {
  const hash = await wallet.sendTransaction({
    account: wallet.account!,
    chain: robinhoodChain,
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`   ${label}: ${receipt.status} · ${receipt.gasUsed.toLocaleString()} gas`);
  if (receipt.status !== 'success') throw new Error(`${label} reverted`);
  return receipt;
}

const call = {
  approve: (spender: Address, amount: bigint) =>
    encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
  transfer: (to: Address, amount: bigint) =>
    encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }),
  buy: () => encodeFunctionData({ abi: PONS_SEAT_AMM_ABI, functionName: 'buy' }),
  snipe: (id: bigint) =>
    encodeFunctionData({ abi: PONS_SEAT_AMM_ABI, functionName: 'snipe', args: [id] }),
  sell: (id: bigint) =>
    encodeFunctionData({ abi: PONS_SEAT_AMM_ABI, functionName: 'sell', args: [id] }),
  activate: (id: bigint, tier: number) =>
    encodeFunctionData({
      abi: PONS_SEAT_ACTIVATION_ABI,
      functionName: 'activate',
      args: [id, tier],
    }),
  crank: () => encodeFunctionData({ abi: PONS_SEAT_BOOSTER_ABI, functionName: 'crank' }),
  deliver: (round: bigint, id: bigint) =>
    encodeFunctionData({
      abi: PONS_SEAT_BOOSTER_ABI,
      functionName: 'deliver',
      args: [round, id],
    }),
  borrow: (id: bigint) =>
    encodeFunctionData({ abi: PONS_SEAT_LOAN_ABI, functionName: 'borrow', args: [id] }),
  repay: (id: bigint) =>
    encodeFunctionData({ abi: PONS_SEAT_LOAN_ABI, functionName: 'repay', args: [id] }),
  approveSeat: (to: Address, id: bigint) =>
    encodeFunctionData({ abi: ERC721_ABI, functionName: 'approve', args: [to, id] }),
};

async function main() {
  const key = process.env.KEEPER_KEY as Hex | undefined;
  if (!key) throw new Error('set KEEPER_KEY');
  const account = privateKeyToAccount(key);

  let anvil: ReturnType<typeof spawn> | undefined;
  let rpc = MAINNET_RPC;
  if (DRY_RUN) {
    anvil = spawn(
      'anvil',
      ['--fork-url', MAINNET_RPC, '--port', String(PORT), '--silent'],
      { stdio: 'inherit' },
    );
    rpc = `http://127.0.0.1:${PORT}`;
  } else if (!CONFIRM) {
    throw new Error('refusing to spend real funds without CONFIRM=1 (use DRY_RUN=1 to rehearse)');
  }

  const client = createPublicClient({ transport: http(rpc, { retryCount: 5, retryDelay: 1200 }) });
  const wallet = createWalletClient({ account, transport: http(rpc), chain: robinhoodChain });

  try {
    await waitForChain(client);
    if (DRY_RUN) {
      await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'anvil_setBalance',
          params: [account.address, '0xDE0B6B3A7640000'],
        }),
      });
    }

    const startBalance = await client.getBalance({ address: account.address });
    console.log(
      `${DRY_RUN ? 'DRY RUN (forked mainnet)' : 'LIVE MAINNET'} · chain ${await client.getChainId()}`,
    );
    console.log(`keeper  ${account.address}`);
    console.log(`balance ${formatEther(startBalance)} ETH`);

    step('pin the Originals pack');
    const pack = await buildPack();
    console.log(`   metadata ${pack.baseTokenURI}`);
    console.log(`   image    ${pack.imageUri}`);

    step('plan the launch');
    const plan = await planFuelBackedSeries(client, {
      creator: account.address,
      series: {
        name: SERIES.name,
        symbol: SERIES.symbol,
        tokenName: `${SERIES.name} fuel`,
        tokenSymbol: SERIES.tokenSymbol,
        baseTokenURI: pack.baseTokenURI,
        provenanceHash: pack.provenanceHash,
        maxSupply: SERIES.supply,
        seatPrice: SERIES.seatPrice,
        distributeThreshold: SERIES.distributeThreshold,
      },
      fuel: {
        pairToken: zeroAddress,
        logo: pack.imageUri,
        description: SERIES.description,
        firstBuy: SERIES.firstBuyEth,
      },
    });
    console.log(`   fuel token will be ${plan.fuelToken}`);
    console.log(`   curve will be      ${plan.curve}`);
    console.log(`   ${plan.calls.length} calls · launch fee ${formatEther(plan.launchFeeWei)} ETH`);

    step('launch fuel, buy fuel, create series');
    const labels = ['launchToken', 'buy fuel on the curve', 'createSeries'];
    const receipts = [];
    for (const [i, leg] of plan.calls.entries()) {
      receipts.push(await send(wallet, client, labels[i] ?? `call ${i + 1}`, leg));
    }

    const created = parseEventLogs({
      abi: PONS_SEAT_SERIES_FACTORY_ABI,
      logs: receipts.at(-1)!.logs,
      eventName: 'SeriesCreated',
    })[0];
    if (!created) throw new Error('no SeriesCreated event');
    const seriesId = created.args.seriesId;

    const [, fuel, collection, amm, activation, booster, loan] = await client.readContract({
      address: PONS_SEAT_DEPLOYMENT.registry as Address,
      abi: PONS_SEAT_SERIES_REGISTRY_ABI,
      functionName: 'series',
      args: [seriesId],
    });
    console.log(`   series id  ${seriesId}`);
    console.log(`   collection ${collection}`);
    console.log(`   fuel       ${fuel}`);
    console.log(`   shop       ${amm}`);
    check(fuel.toLowerCase() === plan.fuelToken.toLowerCase(), 'series runs on the launched fuel');

    const fuelHeld = await client.readContract({
      address: fuel,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    console.log(`   fuel held  ${Number(formatEther(fuelHeld)).toLocaleString()} ${SERIES.tokenSymbol}`);
    check(fuelHeld > SERIES.seatPrice * 3n, 'the first buy covers several seats');

    step('buy and snipe a seat');
    await send(wallet, client, 'approve fuel to the shop', {
      to: fuel,
      data: call.approve(amm, fuelHeld),
    });
    await send(wallet, client, 'buy the next seat', { to: amm, data: call.buy(), value: SWAP_FEE });
    await send(wallet, client, `snipe seat #${SNIPE_SEAT}`, {
      to: amm,
      data: call.snipe(SNIPE_SEAT),
      value: SNIPE_FEE,
    });

    const [owner1, owner7, minted, available, uri, seatWallet] = await Promise.all([
      client.readContract({ address: collection, abi: ERC721_ABI, functionName: 'ownerOf', args: [BUY_SEAT] }),
      client.readContract({ address: collection, abi: ERC721_ABI, functionName: 'ownerOf', args: [SNIPE_SEAT] }),
      client.readContract({ address: collection, abi: PONS_SEAT_COLLECTION_ABI, functionName: 'totalMinted' }),
      client.readContract({ address: amm, abi: PONS_SEAT_AMM_ABI, functionName: 'availableSupply' }),
      client.readContract({ address: collection, abi: PONS_SEAT_COLLECTION_ABI, functionName: 'tokenURI', args: [BUY_SEAT] }),
      client.readContract({ address: collection, abi: PONS_SEAT_COLLECTION_ABI, functionName: 'accountOf', args: [BUY_SEAT] }),
    ]);
    check(owner1.toLowerCase() === account.address.toLowerCase(), `seat #${BUY_SEAT} is ours`);
    check(owner7.toLowerCase() === account.address.toLowerCase(), `sniped seat #${SNIPE_SEAT} is ours`);
    check(minted === 2n, 'only the two bought seats were minted');
    check(available === SERIES.supply - 2n, `availableSupply is ${SERIES.supply - 2n}`);
    console.log(`   seat #${BUY_SEAT} uri    ${uri}`);
    console.log(`   seat #${BUY_SEAT} wallet ${seatWallet}`);

    if (!DRY_RUN) {
      const res = await fetch(ipfsToGateway(uri)).catch(() => undefined);
      const meta = res?.ok ? ((await res.json()) as { name?: string; image?: string }) : undefined;
      check(Boolean(meta?.image), `metadata resolves off IPFS: ${meta?.name ?? 'unreadable'}`);
      if (meta?.image) {
        const art = await fetch(ipfsToGateway(meta.image), { method: 'HEAD' }).catch(() => undefined);
        check(Boolean(art?.ok), 'seat artwork resolves off IPFS');
      }

      // A sealed series must give nothing away: both seats read the same card, and the app refuses
      // to hand out the pack while the sale is still running.
      const snipedUri = await client.readContract({
        address: collection,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'tokenURI',
        args: [SNIPE_SEAT],
      });
      check(uri === pack.baseTokenURI, 'the bought seat shows the sealed card, not its art');
      check(snipedUri === uri, 'the sniped seat is indistinguishable from it');

      const early = await fetch(`${app}/api/seats/reveal?collection=${collection}`);
      check(early.status === 409, 'the reveal endpoint refuses while the series is sealed');
    }

    step('activate a seat');
    await send(wallet, client, 'approve fuel to activation', {
      to: fuel,
      data: call.approve(activation, fuelHeld),
    });
    await send(wallet, client, 'activate tier 0', {
      to: activation,
      data: call.activate(BUY_SEAT, 0),
    });
    check(
      await client.readContract({
        address: activation,
        abi: PONS_SEAT_ACTIVATION_ABI,
        functionName: 'isActivated',
        args: [BUY_SEAT],
      }),
      `seat #${BUY_SEAT} is on the payroll`,
    );

    step('fill the pot and pay out');
    const [accrued, threshold] = await Promise.all([
      client.readContract({ address: booster, abi: PONS_SEAT_BOOSTER_ABI, functionName: 'accruedEth' }),
      client.readContract({ address: booster, abi: PONS_SEAT_BOOSTER_ABI, functionName: 'threshold' }),
    ]);
    console.log(`   pot ${formatEther(accrued)} / ${formatEther(threshold)} ETH`);
    // Selling also pays a trade fee, so a short pot is topped up by the same call that tests resale.
    const sellFee = accrued < threshold ? threshold - accrued + SWAP_FEE : SWAP_FEE;
    const fuelBeforeSell = await client.readContract({
      address: fuel,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    // The shop pulls the NFT with transferFrom, so it needs approval the same way fuel does.
    await send(wallet, client, 'approve the seat to the shop', {
      to: collection,
      data: call.approveSeat(amm, SNIPE_SEAT),
    });
    await send(wallet, client, `sell seat #${SNIPE_SEAT} back to the shop`, {
      to: amm,
      data: call.sell(SNIPE_SEAT),
      value: sellFee,
    });
    const [fuelAfterSell, inventory] = await Promise.all([
      client.readContract({
        address: fuel,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      }),
      client.readContract({ address: amm, abi: PONS_SEAT_AMM_ABI, functionName: 'inventorySize' }),
    ]);
    check(fuelAfterSell - fuelBeforeSell === SERIES.seatPrice, 'selling refunded the seat price');
    check(inventory === 1n, 'the sold seat is back on the shelf');

    const potAtCrank = await client.readContract({
      address: booster,
      abi: PONS_SEAT_BOOSTER_ABI,
      functionName: 'accruedEth',
    });
    await send(wallet, client, 'distribute (crank)', { to: booster, data: call.crank() });
    // The booster has no event in our ABI, and crank always opens the newest round.
    const roundId = await client.readContract({
      address: booster,
      abi: PONS_SEAT_BOOSTER_ABI,
      functionName: 'roundCount',
    });
    console.log(`   round ${roundId} · pot ${formatEther(potAtCrank)} ETH`);

    const walletBefore = await client.getBalance({ address: seatWallet });
    await send(wallet, client, 'deliver into the seat wallet', {
      to: booster,
      data: call.deliver(roundId, BUY_SEAT),
    });
    const walletAfter = await client.getBalance({ address: seatWallet });
    console.log(`   seat wallet ${formatEther(walletBefore)} → ${formatEther(walletAfter)} ETH`);
    check(walletAfter > walletBefore, 'the reward landed in the seat wallet');

    step('borrow against a seat and repay');
    const principal = await client.readContract({
      address: loan,
      abi: PONS_SEAT_LOAN_ABI,
      functionName: 'principalAmount',
    });
    console.log(`   principal ${Number(formatEther(principal)).toLocaleString()} ${SERIES.tokenSymbol} per seat`);
    await send(wallet, client, 'seed the loan book', {
      to: fuel,
      data: call.transfer(loan, principal * 2n),
    });
    await send(wallet, client, 'approve the seat to the loan vault', {
      to: collection,
      data: call.approveSeat(loan, BUY_SEAT),
    });

    const fuelBefore = await client.readContract({
      address: fuel,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    await send(wallet, client, 'borrow', { to: loan, data: call.borrow(BUY_SEAT), value: LOAN_FEE });
    const fuelAfter = await client.readContract({
      address: fuel,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    check(fuelAfter > fuelBefore, `borrowed ${Number(formatEther(fuelAfter - fuelBefore)).toLocaleString()} ${SERIES.tokenSymbol}`);

    await send(wallet, client, 'approve fuel to the loan vault', {
      to: fuel,
      data: call.approve(loan, principal * 2n),
    });
    await send(wallet, client, 'repay', { to: loan, data: call.repay(BUY_SEAT) });
    const backOwner = await client.readContract({
      address: collection,
      abi: ERC721_ABI,
      functionName: 'ownerOf',
      args: [BUY_SEAT],
    });
    check(backOwner.toLowerCase() === account.address.toLowerCase(), 'the seat came back after repaying');

    step('summary');
    const endBalance = await client.getBalance({ address: account.address });
    console.log(`   spent    ${formatEther(startBalance - endBalance)} ETH`);
    console.log(`   series   ${EXPLORER}/address/${collection}`);
    console.log(`   fuel     ${EXPLORER}/token/${fuel}`);
    console.log(`   desk     /seats/${seriesId}`);
    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
    if (failures > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`\n  FAIL  ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    anvil?.kill('SIGTERM');
  }
}

void main();
