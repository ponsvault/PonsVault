import type { Address } from 'viem';

import { verifyProof } from '@/lib/rwa/merkle';
import { buildRoundAllocation } from '@/lib/rwa/round';

/**
 * Rebuilds a round's allocation and checks it against what was posted on-chain.
 *
 * The reason this exists is that a posted root is permanent: if the allocation
 * cannot be reproduced, every holder's proof reverts and the round is stuck
 * until it expires. Reproducibility is therefore a property worth testing
 * directly rather than inferring from a successful `postRoot`.
 *
 *   npx tsx --env-file=.env.local scripts/rwa-verify-round.ts <vault> <token> [roundId]
 */
async function main() {
  const [vault, token, round] = process.argv.slice(2);
  if (!vault || !token) {
    console.error('usage: rwa-verify-round.ts <vault> <token> [roundId]');
    process.exit(1);
  }

  const roundId = round ? Number(round) : 0;

  const allocation = await buildRoundAllocation({
    token: token as Address,
    vault: vault as Address,
    roundId,
  });

  console.log(`round ${roundId} of ${vault}`);
  console.log(`  snapshot block : ${allocation.snapshotBlock}`);
  console.log(`  holders        : ${allocation.claims.length}`);
  console.log(`  total          : ${allocation.total}`);
  console.log(`  rebuilt root   : ${allocation.root}`);
  console.log(`  posted root    : ${allocation.postedRoot ?? '(none yet)'}`);

  const selfConsistent = allocation.claims.every((claim) =>
    verifyProof(allocation.root, claim.account, claim.amount, claim.proof),
  );
  console.log(`  proofs verify  : ${selfConsistent ? 'all' : 'SOME FAIL'}`);

  if (!allocation.postedRoot) {
    console.log('\nNo root posted yet, so there is nothing to disagree with.');
    return;
  }

  const matches = allocation.postedRoot.toLowerCase() === allocation.root.toLowerCase();
  console.log(`\n${matches ? 'MATCH — holders can claim.' : 'MISMATCH — claims will revert with InvalidProof.'}`);
  if (!matches) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
