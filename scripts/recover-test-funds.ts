/**
 * Pulls the ETH left behind by a test run back into the wallet that paid for it.
 *
 * Nothing a run spends inside a series is lost: trade and loan fees land in that series' reward
 * pot, and a payout moves them into the seat's own wallet, which the seat's owner controls. This
 * walks that path — distribute, deliver, deploy the seat wallet, withdraw — for every series it is
 * pointed at, so a finished test does not quietly sit on a pile of ETH.
 *
 * Usage: KEEPER_KEY=0x… npx tsx scripts/recover-test-funds.ts
 */
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import { resolveLaunchedToken } from '@/lib/pons/factory';
import {
  ERC20_ABI,
  PONS_SEAT_ACCOUNT_ABI,
  PONS_SEAT_ACTIVATION_ABI,
  PONS_SEAT_BOOSTER_ABI,
  PONS_SEAT_COLLECTION_ABI,
  PONS_SEAT_SERIES_REGISTRY_ABI,
} from '@/lib/seats/abis';
import { PONS_SEAT_DEPLOYMENT } from '@/lib/seats/deployments';


const RPC = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';

/** The throwaway series left over from mainnet test runs, newest first. */
interface TestSeries {
  label: string;
  collection: Address;
  booster: Address;
  activation: Address;
  fuel: Address;
  /** The bonding curve that fuel trades on, in case the seat has to be activated again. */
  curve: Address;
  seat: bigint;
}

/** The ETH-paired curve takes the amount as transaction value, so this has to be the payable one. */
const CURVE_BUY_ABI = parseAbi([
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)',
]);

/** Enough to cover a tier 0 activation fee several times over at any sane curve price. */
const FUEL_TOP_UP = parseEther('0.0005');

const SERIES: TestSeries[] = [
  {
    label: 'run 3 (sealed)',
    collection: '0x0c6a14278C44745EEAbeb3D4357ccA7E9BeE26bd',
    booster: '0x6f5A00d7689590bE14e6F3cc417Fca18d1B01f77',
    activation: '0xf188c4fc7a27C2C1D6e7817868CDff5D5791B687',
    fuel: '0xc1c0D04B116175A5E2F41C8Df171Fc3AF7731716',
    curve: '0xeF29F2Bd57F590Da03A28aa3cFEc4A0646ae4F91',
    seat: 1n,
  },
  {
    label: 'run 2',
    collection: '0x1d85AE7F647ef2b2231294E8d3b499866C637dc5',
    booster: '0xce9a6Fa14aA6e3a56d3DCa01F4bA2Dada9d7c80b',
    activation: '0x422EBB2F28c81f3D54aA50A12301951b9a3b6D0f',
    fuel: '0x72EAc2220a8afc1688093F8bAc2a499783cfB786',
    curve: '0x87C5bfDD8cf00606Ca1Aeac479b5DcA724ED19d3',
    seat: 1n,
  },
  {
    label: 'run 1',
    collection: '0xCfdb21231c75869e9a58cc13ce433Ab2da22e193',
    booster: '0x7Ea9034aF74eaaFe44f5824069DA5FEe8DcD5149',
    activation: '0xc6208c2e0e006Be3D058698d343bD19DF2e0914D',
    fuel: '0x9E1e67E82002ec20F051e1b1c140D16e3b27B48a',
    curve: '0x349C6224E44b1306B9871E42595200428aBfb46c',
    seat: 1n,
  },
];

/**
 * Reads a series out of the current registry, so a run you just made by hand can be cleaned up
 * without editing this file: `npx tsx scripts/recover-test-funds.ts 1 2`.
 */
async function fromRegistry(client: PublicClient, seriesId: bigint): Promise<TestSeries> {
  const [, fuel, collection, , activation, booster] = await client.readContract({
    address: PONS_SEAT_DEPLOYMENT.registry as Address,
    abi: PONS_SEAT_SERIES_REGISTRY_ABI,
    functionName: 'series',
    args: [seriesId],
  });
  const launch = await resolveLaunchedToken(fuel);
  return {
    label: `series ${seriesId}`,
    collection,
    booster,
    activation,
    fuel,
    curve: (launch?.launched.curve ?? '0x') as Address,
    seat: 1n,
  };
}

