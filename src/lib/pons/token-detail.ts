import { formatEther, type Address } from 'viem';

import { PONS_TOTAL_SUPPLY } from './constants';
import { robinhoodPublicClient } from './client';
import { resolveLaunchedToken } from './factory';
import { readPoolMarketSnapshot } from './pricing';
import { fetchRecentPoolTrades, isToken0Ordering } from './trades';
import {
  readCreatorFeeRouting,
  readGraduationStatus,
  readTokenOnchainMetadata,
} from './token-state';
import type { TokenDetailResponse } from './types';

export async function fetchTokenDetail(token: Address): Promise<TokenDetailResponse> {
  const [metadata, resolved] = await Promise.all([
    readTokenOnchainMetadata(token),
    resolveLaunchedToken(token),
  ]);

  const isToken0 = resolved?.launched.isToken0 ?? isToken0Ordering(token);
  const supplyWei = resolved?.launched.supply ?? BigInt(PONS_TOTAL_SUPPLY);
  const factory = resolved?.factory ?? null;

  const [market, graduation, trades] = await Promise.all([
    readPoolMarketSnapshot({
      pool: metadata.pool,
      isToken0,
      supplyWei,
    }),
    factory
      ? readGraduationStatus(token, factory)
      : readGraduationStatus(token),
    fetchRecentPoolTrades({
      pool: metadata.pool,
      token,
      isToken0,
      fromBlock: 0n,
      limit: 48,
    }).catch(() => []),
  ]);

  const tradesWithUsd = trades.map((trade) => ({
    ...trade,
    priceUsd: trade.priceUsd ?? market.priceUsd,
  }));

  const deployerAddress =
    resolved?.launched.deployer ??
    (await robinhoodPublicClient.readContract({
      address: token,
      abi: [
        {
          type: 'function',
          name: 'deployer',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'address' }],
        },
      ],
      functionName: 'deployer',
    }));

  const feeRouting = await readCreatorFeeRouting(
    token,
    deployerAddress,
    factory ?? undefined,
  ).catch(() => ({
    protocolSharePercent: 0,
    creatorSharePercent: 100,
    feeRedirect: null,
    creatorPayout: deployerAddress,
  }));

  return {
    token,
    metadata,
    launch: resolved
      ? {
          factory: resolved.factory,
          factoryKind: resolved.kind,
          deployer: resolved.launched.deployer,
          pairedToken: resolved.launched.pairedToken,
          isToken0: resolved.launched.isToken0,
          poolFee: resolved.launched.poolFee,
          supply: resolved.launched.supply.toString(),
          restrictionsEndBlock: resolved.launched.restrictionsEndBlock.toString(),
          initialBuyAmount: resolved.launched.initialBuyAmount.toString(),
          initialBuyEth: formatEther(resolved.launched.initialBuyAmount),
        }
      : null,
    market: {
      priceInWeth: market.priceInWeth,
      priceUsd: market.priceUsd,
      marketCapUsd: market.marketCapUsd,
      fdvUsd: market.fdvUsd,
      ethUsd: market.ethUsd,
    },
    graduation: {
      pairedPrincipal: graduation.pairedPrincipal.toString(),
      pairedPrincipalEth: formatEther(graduation.pairedPrincipal),
      threshold: graduation.threshold.toString(),
      thresholdEth: formatEther(graduation.threshold),
      graduated: graduation.graduated,
      progress: graduation.progress,
    },
    fees: {
      protocolSharePercent: feeRouting.protocolSharePercent,
      creatorSharePercent: feeRouting.creatorSharePercent,
      feeRedirect: feeRouting.feeRedirect,
      creatorPayout: feeRouting.creatorPayout,
    },
    trades: tradesWithUsd.map((trade) => ({
      ...trade,
      blockNumber: trade.blockNumber.toString(),
    })),
  };
}
