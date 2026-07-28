/**
 * Finds where a token actually trades.
 *
 * The Uniswap V3 pools for most tokenized stocks on this chain are empty, yet
 * the tokens have tens of thousands of holders — so the trading is happening
 * somewhere this codebase does not look. Whether an RWA vault can ever support
 * AAPL or TSLA depends entirely on what that somewhere is, and whether a
 * contract can reach it.
 *
 * Works backwards from the evidence rather than guessing at venues: take recent
 * transfers, find the addresses that appear in the most of them, and identify
 * the ones with code. A venue cannot hide from its own transfer log.
 *
 *   npx tsx --conditions=react-server scripts/rwa-find-venue.ts <token> [symbol]
 */
import { formatEther, parseAbiItem, type Address } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/** Small by default: the RPC caps a response at 10k logs, and a busy stock blows past that. */
const LOOKBACK = BigInt(process.argv[4] ?? 20_000);

async function main() {
  const token = process.argv[2] as Address;
  const label = process.argv[3] ?? token;
  if (!token) throw new Error('usage: rwa-find-venue.ts <token> [symbol]');

  const head = await robinhoodPublicClient.getBlockNumber();
  const logs = await robinhoodPublicClient.getLogs({
    address: token,
    event: TRANSFER,
    fromBlock: head - LOOKBACK,
    toBlock: head,
  });

  console.log(`${label}: ${logs.length} transfers in the last ${LOOKBACK} blocks\n`);
  if (logs.length === 0) return;

  // Counterparty frequency. A venue sits on one side of a large share of trades;
  // ordinary holders appear once or twice.
  const seen = new Map<string, { count: number; inbound: bigint; outbound: bigint }>();
  const bump = (address: string, value: bigint, inbound: boolean) => {
    const key = address.toLowerCase();
    const entry = seen.get(key) ?? { count: 0, inbound: 0n, outbound: 0n };
    entry.count++;
    if (inbound) entry.inbound += value;
    else entry.outbound += value;
    seen.set(key, entry);
  };

  for (const log of logs) {
    const { from, to, value } = log.args;
    if (!from || !to || value === undefined) continue;
    bump(from, value, false);
    bump(to, value, true);
  }

  const ranked = [...seen.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);

  const codes = await Promise.all(
    ranked.map(([address]) =>
      robinhoodPublicClient.getCode({ address: address as Address }).catch(() => undefined),
    ),
  );

  console.log('  busiest counterparties (contracts are candidate venues):');
  console.log('  ' + '-'.repeat(94));
  ranked.forEach(([address, stats], i) => {
    const size = codes[i] ? (codes[i]!.length - 2) / 2 : 0;
    const kind = size > 0 ? `contract ${size}b` : 'EOA';
    const share = ((stats.count / (logs.length * 2)) * 100).toFixed(1);
    console.log(
      `  ${address}  ${String(stats.count).padStart(5)} (${share.padStart(4)}%)  ${kind.padEnd(16)}` +
        ` in=${formatEther(stats.inbound).slice(0, 12)} out=${formatEther(stats.outbound).slice(0, 12)}`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