async function main() {
  const key = process.env.KEEPER_KEY as Hex | undefined;
  if (!key) throw new Error('set KEEPER_KEY');
  const account = privateKeyToAccount(key);

  const client = createPublicClient({ chain: robinhoodChain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http(RPC) });
  const before = await client.getBalance({ address: account.address });

  const ids = process.argv.slice(2).filter((arg) => /^\d+$/.test(arg));
  const series = ids.length
    ? await Promise.all(ids.map((id) => fromRegistry(client, BigInt(id))))
    : SERIES;

  const send = async (label: string, hash: Hex) => {
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`   ${label}: ${receipt.status}`);
    if (receipt.status !== 'success') throw new Error(`${label} reverted`);
  };

  for (const entry of series) {
    console.log(`\n── ${entry.label} ${'─'.repeat(Math.max(0, 44 - entry.label.length))}`);

    const [pot, threshold] = await Promise.all([
      client.getBalance({ address: entry.booster }),
      client.readContract({
        address: entry.booster,
        abi: PONS_SEAT_BOOSTER_ABI,
        functionName: 'threshold',
      }),
    ]);
    console.log(`   pot ${formatEther(pot)} ETH`);

    if (pot >= threshold && pot > 0n) {
      // A round needs somebody on the payroll to pay. Borrowing against the seat moved it to the
      // loan vault, and a transfer clears activation, so the last thing a test run does is leave
      // the series with nobody eligible — put our seat back on before opening the round.
      const weight = await client.readContract({
        address: entry.activation,
        abi: PONS_SEAT_ACTIVATION_ABI,
        functionName: 'totalWeight',
      });
      if (weight === 0n) {
        const [tier] = await client.readContract({
          address: entry.activation,
          abi: PONS_SEAT_ACTIVATION_ABI,
          functionName: 'tiers',
          args: [0n],
        });
        const held = await client.readContract({
          address: entry.fuel,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [account.address],
        });
        if (held < tier) {
          console.log(`   buying ${formatEther(FUEL_TOP_UP)} ETH of fuel to activate again`);
          await send(
            'buy fuel',
            await wallet.writeContract({
              address: entry.curve,
              abi: CURVE_BUY_ABI,
              functionName: 'buy',
              args: [FUEL_TOP_UP, 0n, account.address],
              value: FUEL_TOP_UP,
            }),
          );
        }
        await send(
          'approve fuel',
          await wallet.writeContract({
            address: entry.fuel,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [entry.activation, tier],
          }),
        );
        await send(
          'activate the seat again',
          await wallet.writeContract({
            address: entry.activation,
            abi: PONS_SEAT_ACTIVATION_ABI,
            functionName: 'activate',
            args: [entry.seat, 0],
          }),
        );
      }

      await send(
        'distribute',
        await wallet.writeContract({
          address: entry.booster,
          abi: PONS_SEAT_BOOSTER_ABI,
          functionName: 'crank',
        }),
      );
    }

    const rounds = await client.readContract({
      address: entry.booster,
      abi: PONS_SEAT_BOOSTER_ABI,
      functionName: 'roundCount',
    });
    if (rounds > 0n) {
      // An already-claimed round reverts, and there is nothing to do about that here.
      try {
        await send(
          `deliver round ${rounds}`,
          await wallet.writeContract({
            address: entry.booster,
            abi: PONS_SEAT_BOOSTER_ABI,
            functionName: 'deliver',
            args: [rounds, entry.seat],
          }),
        );
      } catch {
        console.log(`   deliver round ${rounds}: nothing to claim`);
      }
    }

    const tba = await client.readContract({
      address: entry.collection,
      abi: PONS_SEAT_COLLECTION_ABI,
      functionName: 'accountOf',
      args: [entry.seat],
    });
    const held = await client.getBalance({ address: tba });
    console.log(`   seat wallet ${tba} holds ${formatEther(held)} ETH`);
    if (held === 0n) continue;

    const code = await client.getCode({ address: tba });
    if (!code || code === '0x') {
      await send(
        'deploy the seat wallet',
        await wallet.writeContract({
          address: entry.collection,
          abi: PONS_SEAT_COLLECTION_ABI,
          functionName: 'createAccount',
          args: [entry.seat],
        }),
      );
    }

    await send(
      'withdraw',
      await wallet.writeContract({
        address: tba,
        abi: PONS_SEAT_ACCOUNT_ABI,
        functionName: 'execute',
        args: [account.address, held, '0x'],
      }),
    );
  }

  const after = await client.getBalance({ address: account.address });
  console.log(
    `\nwallet ${formatEther(before)} → ${formatEther(after)} ETH ` +
      `(${after > before ? '+' : ''}${formatEther(after - before)} after gas)`,
  );
}

void main();
