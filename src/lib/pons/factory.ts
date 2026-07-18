import type { Address } from 'viem';

import {
  PONS_ACTIVE_FACTORY,
  PONS_LEGACY_FACTORY,
} from './contracts';
import { robinhoodPublicClient } from './client';
import { PONS_FACTORY_VIEWS_ABI } from './token-state';

export type LaunchFactoryKind = 'active' | 'legacy';

export interface ResolvedLaunch {
  factory: Address;
  kind: LaunchFactoryKind;
  launched: {
    token: Address;
    deployer: Address;
    pairedToken: Address;
    positionManager: Address;
    positionId: bigint;
    dexId: bigint;
    launchConfigId: bigint;
    restrictionsEndBlock: bigint;
    supply: bigint;
    isToken0: boolean;
    poolFee: number;
    exists: boolean;
    initialBuyAmount: bigint;
  };
}

export async function resolveLaunchedToken(token: Address): Promise<ResolvedLaunch | null> {
  for (const [factory, kind] of [
    [PONS_ACTIVE_FACTORY, 'active'],
    [PONS_LEGACY_FACTORY, 'legacy'],
  ] as const) {
    const launched = await robinhoodPublicClient.readContract({
      address: factory,
      abi: PONS_FACTORY_VIEWS_ABI,
      functionName: 'getLaunchedToken',
      args: [token],
    });

    if (launched.exists) {
      return { factory, kind, launched };
    }
  }

  return null;
}
