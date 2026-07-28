import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

/**
 * The allocation tree behind a round's root.
 *
 * Deliberately hand-rolled rather than pulled from a library: it has to agree
 * byte for byte with OpenZeppelin's `MerkleProof` as used by {PonsRwaVault},
 * and the two conventions that make that true are small enough to state
 * outright and too important to inherit from a dependency's defaults.
 *
 *   1. Leaves are hashed twice. A single hash lets an internal node be passed
 *      off as a leaf, which would let someone claim an amount nobody allocated.
 *   2. Pairs are hashed in sorted order, so a proof carries only siblings and
 *      never which side each one was on.
 *
 * Odd nodes are promoted to the next level unchanged, which is what
 * `MerkleProof.verify` expects of a tree with a non-power-of-two leaf count.
 */

export interface MerkleClaim {
  account: Address;
  amount: bigint;
  proof: Hex[];
}

export interface MerkleAllocation {
  root: Hex;
  claims: Map<Address, MerkleClaim>;
  /** Sum of every leaf. Must equal the round's total, or later claims revert. */
  total: bigint;
}

/** Must match {PonsRwaVault-leafFor}. */
export function leafFor(account: Address, amount: bigint): Hex {
  return keccak256(
    keccak256(
      encodeAbiParameters(
        [
          { type: 'address', name: 'account' },
          { type: 'uint256', name: 'amount' },
        ],
        [account, amount],
      ),
    ),
  );
}

function hashPair(a: Hex, b: Hex): Hex {
  const [left, right] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(`0x${left.slice(2)}${right.slice(2)}`);
}

/** Every level of the tree, leaves first, root last. */
function buildLevels(leaves: Hex[]): Hex[][] {
  const levels: Hex[][] = [leaves];

  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: Hex[] = [];

    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }

    levels.push(next);
  }

  return levels;
}

/**
 * Builds the root and every holder's proof from an allocation.
 *
 * Entries are sorted by address so the same allocation always yields the same
 * root, which is what lets a third party rebuild it and compare.
 */
export function buildAllocation(allocation: Map<Address, bigint>): MerkleAllocation {
  const entries = [...allocation.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort(([a], [b]) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));

  if (entries.length === 0) {
    throw new Error('Cannot build an allocation with no positive entries.');
  }

  const leaves = entries.map(([account, amount]) => leafFor(account, amount));
  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1][0];

  const claims = new Map<Address, MerkleClaim>();

  entries.forEach(([account, amount], leafIndex) => {
    const proof: Hex[] = [];
    let index = leafIndex;

    for (let level = 0; level < levels.length - 1; level++) {
      const nodes = levels[level];
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
      // An odd final node has no sibling; it was promoted unchanged, so the
      // proof simply skips this level.
      if (siblingIndex < nodes.length) proof.push(nodes[siblingIndex]);
      index = Math.floor(index / 2);
    }

    claims.set(account, { account, amount, proof });
  });

  const total = entries.reduce((sum, [, amount]) => sum + amount, 0n);

  return { root, claims, total };
}

/** Mirrors OpenZeppelin's `MerkleProof.verify`, for checking work locally. */
export function verifyProof(root: Hex, account: Address, amount: bigint, proof: Hex[]): boolean {
  let computed = leafFor(account, amount);
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}
