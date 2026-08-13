import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

import { PONS_DEFAULT_CONFIG_ID } from '@/lib/pons/constants';
import { PONS_V2, PONS_V2_PAIR_TOKENS, findV2PairToken } from '@/lib/pons/v2-deployments';
import { PONS_V2_FACTORY_LAUNCH_ABI, randomLaunchSalt } from '@/lib/pons/v2-vault';

import { PONS_SEAT_LAUNCHER_ABI, PONS_SEAT_SERIES_FACTORY_ABI } from './abis';
import { buildCreateSeriesArgs, type SeatSeriesDraft } from './create-series';
import { PONS_SEAT_DEPLOYMENT } from './deployments';

export const CURVE_BUY_ABI = parseAbi([
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) returns (uint256)',
]);

export const PONS_LAUNCH_FEE_ABI = parseAbi([
  'function launchFee() view returns (uint256)',
]);

/**
 * What a fuel launch can be priced in.
 *
 * Native ETH is the factory's own path — it is deliberately not in `approvedPairTokens`, which only
 * gates ERC-20 pairs, so a `false` reading there does not mean ETH is closed. Verified against the
 * live factory by `npm run seats:check-batch`.
 */
export const FUEL_PAIR_OPTIONS = [
  { symbol: 'ETH', name: 'Native ETH', address: zeroAddress, decimals: 18 },
  ...PONS_V2_PAIR_TOKENS,
] as const;

export type FuelPairOption = (typeof FUEL_PAIR_OPTIONS)[number];

export function findFuelPair(address: string): FuelPairOption | undefined {
  const needle = address.trim().toLowerCase();
  return FUEL_PAIR_OPTIONS.find((option) => option.address.toLowerCase() === needle);
}

/** One leg of a batch. Shaped for viem's `sendCalls`, which also accepts a lone call. */
export type SeriesCall = { to: Address; data: Hex; value?: bigint };

export type FuelBackedSeriesPlan = {
  /** Address the fuel token will have once the batch runs. */
  fuelToken: Address;
  /** Bonding curve buyers get their fuel from. */
  curve: Address;
  pairToken: Address;
  launchFeeWei: bigint;
  calls: SeriesCall[];
};

export type FuelLaunchInput = {
  /** Wallet sending the batch. Becomes the token's on-chain deployer and fee recipient. */
  creator: Address;
  series: Omit<SeatSeriesDraft, 'fuelToken' | 'loanSeed' | 'protocolTreasury'> & {
    protocolTreasury?: Address;
  };
  fuel: {
    /** Asset the curve prices fuel in. The zero address means native ETH. */
    pairToken: Address;
    logo: string;
    description: string;
    /** Pair-asset amount to spend on fuel in the same batch. Zero skips the buy. */
    firstBuy: bigint;
  };
  /** Fixing the salt makes the predicted address reproducible; omit for a fresh one. */
  salt?: Hex;
};

/**
 * Plans a fuel launch and the series that runs on it as one batch.
 *
 * `createSeries` needs the fuel token's address, which normally only exists once `launchToken` has
 * run — and a batch cannot read an earlier call's return value. The address comes from simulating
 * the launch instead: the pons deployer derives it from the launch params, so the same params
 * always produce the same address. The simulation therefore has to use the exact params and sender
 * the batch will use, which is why both are built here rather than by the caller.
 */
export async function planFuelBackedSeries(
  client: PublicClient,
  input: FuelLaunchInput,
): Promise<FuelBackedSeriesPlan> {
  // Native ETH is its own path on the factory rather than an entry in `approvedPairTokens`.
  const nativePair = input.fuel.pairToken === zeroAddress;
  if (!nativePair && !findV2PairToken(input.fuel.pairToken)) {
    throw new Error('That pairing asset is not approved on pons v2.');
  }

  const factory = getAddress(PONS_V2.factory);
  const pairToken = nativePair ? zeroAddress : getAddress(input.fuel.pairToken);
  const creator = getAddress(input.creator);

  const [launchFeeWei, expectedEconomics] = await Promise.all([
    client.readContract({ address: factory, abi: PONS_LAUNCH_FEE_ABI, functionName: 'launchFee' }),
    client.readContract({
      address: factory,
      abi: PONS_V2_FACTORY_LAUNCH_ABI,
      functionName: 'previewLaunchEconomics',
      args: [PONS_DEFAULT_CONFIG_ID, pairToken],
    }),
  ]);

  const tokenParams = {
    name: input.series.tokenName,
    symbol: input.series.tokenSymbol,
    logo: input.fuel.logo,
    description: input.fuel.description,
    socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
    creatorFeeRecipient: creator,
    creatorTaxBps: 0,
    buybackEnabled: false,
    expectedEconomics,
    salt: input.salt ?? randomLaunchSalt(),
  } as const;
  const launchArgs = [tokenParams, PONS_DEFAULT_CONFIG_ID, pairToken] as const;

  const { result } = await client.simulateContract({
    address: factory,
    abi: PONS_V2_FACTORY_LAUNCH_ABI,
    functionName: 'launchToken',
    args: launchArgs,
    account: creator,
    value: launchFeeWei,
  });
  const [fuelToken, curve] = result;

  const calls: SeriesCall[] = [
    {
      to: factory,
      value: launchFeeWei,
      data: encodeFunctionData({
        abi: PONS_V2_FACTORY_LAUNCH_ABI,
        functionName: 'launchToken',
        args: launchArgs,
      }),
    },
  ];

  if (input.fuel.firstBuy > 0n) {
    // An ETH curve takes the quote as transaction value; an ERC-20 one has to be approved first.
    if (!nativePair) {
      calls.push({
        to: pairToken,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [curve, input.fuel.firstBuy],
        }),
      });
    }
    calls.push({
      to: curve,
      value: nativePair ? input.fuel.firstBuy : undefined,
      data: encodeFunctionData({
        abi: CURVE_BUY_ABI,
        functionName: 'buy',
        args: [input.fuel.firstBuy, 0n, creator],
      }),
    });
  }

  calls.push(buildSeriesCall({ ...input.series, fuelToken }));

  return { fuelToken, curve, pairToken, launchFeeWei, calls };
}

