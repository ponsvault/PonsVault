import type { Address, Hex } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';

import { PONS_RWA_VAULT_ABI } from './abi';
import { buildRoundAllocation, type RoundAllocation } from './round';

/**
 * What one wallet can claim from an RWA vault, with the proofs to do it.
 *
 * The allocation is not stored anywhere, so this rebuilds it from the chain.
 * That is cheap to reason about and expensive to run — a rebuild replays a
 * token's entire transfer history — which is why the results are cached below
 * rather than recomputed per visitor.
 */

export interface RoundClaim {
  roundId: number;
  /** RWA owed to this account for the round. */
  amount: bigint;
  proof: Hex[];
  claimed: boolean;
  /** Present once the vault has published the allocation; claims revert until then. */
  rootPosted: boolean;
}

/**
 * Allocations already built, keyed by vault and round.
 *
 * Safe to keep indefinitely because a round is immutable in every input this
 * depends on: `total` and `snapshotBlock` are written when it opens and never
 * change, so the tree derived from them cannot either. Claiming moves
 * `claimed`, which is read separately and never cached.
 *
 * The promise is cached rather than the value, so concurrent requests for the
 * same round share one rebuild instead of starting several.
 */
const allocations = new Map<string, Promise<RoundAllocation>>();

function cacheKey(vault: Address, roundId: number): string {
  return `${vault.toLowerCase()}:${roundId}`;
}

export function allocationFor(
  token: Address,
  vault: Address,
  roundId: number,
): Promise<RoundAllocation> {
  const key = cacheKey(vault, roundId);

  const cached = allocations.get(key);
  if (cached) return cached;

  const pending = buildRoundAllocation({ token, vault, roundId }).catch((error) => {
    // A failed rebuild must not be remembered as the answer, or one bad moment
    // would keep every holder of this round locked out until a redeploy.
    allocations.delete(key);
    throw error;
  });

  allocations.set(key, pending);
  return pending;
}

/**
 * Every round this account has something to collect from.
 *
 * Rounds the account is not in are left out entirely rather than returned as
 * zero, since holding nothing at a snapshot is not a claim worth showing.
 */
/** Raised when the address given is a vault, but not one that pays dividends. */
export class NotAnRwaVaultError extends Error {
  constructor(vault: Address) {
    super(`${vault} is not an RWA Dividend vault, so it has no rounds to claim from.`);
    this.name = 'NotAnRwaVaultError';
  }
}

export async function claimsFor(vault: Address, account: Address): Promise<RoundClaim[]> {
  // Checked first so that pointing this at a buyback vault says so, rather than
  // surfacing a raw "roundCount reverted" that reads like an outage.
  let template: string;
  try {
    template = await robinhoodPublicClient.readContract({
      address: vault,
      abi: PONS_RWA_VAULT_ABI,
      functionName: 'template',
    });
  } catch {
    throw new NotAnRwaVaultError(vault);
  }

  if (template !== 'rwa') throw new NotAnRwaVaultError(vault);

  const [token, roundCount] = await Promise.all([
    robinhoodPublicClient.readContract({
      address: vault,
      abi: PONS_RWA_VAULT_ABI,
      functionName: 'token',
    }),
    robinhoodPublicClient.readContract({
      address: vault,
      abi: PONS_RWA_VAULT_ABI,
      functionName: 'roundCount',
    }),
  ]);

  const total = Number(roundCount);
  if (total === 0) return [];

  const wanted = account.toLowerCase();
  const claims: RoundClaim[] = [];

  // Sequential on purpose. Each uncached round replays the token's transfer
  // history, and the public RPC challenges bursts, so running them together
  // turns a slow page into a failing one.
  for (let roundId = 0; roundId < total; roundId += 1) {
    const allocation = await allocationFor(token, vault, roundId);

    const claim = allocation.claims.find((entry) => entry.account.toLowerCase() === wanted);
    if (!claim) continue;

    const claimed = await robinhoodPublicClient.readContract({
      address: vault,
      abi: PONS_RWA_VAULT_ABI,
      functionName: 'hasClaimed',
      args: [BigInt(roundId), account],
    });

    claims.push({
      roundId,
      amount: claim.amount,
      proof: claim.proof,
      claimed,
      rootPosted: allocation.postedRoot !== null,
    });
  }

  return claims;
}
