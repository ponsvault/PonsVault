import { NextResponse } from 'next/server';
import { isAddress, type Address } from 'viem';

import { NotAnRwaVaultError, claimsFor } from '@/lib/rwa/claims';

/**
 * The proofs a wallet needs to collect its dividends.
 *
 * The vault verifies a Merkle proof against the root it published, so a claim
 * cannot be made without one, and nothing on-chain hands them out. This rebuilds
 * the allocation from the same public inputs the keeper used — the round's total
 * and snapshot block, and the token's transfer history — which means a holder
 * can reproduce this result themselves rather than taking our word for it.
 *
 * Rendered per request: what a wallet still has to collect changes the moment it
 * collects, and a cached "unclaimed" would invite a transaction certain to
 * revert. The expensive half is cached in-process instead, keyed by round.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vault = searchParams.get('vault');
  const account = searchParams.get('account');

  if (!vault || !isAddress(vault)) {
    return NextResponse.json({ error: 'A valid vault address is required.' }, { status: 400 });
  }

  if (!account || !isAddress(account)) {
    return NextResponse.json({ error: 'A valid account address is required.' }, { status: 400 });
  }

  try {
    const claims = await claimsFor(vault as Address, account as Address);

    return NextResponse.json({
      vault,
      account,
      claims: claims.map((claim) => ({
        roundId: claim.roundId,
        // Strings because these are wei-scale and JSON has no bigint.
        amount: claim.amount.toString(),
        proof: claim.proof,
        claimed: claim.claimed,
        rootPosted: claim.rootPosted,
        // The only state in which a claim can actually be sent.
        claimable: claim.rootPosted && !claim.claimed && claim.amount > 0n,
      })),
    });
  } catch (error) {
    // A wrong address is the caller's mistake and permanent; anything else is
    // ours and probably temporary. Worth separating, so a client knows whether
    // retrying could help.
    if (error instanceof NotAnRwaVaultError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not build claim proofs.' },
      { status: 503 },
    );
  }
}
