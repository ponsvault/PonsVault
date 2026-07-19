import type { Address } from 'viem';

import { PONS_TOTAL_SUPPLY } from './constants';
import { resolveLaunchedToken } from './factory';
import { readPoolMarketSnapshot } from './pricing';
import { readGraduationStatus, readTokenOnchainMetadata } from './token-state';
import { isToken0Ordering } from './trades';
import type { PonsLaunchRecord } from './types';

export async function enrichLaunchRecord(
  launch: Pick<
    PonsLaunchRecord,
    'token' | 'name' | 'symbol' | 'description' | 'logo' | 'deployer' | 'launchedAt' | 'transactionHash'
  >,
): Promise<PonsLaunchRecord> {
  const token = launch.token as Address;

  try {
    const [metadata, resolved] = await Promise.all([
      readTokenOnchainMetadata(token),
      resolveLaunchedToken(token),
    ]);

    const isToken0 = resolved?.launched.isToken0 ?? isToken0Ordering(token);
    const supplyWei = resolved?.launched.supply ?? BigInt(PONS_TOTAL_SUPPLY);
    const factory = resolved?.factory;

    const [market, graduation] = await Promise.all([
      readPoolMarketSnapshot({
        pool: metadata.pool,
        isToken0,
        supplyWei,
      }),
      factory ? readGraduationStatus(token, factory) : readGraduationStatus(token),
    ]);

    return {
      ...launch,
      pool: metadata.pool,
      marketCapUsd: market.marketCapUsd,
      priceUsd: market.priceUsd,
      graduated: graduation.graduated,
      graduationProgressPct: Math.min(graduation.progress * 100, 100),
    };
  } catch {
    return {
      ...launch,
      pool: '',
      marketCapUsd: null,
      priceUsd: null,
      graduated: false,
      graduationProgressPct: null,
    };
  }
}

export async function enrichLaunchRecords(
  launches: Array<
    Pick<
      PonsLaunchRecord,
      'token' | 'name' | 'symbol' | 'description' | 'logo' | 'deployer' | 'launchedAt' | 'transactionHash'
    >
  >,
): Promise<PonsLaunchRecord[]> {
  return Promise.all(launches.map((launch) => enrichLaunchRecord(launch)));
}
