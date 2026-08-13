import { parseEther, zeroAddress, type Address } from 'viem';

import { seatLoanFeeFloor } from './fees';

/**
 * Fuel a seat pays to activate at each tier, and the pull that tier gets when a reward round is
 * split. Weights are relative, so the top tier draws twice what the bottom one does.
 */
export const SEAT_ACTIVATION_FEES = [
  parseEther('66666'),
  parseEther('166666'),
  parseEther('666666'),
] as const;
export const SEAT_ACTIVATION_WEIGHTS = [10_000n, 12_500n, 20_000n] as const;

/** No commitment: the series ships with its art already visible. */
export const EMPTY_PROVENANCE = `0x${'0'.repeat(64)}` as const;

export const SEAT_SWAP_FEE_BPS = 1000;
export const SEAT_SNIPE_FEE_BPS = 1500;
export const SEAT_ROYALTY_BPS = 333;
export const SEAT_DISTRIBUTE_THRESHOLD = parseEther('0.05');
export const SEAT_LOAN_TERM_SECONDS = BigInt(7 * 24 * 60 * 60);
export const SEAT_LOAN_MIN_ETH_FEE = seatLoanFeeFloor();

export type SeatSeriesDraft = {
  name: string;
  symbol: string;
  tokenName: string;
  tokenSymbol: string;
  /**
   * IPFS folder holding one metadata file per seat, or the sealed card every seat shows while the
   * series sells blind. Which one it is depends on {@link provenanceHash}.
   */
  baseTokenURI: string;
  /**
   * keccak256 of the real base URI, for a series that sells its art sealed.
   *
   * Leave it out and the pack is public from the first sale, which is fine for a one-image series
   * but lets a buyer of a varied pack look up which seat holds the rarest piece and snipe it.
   */
  provenanceHash?: `0x${string}`;
  maxSupply: bigint;
  seatPrice: bigint;
  protocolTreasury: Address;
  /**
   * An ERC-20 the series should run on, or the zero address to mint a fresh companion token.
   *
   * A minted token lands entirely in the creator's wallet, so nobody can buy a seat until the
   * creator hands fuel out. Pointing at a token that already trades gives buyers a market instead.
   */
  fuelToken?: Address;
  /** Fuel pulled from the creator to stock the loan book. Only used with an existing fuel token. */
  loanSeed?: bigint;
  /**
   * ETH a reward round must reach before it can be opened. Defaults to
   * {@link SEAT_DISTRIBUTE_THRESHOLD}; a test series can lower it so the payout loop is reachable
   * without waiting for real volume.
   */
  distributeThreshold?: bigint;
};

/**
 * Builds the single struct `PonsSeatSeriesFactory.createSeries` takes.
 *
 * Everything a creator does not choose is fixed here so the two places that launch a series — the
 * seats desk and the launch page's seat template — cannot drift apart.
 */
export function buildCreateSeriesArgs(draft: SeatSeriesDraft) {
  const fuelToken = draft.fuelToken ?? zeroAddress;
  const mintsOwnFuel = fuelToken === zeroAddress;
  const sealed = Boolean(draft.provenanceHash && draft.provenanceHash !== EMPTY_PROVENANCE);

  return {
    name: draft.name,
    symbol: draft.symbol,
    tokenName: draft.tokenName,
    tokenSymbol: draft.tokenSymbol,
    // A sealed series points every seat at one file, so it must not be given a trailing slash.
    baseTokenURI: sealed || draft.baseTokenURI.endsWith('/') ? draft.baseTokenURI : `${draft.baseTokenURI}/`,
    provenanceHash: draft.provenanceHash ?? EMPTY_PROVENANCE,
    maxSupply: draft.maxSupply,
    // A series running on someone else's token mints nothing, so the factory ignores this.
    tokenSupply: mintsOwnFuel ? draft.seatPrice * draft.maxSupply * 3n : 0n,
    seatPrice: draft.seatPrice,
    swapFeeBps: SEAT_SWAP_FEE_BPS,
    snipeFeeBps: SEAT_SNIPE_FEE_BPS,
    royaltyBps: SEAT_ROYALTY_BPS,
    distributeThreshold: draft.distributeThreshold ?? SEAT_DISTRIBUTE_THRESHOLD,
    protocolTreasury: draft.protocolTreasury,
    activationFees: [...SEAT_ACTIVATION_FEES],
    activationWeights: [...SEAT_ACTIVATION_WEIGHTS],
    loanTermSeconds: SEAT_LOAN_TERM_SECONDS,
    loanMinEthFee: SEAT_LOAN_MIN_ETH_FEE,
    fuelToken,
    loanSeed: mintsOwnFuel ? 0n : (draft.loanSeed ?? 0n),
  } as const;
}