/**
 * Plans the whole launch as a single call to {@link PONS_SEAT_DEPLOYMENT.launcher}.
 *
 * The launcher runs the fuel launch, the first buy and `createSeries` inside one transaction, so it
 * is one wallet confirmation on every wallet rather than one per call on wallets that cannot batch.
 * It also removes the need to predict the fuel address: the contract passes the real one straight
 * into the series it creates.
 *
 * ERC-20 pairs still need their approval first, since the launcher pulls the pair asset from the
 * creator. Native ETH — the default — arrives as transaction value and needs nothing.
 */
export async function planLaunchedSeries(
  client: PublicClient,
  input: FuelLaunchInput,
): Promise<FuelBackedSeriesPlan> {
  const nativePair = input.fuel.pairToken === zeroAddress;
  if (!nativePair && !findV2PairToken(input.fuel.pairToken)) {
    throw new Error('That pairing asset is not approved on pons v2.');
  }

  const launcher = getAddress(PONS_SEAT_DEPLOYMENT.launcher);
  const pairToken = nativePair ? zeroAddress : getAddress(input.fuel.pairToken);
  const creator = getAddress(input.creator);

  const launchFeeWei = await client.readContract({
    address: getAddress(PONS_V2.factory),
    abi: PONS_LAUNCH_FEE_ABI,
    functionName: 'launchFee',
  });

  const tokenParams = {
    name: input.series.tokenName,
    symbol: input.series.tokenSymbol,
    logo: input.fuel.logo,
    description: input.fuel.description,
    socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
    // Overwritten by the launcher with the caller, so the creator keeps the fuel token's fees.
    creatorFeeRecipient: creator,
    creatorTaxBps: 0,
    buybackEnabled: false,
    // Both pinned on-chain: economics against a fresh read, the salt namespaced to the caller.
    expectedEconomics: '0x0000000000000000000000000000000000000000000000000000000000000000',
    salt: input.salt ?? randomLaunchSalt(),
  } as const;

  const treasury =
    (input.series.protocolTreasury as Address | undefined) ??
    (getAddress(PONS_SEAT_DEPLOYMENT.protocolTreasury) as Address);

  const calls: SeriesCall[] = [];
  if (!nativePair && input.fuel.firstBuy > 0n) {
    calls.push({
      to: pairToken,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [launcher, input.fuel.firstBuy],
      }),
    });
  }

  calls.push({
    to: launcher,
    value: launchFeeWei + (nativePair ? input.fuel.firstBuy : 0n),
    data: encodeFunctionData({
      abi: PONS_SEAT_LAUNCHER_ABI,
      functionName: 'launchSeries',
      args: [
        tokenParams,
        PONS_DEFAULT_CONFIG_ID,
        pairToken,
        input.fuel.firstBuy,
        0n,
        buildCreateSeriesArgs({ ...input.series, protocolTreasury: treasury }),
      ],
    }),
  });

  // Only known once the call runs, and no longer needed up front: the launcher hands the real
  // addresses to the series itself.
  return { fuelToken: zeroAddress, curve: zeroAddress, pairToken, launchFeeWei, calls };
}

/**
 * The `createSeries` leg on its own: for a series that mints its own fuel, or one pointed at a token
 * that already exists — a retry after a partly finished batch, or fuel launched some other day.
 */
export function buildSeriesCall(
  series: FuelLaunchInput['series'] & { fuelToken?: Address; loanSeed?: bigint },
): SeriesCall {
  const treasury =
    (series.protocolTreasury as Address | undefined) ??
    (getAddress(PONS_SEAT_DEPLOYMENT.protocolTreasury) as Address);

  return {
    to: getAddress(PONS_SEAT_DEPLOYMENT.factory),
    data: encodeFunctionData({
      abi: PONS_SEAT_SERIES_FACTORY_ABI,
      functionName: 'createSeries',
      args: [buildCreateSeriesArgs({ ...series, protocolTreasury: treasury })],
    }),
  };
}
