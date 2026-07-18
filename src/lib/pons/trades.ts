import { decodeEventLog, formatEther, parseAbiItem, type Address, type Hex } from 'viem';

import { robinhoodPublicClient } from './client';
import { PONS_WETH, UNISWAP_V3_SWAP_TOPIC0 } from './contracts';
import { priceInWethFromSqrtPriceX96 } from './pricing';

const SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);

export interface PoolTrade {
  transactionHash: Hex;
  blockNumber: bigint;
  timestamp: number;
  side: 'buy' | 'sell';
  ethAmount: number;
  tokenAmount: number;
  priceUsd: number | null;
  trader: Address;
}

export interface PricePoint {
  timestamp: number;
  priceInWeth: number;
  priceUsd: number | null;
}

function deriveTradeSide(
  amount0: bigint,
  amount1: bigint,
  isToken0: boolean,
): 'buy' | 'sell' {
  const pairSigned = isToken0 ? amount1 : amount0;
  return pairSigned > 0n ? 'buy' : 'sell';
}

export async function fetchRecentPoolTrades(params: {
  pool: Address;
  token: Address;
  isToken0: boolean;
  fromBlock: bigint;
  limit?: number;
  ethUsd?: number;
}): Promise<PoolTrade[]> {
  const latest = await robinhoodPublicClient.getBlockNumber();
  const window = 12_000n;
  const fromBlock = params.fromBlock > latest - window ? params.fromBlock : latest - window;

  const logs = await robinhoodPublicClient.getLogs({
    address: params.pool,
    event: SWAP_EVENT,
    fromBlock,
    toBlock: latest,
  });

  const recent = logs.slice(-(params.limit ?? 40)).reverse();
  const blockNumbers = [...new Set(recent.map((log) => log.blockNumber))];
  const blocks = await Promise.all(
    blockNumbers.map((blockNumber) =>
      robinhoodPublicClient.getBlock({ blockNumber }).then((block) => [blockNumber, block] as const),
    ),
  );
  const blockMap = new Map(blocks);

  return recent.map((log) => {
    const decoded = decodeEventLog({
      abi: [SWAP_EVENT],
      data: log.data,
      topics: log.topics,
    });

    const amount0 = decoded.args.amount0;
    const amount1 = decoded.args.amount1;
    const side = deriveTradeSide(amount0, amount1, params.isToken0);
    const ethRaw = params.isToken0 ? -amount1 : -amount0;
    const tokenRaw = params.isToken0 ? -amount0 : -amount1;
    const ethAmount = Math.abs(Number(formatEther(ethRaw > 0n ? ethRaw : -ethRaw)));
    const tokenAmount = Math.abs(Number(formatEther(tokenRaw > 0n ? tokenRaw : -tokenRaw)));
    const priceInWeth = priceInWethFromSqrtPriceX96(decoded.args.sqrtPriceX96, params.isToken0);
    const block = blockMap.get(log.blockNumber);

    return {
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp: Number(block?.timestamp ?? 0n) * 1000,
      side,
      ethAmount,
      tokenAmount,
      priceUsd: params.ethUsd ? priceInWeth * params.ethUsd : null,
      trader: decoded.args.sender,
    };
  });
}

export function tradesToPriceSeries(trades: PoolTrade[]): PricePoint[] {
  return [...trades]
    .reverse()
    .filter((trade) => trade.priceUsd != null && trade.timestamp > 0)
    .map((trade) => ({
      timestamp: trade.timestamp,
      priceInWeth: trade.ethAmount > 0 ? trade.ethAmount / Math.max(trade.tokenAmount, 1e-18) : 0,
      priceUsd: trade.priceUsd,
    }));
}

export function isToken0Ordering(token: Address, pairToken: Address = PONS_WETH): boolean {
  return token.toLowerCase() < pairToken.toLowerCase();
}
