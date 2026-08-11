import { formatUnits, parseAbi, type Address } from 'viem';

import { robinhoodPublicClient } from './client';
import { findV2PairToken } from './v2-deployments';

/**
 * Chainlink tokenized-equity feeds on Robinhood Chain (4663).
 *
 * Proxies from https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
 * Prefer these over the Robinhood REST API — Vercel often cannot reach api.robinhood.com,
 * which left Explore market caps at $0 for every equity-paired v2 launch.
 */
const CHAINLINK_EQUITY_USD: Record<string, Address> = {
  AAPL: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0',
  NVDA: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15',
  TSLA: '0x4A1166a659A55625345e9515b32adECea5547C38',
  GOOGL: '0xF6f373a037c30F0e5010d854385cA89185AE638b',
  GME: '0x27C71df6A64fB476468EdF256CF72c038baB5B67',
  SPY: '0x319724394D3A0e3669269846abE664Cd621f9f6A',
  SPCX: '0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb',
  AMD: '0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72',
  SNDK: '0xfb133Fa4B7b385802B693a293606682Df47109A3',
};

const AGGREGATOR_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
]);

const priceCache = new Map<string, { usd: number; at: number }>();
const CACHE_TTL_MS = 60_000;

/** USD per 1 whole unit of a v2 pair / RWA equity token. */
export async function fetchEquityTokenUsd(pairToken: Address): Promise<number> {
  const pair = findV2PairToken(pairToken);
  if (!pair) return 0;
  if (pair.symbol === 'USDG') return 1;

  const cached = priceCache.get(pair.symbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.usd;

  const fromChain = await readChainlinkUsd(pair.symbol);
  if (fromChain > 0) {
    priceCache.set(pair.symbol, { usd: fromChain, at: Date.now() });
    return fromChain;
  }

  const fromApi = await fetchRobinhoodRestUsd(pair.symbol);
  if (fromApi > 0) {
    priceCache.set(pair.symbol, { usd: fromApi, at: Date.now() });
    return fromApi;
  }

  return 0;
}

/** Warm the cache for many launches so Explore does one RPC per symbol. */
export async function prefetchEquityTokenUsd(pairTokens: Address[]): Promise<void> {
  const unique = new Map<string, Address>();
  for (const token of pairTokens) {
    const pair = findV2PairToken(token);
    if (!pair || pair.symbol === 'USDG') continue;
    unique.set(pair.symbol, token);
  }
  await Promise.all([...unique.values()].map((token) => fetchEquityTokenUsd(token)));
}

async function readChainlinkUsd(symbol: string): Promise<number> {
  const feed = CHAINLINK_EQUITY_USD[symbol.toUpperCase()];
  if (!feed) return 0;

  try {
    const [round, decimals] = await Promise.all([
      robinhoodPublicClient.readContract({
        address: feed,
        abi: AGGREGATOR_ABI,
        functionName: 'latestRoundData',
      }),
      robinhoodPublicClient.readContract({
        address: feed,
        abi: AGGREGATOR_ABI,
        functionName: 'decimals',
      }),
    ]);
    const answer = round[1];
    if (answer <= 0n) return 0;
    return Number(formatUnits(answer, decimals));
  } catch {
    return 0;
  }
}

async function fetchRobinhoodRestUsd(symbol: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      quotes?: Array<{ bid?: string; ask?: string }>;
    };
    const quote = data.quotes?.[0];
    const bid = Number(quote?.bid);
    const ask = Number(quote?.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
      return (bid + ask) / 2;
    }
    if (Number.isFinite(bid) && bid > 0) return bid;
    if (Number.isFinite(ask) && ask > 0) return ask;
    return 0;
  } catch {
    return 0;
  }
}
