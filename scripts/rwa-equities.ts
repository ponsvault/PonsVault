/**
 * Depth check for the tokenized equities specifically.
 *
 * The broad survey ranks everything on the chain by pool depth, which is
 * dominated by memecoins and says nothing about whether the assets this
 * template is actually for can be bought. This asks the narrower question the
 * product depends on: for each Robinhood-issued stock token, is there enough
 * WETH liquidity to convert a round into it at a sane price?
 *
 *   npx tsx --conditions=react-server scripts/rwa-equities.ts
 */
import { formatEther, parseEther, type Address } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';

const V3_FACTORY = '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA' as const;
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as const;
const FEE_TIERS = [100, 500, 3_000, 10_000] as const;
const ROUND = parseEther('0.025');

/**
 * Issued stock tokens, identified by holder counts in the tens of thousands.
 * That matters because several memecoins on this chain use ticker-shaped
 * symbols — there is an unrelated "MSTR" with 278 holders — so symbol alone
 * cannot tell you which is which.
 */
const EQUITIES: { symbol: string; address: Address; holders: number }[] = [
  { symbol: 'NVDA', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', holders: 30571 },
  { symbol: 'AAPL', address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', holders: 27963 },
  { symbol: 'SPCX', address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', holders: 26015 },
  { symbol: 'GOOGL', address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', holders: 23437 },
  { symbol: 'TSLA', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', holders: 21290 },
  { symbol: 'AMD', address: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC', holders: 18128 },
  { symbol: 'SPY', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', holders: 10391 },
  { symbol: 'SNDK', address: '0xB90A19fF0Af67f7779afF50A882A9CfF42446400', holders: 9992 },
  { symbol: 'GME', address: '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', holders: 5558 },
  { symbol: 'SGOV', address: '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5', holders: 140 },
];

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ type: 'address' }],
  },
] as const;

const BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

async function main() {
  const pools = await robinhoodPublicClient.multicall({
    contracts: EQUITIES.flatMap((e) =>
      FEE_TIERS.map((fee) => ({
        address: V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: 'getPool' as const,
        args: [WETH, e.address, fee] as const,
      })),
    ),
    allowFailure: true,
  });

  const found: { symbol: string; fee: number; pool: Address; index: number }[] = [];
  EQUITIES.forEach((e, i) => {
    FEE_TIERS.forEach((fee, j) => {
      const r = pools[i * FEE_TIERS.length + j];
      if (r.status !== 'success') return;
      const pool = r.result as Address;
      if (pool === '0x0000000000000000000000000000000000000000') return;
      found.push({ symbol: e.symbol, fee, pool, index: i });
    });
  });

  const depths = await robinhoodPublicClient.multicall({
    contracts: found.map((f) => ({
      address: WETH,
      abi: BALANCE_ABI,
      functionName: 'balanceOf' as const,
      args: [f.pool] as const,
    })),
    allowFailure: true,
  });

  // Best tier per asset only: that is the route a creator would be given.
  const best = new Map<string, { fee: number; depth: bigint }>();
  found.forEach((f, i) => {
    const depth = depths[i].status === 'success' ? (depths[i].result as bigint) : 0n;
    const current = best.get(f.symbol);
    if (!current || depth > current.depth) best.set(f.symbol, { fee: f.fee, depth });
  });

  console.log(`One round is ${formatEther(ROUND)} WETH.\n`);
  console.log('  symbol   holders   best tier   WETH in pool     rounds before the pool is half drained');
  console.log('  ' + '-'.repeat(86));

  for (const equity of EQUITIES) {
    const b = best.get(equity.symbol);
    if (!b) {
      console.log(`  ${equity.symbol.padEnd(8)} ${String(equity.holders).padStart(7)}   no WETH pool at all`);
      continue;
    }
    const rounds = b.depth / 2n / ROUND;
    const verdict = b.depth < ROUND ? 'UNUSABLE' : rounds < 40n ? 'too thin' : 'usable';
    console.log(
      `  ${equity.symbol.padEnd(8)} ${String(equity.holders).padStart(7)}   ${String(b.fee).padStart(9)}   ` +
        `${formatEther(b.depth).slice(0, 14).padEnd(16)} ${String(rounds).padStart(8)}   ${verdict}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
