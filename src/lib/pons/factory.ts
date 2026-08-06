import { parseAbi, type Address } from 'viem';

import {
  PONS_ACTIVE_FACTORY,
  PONS_LEGACY_FACTORY,
} from './contracts';
import { robinhoodPublicClient } from './client';
import { PONS_FACTORY_VIEWS_ABI } from './token-state';
import { PONS_V2 } from './v2-deployments';

export type LaunchFactoryKind = 'active' | 'legacy' | 'v2';

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
    /** v2 only — escrow fee recipient after launch (typically the vault). */
    creatorFeeRecipient?: Address;
    curve?: Address;
  };
}

const V2_FACTORY_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists) launched)',
]);

const ZERO = '0x0000000000000000000000000000000000000000' as const;

export async function resolveLaunchedToken(token: Address): Promise<ResolvedLaunch | null> {
  // Prefer the current v2 factory — new launches land here.
  try {
    const v2 = await robinhoodPublicClient.readContract({
      address: PONS_V2.factory as Address,
      abi: V2_FACTORY_ABI,
      functionName: 'getLaunchedToken',
      args: [token],
    });

    if (v2.exists) {
      return {
        factory: PONS_V2.factory as Address,
        kind: 'v2',
        launched: {
          token: v2.token,
          deployer: v2.deployer,
          pairedToken: v2.pairToken,
          positionManager: ZERO,
          positionId: 0n,
          dexId: 0n,
          launchConfigId: 0n,
          restrictionsEndBlock: 0n,
          supply: 0n,
          isToken0: false,
          poolFee: Number(v2.poolFee),
          exists: true,
          initialBuyAmount: 0n,
          creatorFeeRecipient: v2.creatorFeeRecipient,
          curve: v2.curve,
        },
      };
    }
  } catch {
    // Fall through to v1 factories.
  }

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
