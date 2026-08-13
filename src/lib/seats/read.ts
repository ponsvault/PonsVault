import { createPublicClient, http, type Address } from 'viem';

import { robinhoodChain } from '@/lib/pons/chain';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';

import { PONS_SEAT_SERIES_REGISTRY_ABI } from './abis';
import { PONS_SEAT_DEPLOYMENT, isSeatInfraConfigured } from './deployments';
import type { SeatSeries } from './types';

/**
 * The public node rate limits, and a series page that reads it on every request hits that ceiling
 * often enough to matter. Retrying a few times with backoff turns a burst into a slow response
 * rather than a page that claims the series does not exist.
 */
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(ROBINHOOD_RPC_URL, { retryCount: 3, retryDelay: 300 }),
});

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function mapRow(seriesId: number, row: readonly [
  Address,
  Address,
  Address,
  Address,
  Address,
  Address,
  Address,
  string,
  string,
  bigint,
  number | bigint,
]): SeatSeries {
  return {
    seriesId,
    creator: row[0],
    token: row[1],
    collection: row[2],
    amm: row[3],
    activation: row[4],
    booster: row[5],
    loan: row[6],
    name: row[7],
    symbol: row[8],
    maxSupply: row[9].toString(),
    createdAt: Number(row[10]) * 1000,
  };
}

export async function listSeatSeries(): Promise<SeatSeries[]> {
  if (!isSeatInfraConfigured()) return [];

  const count = await client.readContract({
    address: PONS_SEAT_DEPLOYMENT.registry as Address,
    abi: PONS_SEAT_SERIES_REGISTRY_ABI,
    functionName: 'seriesCount',
  });

  const rows = await Promise.all(
    Array.from({ length: Number(count) }, (_, seriesId) =>
      client.readContract({
        address: PONS_SEAT_DEPLOYMENT.registry as Address,
        abi: PONS_SEAT_SERIES_REGISTRY_ABI,
        functionName: 'series',
        args: [BigInt(seriesId)],
      }),
    ),
  );

  return rows.map((row, seriesId) => mapRow(seriesId, row)).reverse();
}

/**
 * One series, or null when the registry has no such id.
 *
 * Transport failures are thrown rather than folded into null: swallowing them meant a rate-limited
 * read rendered a hard 404 on a series that plainly exists, which is a worse lie than an error.
 */
export async function getSeatSeries(seriesId: number): Promise<SeatSeries | null> {
  if (!isSeatInfraConfigured()) return null;
  if (!Number.isInteger(seriesId) || seriesId < 0) return null;

  const row = await client.readContract({
    address: PONS_SEAT_DEPLOYMENT.registry as Address,
    abi: PONS_SEAT_SERIES_REGISTRY_ABI,
    functionName: 'series',
    args: [BigInt(seriesId)],
  });

  // An id past the end reads back as an empty struct rather than reverting.
  if (row[0] === ZERO_ADDRESS || row[2] === ZERO_ADDRESS) return null;

  return mapRow(seriesId, row);
}
