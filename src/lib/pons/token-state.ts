import { parseAbi, zeroAddress, type Address } from 'viem';

import { PONS_ACTIVE_FACTORY } from './contracts';
import { robinhoodPublicClient } from './client';
import { PONS_V2 } from './v2-deployments';

export const PONS_TOKEN_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function logo() view returns (string)',
  'function description() view returns (string)',
  'function liquidityPool() view returns (address)',
  'function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)',
  'function deployer() view returns (address)',
  'function pairedToken() view returns (address)',
  'function poolFee() view returns (uint24)',
]);

export const PONS_FACTORY_VIEWS_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount) launched)',
  'function graduationStatus(address token) view returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)',
  'function locker() view returns (address)',
]);

export const PONS_LOCKER_ABI = parseAbi([
  'function tokenProtocolFeeShares(address token) view returns (uint256)',
  'function feeRedirects(address token) view returns (address)',
  'function protocolFeeRecipient() view returns (address)',
  'function collectFees(address token) returns (uint256 amount0, uint256 amount1)',
  'function setFeeRedirect(address token, address newFeeWallet)',
]);

export interface TokenOnchainMetadata {
  name: string;
  symbol: string;
  decimals: number;
  logo: string;
  description: string;
  pool: Address;
  socials: {
    twitter: string;
    telegram: string;
    discord: string;
    website: string;
    farcaster: string;
  };
}

export interface GraduationStatus {
  pairedPrincipal: bigint;
  threshold: bigint;
  graduated: boolean;
  progress: number;
}

export interface CreatorFeeRouting {
  protocolSharePercent: number;
  creatorSharePercent: number;
  feeRedirect: Address | null;
  creatorPayout: Address;
}

const V2_LAUNCH_LOOKUP_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists) launched)',
]);

/**
 * Uniswap pool for v1 tokens, bonding curve for v2 pre-graduation.
 *
 * v2 tokens do not implement `liquidityPool()` — calling it reverts and used
 * to take down every token page. Resolve through the factory instead.
 */
async function readTokenPool(token: Address): Promise<Address> {
  try {
    return await robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'liquidityPool',
    });
  } catch {
    try {
      const v2 = await robinhoodPublicClient.readContract({
        address: PONS_V2.factory as Address,
        abi: V2_LAUNCH_LOOKUP_ABI,
        functionName: 'getLaunchedToken',
        args: [token],
      });
      if (v2.exists && v2.curve !== zeroAddress) return v2.curve;
    } catch {
      // Not a v2 launch either.
    }
    return zeroAddress;
  }
}

export async function readTokenOnchainMetadata(
  token: Address,
): Promise<TokenOnchainMetadata> {
  const [name, symbol, decimals, logo, description, pool, socials] = await Promise.all([
    robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'name',
    }),
    robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'symbol',
    }),
    robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'decimals',
    }),
    robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'logo',
    }),
    robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'description',
    }),
    readTokenPool(token),
    robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'socials',
    }),
  ]);

  return {
    name,
    symbol,
    decimals,
    logo,
    description,
    pool,
    socials: {
      twitter: socials[0],
      telegram: socials[1],
      discord: socials[2],
      website: socials[3],
      farcaster: socials[4],
    },
  };
}

export async function readGraduationStatus(
  token: Address,
  factory: Address = PONS_ACTIVE_FACTORY,
): Promise<GraduationStatus> {
  const [pairedPrincipal, threshold, graduated] = await robinhoodPublicClient.readContract({
    address: factory,
    abi: PONS_FACTORY_VIEWS_ABI,
    functionName: 'graduationStatus',
    args: [token],
  });

  const progress =
    threshold > 0n ? Number(pairedPrincipal) / Number(threshold) : 0;

  return {
    pairedPrincipal,
    threshold,
    graduated,
    progress: Math.min(progress, 1),
  };
}

/** Creator payout = feeRedirects(token) when set, otherwise deployer. */
export async function readCreatorFeeRouting(
  token: Address,
  deployer: Address,
  factory: Address = PONS_ACTIVE_FACTORY,
): Promise<CreatorFeeRouting> {
  const locker = await robinhoodPublicClient.readContract({
    address: factory,
    abi: PONS_FACTORY_VIEWS_ABI,
    functionName: 'locker',
  });

  const [protocolShare, redirect] = await Promise.all([
    robinhoodPublicClient.readContract({
      address: locker,
      abi: PONS_LOCKER_ABI,
      functionName: 'tokenProtocolFeeShares',
      args: [token],
    }),
    robinhoodPublicClient.readContract({
      address: locker,
      abi: PONS_LOCKER_ABI,
      functionName: 'feeRedirects',
      args: [token],
    }),
  ]);

  const protocolSharePercent = Number(protocolShare);
  const creatorSharePercent = 100 - protocolSharePercent;
  const feeRedirect = redirect === zeroAddress ? null : redirect;
  const creatorPayout = feeRedirect ?? deployer;

  return {
    protocolSharePercent,
    creatorSharePercent,
    feeRedirect,
    creatorPayout,
  };
}
