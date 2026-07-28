import type { Address, Hex } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONS_TOKEN_ABI } from '@/lib/pons/token-state';

import { PONS_RWA_VAULT_ABI } from './abi';
import { allocatePro, snapshotHolders } from './holders';
import { buildAllocation, type MerkleClaim } from './merkle';

/**
 * Who is owed what from one round, rebuilt from the chain.
 *
 * Derived rather than stored, and that is the point. Every input is fixed and
 * public — the round's `total` and `snapshotBlock` are written on-chain when it
 * opens, and the balances at that block are just the token's transfer history —
 * so anyone can run this and get the same root the keeper posted. A stored
 * allocation would have to be trusted; this one can be checked.
 *
 * It also means the keeper holds no state worth losing. A round whose root
 * never got posted can be picked up later by any process, and the answer will
 * be identical.
 */
export interface RoundAllocation {
  roundId: number;
  /** The root this allocation implies, whether or not it has been posted. */
  root: Hex;
  /** Root recorded on-chain, or null while the round is still awaiting one. */
  postedRoot: Hex | null;
  snapshotBlock: bigint;
  /** RWA the round pays out in total. */
  total: bigint;
  claims: MerkleClaim[];
}

/** A round as the vault records it. */
interface OnChainRound {
  root: Hex;
  total: bigint;
  claimed: bigint;
  snapshotBlock: bigint;
  openedAt: bigint;
  reclaimed: boolean;
}

const ZERO_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000000';

async function readRound(vault: Address, roundId: number): Promise<OnChainRound> {
  const round = await robinhoodPublicClient.readContract({
    address: vault,
    abi: PONS_RWA_VAULT_ABI,
    functionName: 'rounds',
    args: [BigInt(roundId)],
  });

  return {
    root: round.root,
    total: BigInt(round.total),
    claimed: BigInt(round.claimed),
    snapshotBlock: BigInt(round.snapshotBlock),
    openedAt: BigInt(round.openedAt),
    reclaimed: round.reclaimed,
  };
}

/**
 * The pool holds the liquidity side of the supply and cannot call `claim`.
 *
 * Left in the split it would be allocated a large share that nobody can ever
 * take, quietly shrinking every real holder's dividend to fund an address that
 * will never spend it.
 */
async function liquidityPoolOf(token: Address): Promise<Address | null> {
  try {
    return await robinhoodPublicClient.readContract({
      address: token,
      abi: PONS_TOKEN_ABI,
      functionName: 'liquidityPool',
    });
  } catch {
    // Pre-graduation there may be no pool yet. Excluding nothing is correct
    // then, and wrong later, so this must not be reached for a live token.
    return null;
  }
}

export async function buildRoundAllocation(params: {
  token: Address;
  vault: Address;
  roundId: number;
  /** Where to begin replaying transfers. The launch block, when known. */
  fromBlock?: bigint;
}): Promise<RoundAllocation> {
  const { token, vault, roundId, fromBlock } = params;

  const [round, pool] = await Promise.all([readRound(vault, roundId), liquidityPoolOf(token)]);

  if (round.total === 0n) {
    throw new Error(`Round ${roundId} has nothing to allocate.`);
  }

  const snapshot = await snapshotHolders(token, vault, round.snapshotBlock, { fromBlock, pool });

  if (snapshot.totalHeld === 0n) {
    throw new Error(
      `Round ${roundId} has no eligible holders at block ${round.snapshotBlock}, so there is nobody to pay.`,
    );
  }

  const allocation = allocatePro(snapshot.holders, snapshot.totalHeld, round.total);
  const { root, claims, total } = buildAllocation(allocation);

  // The contract pays out of a fixed `total`, so a tree summing to more than
  // that would verify proofs correctly right up until the round ran dry and the
  // last holders were told their valid claim was exhausted.
  if (total !== round.total) {
    throw new Error(
      `Allocation for round ${roundId} sums to ${total} but the round holds ${round.total}.`,
    );
  }

  return {
    roundId,
    root,
    postedRoot: round.root === ZERO_ROOT ? null : round.root,
    snapshotBlock: round.snapshotBlock,
    total: round.total,
    claims: [...claims.values()],
  };
}
