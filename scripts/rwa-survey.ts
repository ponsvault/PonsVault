/**
 * Surveys which assets an RWA vault could actually be pointed at.
 *
 * The vault takes any ERC-20 with a funded WETH pool, so the real constraint is
 * not the contract but the chain: an asset with no pool cannot be bought, and
 * one with a pool holding almost nothing can be, but at a price that makes the
 * dividend worthless. Both need measuring rather than guessing, and the answer
 * moves as liquidity does.
 *
 * Quotes a realistic round rather than reporting raw liquidity, because depth
 * only matters relative to the trade: the number that decides whether an asset
 * belongs in the picker is what a holder actually receives.
 *
 *   npx tsx --conditions=react-server scripts/rwa-survey.ts
 */
import { formatEther, parseEther, type Address } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';

const V3_FACTORY = '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA' as const;
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as const;
const FEE_TIERS = [100, 500, 3_000, 10_000] as const;

/** A round at the keeper's floor: the smallest trade the vault will ever make. */
const PROBE_WETH = parseEther('0.025');

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

const POOL_ABI = [
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
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

interface Candidate {
  symbol: string;
  address: Address;
  holders: number;
}

/** Everything the chain lists, so the survey is not limited to assets I thought of. */
async function fetchTokens(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let url = 'https://robinhoodchain.blockscout.com/api/v2/tokens?type=ERC-20';

  for (let page = 0; page < 12; page++) {
    const response = await fetch(url);
    if (!response.ok) break;
    const body = (await response.json()) as {
      items?: { symbol?: string; address_hash?: string; address?: string; holders_count?: string }[];
      next_page_params?: Record<string, string | number> | null;
    };

    for (const item of body.items ?? []) {
      const address = (item.address_hash ?? item.address) as Address | undefined;
      if (!address || !item.symbol) continue;
      out.push({ symbol: item.symbol, address, holders: Number(item.holders_count ?? 0) });
    }

    if (!body.next_page_params) break;
    const params = new URLSearchParams(
      Object.entries(body.next_page_params).map(([k, v]) => [k, String(v)]),
    );
    url = `https://robinhoodchain.blockscout.com/api/v2/tokens?type=ERC-20&${params}`;
  }

  return out;
}

/**
 * How much WETH a pool holds.
 *
 * Uniswap's own quoter is not deployed on this chain, and `liquidity()` alone
 * is a tick-scoped number that cannot be compared across pools with different
 * prices and decimals. The WETH sitting in the pool is neither of those things:
 * it is directly comparable, and it is the honest ceiling on how large a round
 * an asset can absorb before the vault is just moving the price against itself.
 */
async function wethDepth(pool: Address): Promise<bigint> {
  return robinhoodPublicClient
    .readContract({ address: WETH, abi: BALANCE_ABI, functionName: 'balanceOf', args: [pool] })
    .catch(() => 0n);
}

async function main() {
  const tokens = await fetchTokens();
  console.log(`${tokens.length} ERC-20s listed on the chain\n`);

  // Find the deepest WETH pool for each, across every fee tier.
  const pools = await robinhoodPublicClient.multicall({
    contracts: tokens.flatMap((t) =>
      FEE_TIERS.map((fee) => ({
        address: V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: 'getPool' as const,
        args: [WETH, t.address, fee] as const,
      })),
    ),
    allowFailure: true,
  });

  interface Routed {
    token: Candidate;
    fee: number;
    pool: Address;
  }
  const routed: Routed[] = [];

  tokens.forEach((token, i) => {
    FEE_TIERS.forEach((fee, j) => {
      const result = pools[i * FEE_TIERS.length + j];
      if (result.status !== 'success') return;
      const pool = result.result as Address;
      if (pool === '0x0000000000000000000000000000000000000000') return;
      routed.push({ token, fee, pool });
    });
  });

  // A pool can exist and hold nothing, which is indistinguishable from a working
  // one until a swap silently returns dust.
  const depths = await robinhoodPublicClient.multicall({
    contracts: routed.map((r) => ({ address: r.pool, abi: POOL_ABI, functionName: 'liquidity' as const })),
    allowFailure: true,
  });

  const funded = routed.filter((_, i) => depths[i].status === 'success' && (depths[i].result as bigint) > 0n);

  // Keep only the deepest tier per asset: that is the one a creator should use.
  const best = new Map<Address, Routed>();
  funded.forEach((r) => {
    const depth = depths[routed.indexOf(r)].result as bigint;
    const current = best.get(r.token.address);
    if (!current) {
      best.set(r.token.address, r);
      return;
    }
    const currentDepth = depths[routed.indexOf(current)].result as bigint;
    if (depth > currentDepth) best.set(r.token.address, r);
  });

  console.log(`${best.size} assets have at least one funded WETH pool.\n`);

  const rows: { symbol: string; address: Address; fee: number; holders: number; depth: bigint }[] = [];

  for (const r of best.values()) {
    const depth = await wethDepth(r.pool);
    // A pool holding less WETH than one round is not a route, it is a trap: the
    // vault would spend a full harvest pushing the price up against itself.
    if (depth < PROBE_WETH) continue;
    rows.push({
      symbol: r.token.symbol,
      address: r.token.address,
      fee: r.fee,
      holders: r.token.holders,
      depth,
    });
  }

  rows.sort((a, b) => (b.depth > a.depth ? 1 : -1));

  console.log(`${rows.length} of those can absorb at least one floor-sized round (${formatEther(PROBE_WETH)} WETH).\n`);
  console.log('  symbol        fee     holders    WETH in pool   rounds it absorbs');
  console.log('  ' + '-'.repeat(72));
  for (const row of rows.slice(0, 40)) {
    const rounds = row.depth / PROBE_WETH;
    console.log(
      `  ${row.symbol.padEnd(13)} ${String(row.fee).padStart(5)} ${String(row.holders).padStart(9)}   ` +
        `${formatEther(row.depth).slice(0, 12).padEnd(14)} ${String(rounds).padStart(8)}`,
    );
  }

  // Tokenized equities are the point of the template, so call them out.
  const equityish = rows.filter((r) => /^[A-Z]{1,5}$/.test(r.symbol));
  console.log(`\nticker-shaped symbols (likely tokenized equities), ${equityish.length} of them:`);
  for (const row of equityish.slice(0, 30)) {
    console.log(
      `  ${row.symbol.padEnd(8)} ${row.address}  fee ${String(row.fee).padStart(5)}  ` +
        `${formatEther(row.depth).slice(0, 10)} WETH`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
