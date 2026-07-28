import { parseAbiItem, type Address, type Hex } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONS_TOKEN_ABI } from '@/lib/pons/token-state';

import { PONS_RWA_VAULT_ABI } from './abi';
import { allocatePro, snapshotHolders } from './holders';
import { buildAllocation, type MerkleClaim } from './merkle';

/**
 * Who is owed what from one round, rebuilt from the chain.
 *
 * Derived rather than stored, and that is the point. Every input is fixed and
 * public — the round's `total` is written on-chain when it opens, the block to
 * measure at is where its `RoundOpened` log sits, and the balances at that block
 * are just the token's transfer history — so anyone can run this and get the same
 * root the keeper posted. A stored allocation would have to be trusted; this one
 * can be checked.
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
  /** Block the balances were measured at, in the numbering `getLogs` uses. */
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
  /**
   * `block.number` as the EVM saw it when the round opened.
   *
   * Recorded for anyone auditing the vault, and deliberately not used to read
   * logs — see {@link snapshotBlockOf} for why it cannot be.
   */
  evmSnapshotBlock: bigint;
  openedAt: bigint;
  reclaimed: boolean;
}

const ROUND_OPENED_EVENT = parseAbiItem(
  'event RoundOpened(uint256 indexed roundId, uint256 amount, uint256 snapshotBlock)',
);

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
    evmSnapshotBlock: BigInt(round.snapshotBlock),
    openedAt: BigInt(round.openedAt),
    reclaimed: round.reclaimed,
  };
}

/**
 * The block to read balances at, in the numbering `getLogs` answers in.
 *
 * This chain reports two different heights: `block.number` inside the EVM runs
 * some four million ahead of the `eth_blockNumber` the RPC serves logs against.
 * The vault can only see the former, so the height it stores names a block that
 * does not exist yet — and asking for logs up to it does not fail, it returns
 * the head instead. That silently converts a fixed snapshot into a moving one,
 * so each rebuild sees a different holder set and the root the keeper posted can
 * never be reproduced. A posted root is permanent, so this is the difference
 * between a claimable round and a stuck one.
 *
 * The `RoundOpened` log records the same moment, and a log's `blockNumber` is by
 * definition in the numbering that produced it. `roundId` is indexed, so this is
 * one filtered lookup and the answer is exact rather than an assumed offset.
 */
async function snapshotBlockOf(vault: Address, roundId: number): Promise<bigint> {
  const logs = await robinhoodPublicClient.getLogs({
    address: vault,
    event: ROUND_OPENED_EVENT,
    args: { roundId: BigInt(roundId) },
    fromBlock: 0n,
    toBlock: 'latest',
  });

  const blockNumber = logs[0]?.blockNumber;

  // Refusing rather than falling back to the stored height: that fallback is
  // exactly the bug, and it produces a plausible-looking root that nobody can
  // ever claim against.
  if (blockNumber === undefined || blockNumber === null) {
    throw new Error(
      `No RoundOpened log for round ${roundId} on ${vault}, so the block to snapshot balances at is unknown.`,
    );
  }

  return blockNumber;
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

  const [round, pool, snapshotBlock] = await Promise.all([
    readRound(vault, roundId),
    liquidityPoolOf(token),
    snapshotBlockOf(vault, roundId),
  ]);

  if (round.total === 0n) {
    throw new Error(`Round ${roundId} has nothing to allocate.`);
  }

  const snapshot = await snapshotHolders(token, vault, snapshotBlock, { fromBlock, pool });

  if (snapshot.totalHeld === 0n) {
    throw new Error(
      `Round ${roundId} has no eligible holders at block ${snapshotBlock}, so there is nobody to pay.`,
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
    snapshotBlock,
    total: round.total,
    claims: [...claims.values()],
  };
}
