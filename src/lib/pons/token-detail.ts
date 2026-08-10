import { formatEther, type Address } from 'viem';

import { PONS_TOTAL_SUPPLY } from './constants';
import { fetchCreatorFees } from './creator-fees';
import { robinhoodPublicClient } from './client';
import { resolveLaunchedToken } from './factory';
import { readPoolMarketSnapshot } from './pricing';
import { fetchRecentPoolTrades, isToken0Ordering } from './trades';
import { resolveStickyGraduation } from './graduation-sticky';
import {
  readCreatorFeeRouting,
  readGraduationStatus,
  readTokenOnchainMetadata,
} from './token-state';
import type { TokenDetailResponse } from './types';
import { readV2CurveMarketSnapshot } from './v2-pricing';

export async function fetchTokenDetail(token: Address): Promise<TokenDetailResponse> {
  const [metadata, resolved] = await Promise.all([
    readTokenOnchainMetadata(token),
    resolveLaunchedToken(token),
  ]);

  const isToken0 = resolved?.launched.isToken0 ?? isToken0Ordering(token);
  const supplyWei =
    resolved?.launched.supply && resolved.launched.supply > 0n
      ? resolved.launched.supply
      : BigInt(PONS_TOTAL_SUPPLY);
  const factory = resolved?.factory ?? null;

  const isV2 = resolved?.kind === 'v2';
  const v2Curve =
    isV2 && resolved?.launched.curve ? resolved.launched.curve : null;

  const emptyMarket = {
    priceInWeth: 0,
    priceUsd: 0,
    marketCapUsd: 0,
    fdvUsd: 0,
    ethUsd: 0,
  };

  const [marketOrCurve, trades] = await Promise.all([
    v2Curve
      ? readV2CurveMarketSnapshot({
          curve: v2Curve,
          pairToken: resolved!.launched.pairedToken,
          supplyWei,
        }).catch(() => ({
          ...emptyMarket,
          progress: 0,
          graduated: false,
          priceInQuote: 0,
        }))
      : !isV2 && metadata.pool
        ? readPoolMarketSnapshot({
            pool: metadata.pool,
            isToken0,
            supplyWei,
          }).catch(() => emptyMarket)
        : Promise.resolve(emptyMarket),
    !isV2 && metadata.pool
      ? fetchRecentPoolTrades({
          pool: metadata.pool,
          token,
          isToken0,
          fromBlock: 0n,
          limit: 48,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const market = marketOrCurve;
  const rawGraduation =
    v2Curve && 'progress' in marketOrCurve
      ? {
          pairedPrincipal: 0n,
          threshold: 0n,
          graduated: Boolean(marketOrCurve.graduated),
          progress: marketOrCurve.progress,
        }
      : !isV2 && factory
        ? await readGraduationStatus(token, factory)
        : {
            pairedPrincipal: 0n,
            threshold: 0n,
            graduated: false,
            progress: 0,
          };

  const graduation = !isV2
    ? await resolveStickyGraduation({
        token,
        status: rawGraduation,
        pool: metadata.pool,
        checkPeak: true,
      })
    : rawGraduation;

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

  const feeRouting = isV2
    ? {
        protocolSharePercent: 0,
        creatorSharePercent: 100,
        feeRedirect: resolved?.launched.creatorFeeRecipient ?? null,
        creatorPayout:
          resolved?.launched.creatorFeeRecipient ?? deployerAddress,
      }
    : await readCreatorFeeRouting(
        token,
        deployerAddress,
        factory ?? undefined,
      ).catch(() => ({
        protocolSharePercent: 0,
        creatorSharePercent: 100,
        feeRedirect: null,
        creatorPayout: deployerAddress,
      }));

  const [creatorFees, locker] = await Promise.all([
    isV2 ? Promise.resolve(null) : fetchCreatorFees(token).catch(() => null),
    !isV2 && factory
      ? robinhoodPublicClient
          .readContract({
            address: factory,
            abi: [
              {
                type: 'function',
                name: 'locker',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'address' }],
              },
            ],
            functionName: 'locker',
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

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
      locker,
      creatorRewards: creatorFees
        ? {
            grossToken: creatorFees.grossToken,
            grossWeth: creatorFees.grossWeth,
            creatorToken: creatorFees.creatorToken,
            creatorWeth: creatorFees.creatorWeth,
            payoutAddress: creatorFees.payoutAddress,
            claimable: creatorFees.claimable,
            source: creatorFees.source,
          }
        : null,
    },
    trades: tradesWithUsd.map((trade) => ({
      ...trade,
      blockNumber: trade.blockNumber.toString(),
    })),
  };
}
