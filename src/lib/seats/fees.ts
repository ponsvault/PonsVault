import { formatEther, parseEther, type Address } from 'viem';

import { resolveLaunchedToken } from '@/lib/pons/factory';
import { readV2CurveMarketSnapshot } from '@/lib/pons/v2-pricing';

/**
 * The ETH cut a seat trade pays, which is the whole reward engine: every wei of it goes to the
 * booster pot and back out to activated seats, with no protocol share taken on the way.
 *
 * These are the same rates the shop contract enforces, and the same ones StonkBrokers' Anvil AMM
 * charges on a broker trade.
 */
export const SEAT_FEE_BPS = { buy: 1000, sell: 1000, snipe: 1500 } as const;

export type SeatTrade = keyof typeof SEAT_FEE_BPS;

/**
 * The notional the contract falls back on.
 *
 * A percentage fee needs to know what the seat is worth, and a contract cannot: the price is in
 * fuel, and what fuel is worth lives on a curve it has no handle on. So it assumes a 0.01 ETH seat
 * and enforces the percentage of that as a floor. Reading 0.01 as the fee itself — rather than as
 * the notional the fee is a percentage of — charges ten times too much.
 */
const FLOOR_NOTIONAL = parseEther('0.01');

/**
 * Hard ceiling on a single trade fee.
 *
 * A backstop against a broken quote rather than part of the pricing, so it sits far above anything
 * the model should ever produce: a seat has to be worth 5 ETH before the percentage reaches it.
 */
const MAX_TRADE_FEE = parseEther('0.5');

export function seatFeeFloor(trade: SeatTrade): bigint {
  return (BigInt(SEAT_FEE_BPS[trade]) * FLOOR_NOTIONAL) / 10_000n;
}

/** Taking a loan against a seat costs what buying one does; it is the same size of favour. */
export const SEAT_LOAN_FEE_BPS = 1000;

/**
 * The ETH a loan has to carry, fixed at creation because the vault cannot price a seat either.
 *
 * Same shape as a trade fee: a percentage of the fallback notional, not the notional itself.
 */
export function seatLoanFeeFloor(): bigint {
  return (BigInt(SEAT_LOAN_FEE_BPS) * FLOOR_NOTIONAL) / 10_000n;
}

export interface SeatTradeFees {
  buy: bigint;
  sell: bigint;
  snipe: bigint;
  /** What one seat is worth in ETH, or null when nothing could be quoted. */
  seatValueEth: bigint | null;
}

const FLOOR_ONLY: SeatTradeFees = {
  buy: seatFeeFloor('buy'),
  sell: seatFeeFloor('sell'),
  snipe: seatFeeFloor('snipe'),
  seatValueEth: null,
};

/** Quotes carry 18 decimals of noise, and a fee is something a person reads before signing it. */
const ROUNDING = 10n ** 12n;

function feeFor(trade: SeatTrade, seatValueEth: bigint): bigint {
  const floor = seatFeeFloor(trade);
  const exact = (seatValueEth * BigInt(SEAT_FEE_BPS[trade])) / 10_000n;
  const proportional = ((exact + ROUNDING - 1n) / ROUNDING) * ROUNDING;
  if (proportional <= floor) return floor;
  return proportional > MAX_TRADE_FEE ? MAX_TRADE_FEE : proportional;
}

/**
 * Prices a seat through its fuel curve and turns that into the ETH each trade should carry.
 *
 * Falls back to the contract's floor whenever the seat cannot be priced — an unlaunched or
 * graduated fuel token, an unreachable curve, a nonsense number — because the floor is the only
 * amount that is certain to be accepted.
 */
export async function readSeatTradeFees(
  fuelToken: Address,
  seatPrice: bigint,
): Promise<SeatTradeFees> {
  if (seatPrice <= 0n) return FLOOR_ONLY;

  try {
    const launch = await resolveLaunchedToken(fuelToken);
    const curve = launch?.launched.curve;
    if (!curve) return FLOOR_ONLY;

    const snapshot = await readV2CurveMarketSnapshot({
      curve,
      pairToken: launch.launched.pairedToken,
      supplyWei: 0n,
    });

    const seatValue = Number(formatEther(seatPrice)) * snapshot.priceInWeth;
    if (!Number.isFinite(seatValue) || seatValue <= 0 || seatValue > 1_000_000) return FLOOR_ONLY;

    const seatValueEth = parseEther(seatValue.toFixed(18));
    return {
      buy: feeFor('buy', seatValueEth),
      sell: feeFor('sell', seatValueEth),
      snipe: feeFor('snipe', seatValueEth),
      seatValueEth,
    };
  } catch {
    return FLOOR_ONLY;
  }
}
