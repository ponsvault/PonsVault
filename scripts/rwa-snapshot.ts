/**
 * Rebuilds a token's holder set from its `Transfer` log and checks it against
 * the chain.
 *
 * Two things this is for. During development it answers whether the replay is
 * correct at all, by comparing every reconstructed balance against a real
 * `balanceOf` — a fold that drops or double-counts a transfer produces a
 * plausible-looking list that is quietly wrong, and nothing else would catch
 * it.
 *
 * In production it is how anyone audits a posted root without trusting us:
 * rerun this at the round's snapshot block, rebuild the tree, and compare.
 *
 *   npx tsx --conditions=react-server scripts/rwa-snapshot.ts <token> [vault]
 */
import { formatEther, type Address } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONS_TOKEN_ABI } from '@/lib/pons/token-state';
import { allocatePro, snapshotHolders } from '@/lib/rwa/holders';
import { buildAllocation, verifyProof } from '@/lib/rwa/merkle';

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

async function main() {
  const token = process.argv[2] as Address;
  const vault = (process.argv[3] ?? '0x0000000000000000000000000000000000000000') as Address;
  if (!token) throw new Error('usage: rwa-snapshot.ts <token> [vault]');

  const [symbol, totalSupply, pool] = await Promise.all([
    robinhoodPublicClient.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'symbol' }),
    robinhoodPublicClient.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'totalSupply' }),
    robinhoodPublicClient
      .readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: 'liquidityPool' })
      .catch(() => null),
  ]);

  const atBlock = await robinhoodPublicClient.getBlockNumber();

  console.log(`token       ${symbol} ${token}`);
  console.log(`pool        ${pool ?? 'unknown'}`);
  console.log(`supply      ${formatEther(totalSupply)}`);
  console.log(`at block    ${atBlock}\n`);

  // From genesis deliberately: this script exists to be checkable, and a
  // fromBlock the reader has to trust would defeat that.
  const snapshot = await snapshotHolders(token, vault, atBlock, {
    fromBlock: 0n,
    pool: pool as Address | null,
  });

  console.log(`excluded    ${snapshot.excluded.join(', ')}`);
  console.log(`holders     ${snapshot.holders.length}`);
  console.log(`held        ${formatEther(snapshot.totalHeld)}`);
  console.log(
    `circulating ${((Number(snapshot.totalHeld) / Number(totalSupply)) * 100).toFixed(2)}% of supply\n`,
  );

  // The check that matters: the fold has to agree with the chain, holder for
  // holder. Anything else here could look right while being wrong.
  const results = await robinhoodPublicClient.multicall({
    contracts: snapshot.holders.map((h) => ({
      address: token,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf' as const,
      args: [h.account] as const,
    })),
    allowFailure: true,
  });

  let mismatches = 0;
  results.forEach((result, i) => {
    const holder = snapshot.holders[i];
    if (result.status !== 'success') {
      console.log(`  ? ${holder.account} could not be read`);
      mismatches++;
      return;
    }
    if (result.result !== holder.balance) {
      mismatches++;
      console.log(
        `  MISMATCH ${holder.account}: replay ${holder.balance} vs chain ${result.result}`,
      );
    }
  });

  console.log(
    mismatches === 0
      ? `all ${snapshot.holders.length} reconstructed balances match the chain`
      : `${mismatches} of ${snapshot.holders.length} balances disagree with the chain`,
  );

  console.log('\ntop holders:');
  [...snapshot.holders]
    .sort((a, b) => (b.balance > a.balance ? 1 : -1))
    .slice(0, 8)
    .forEach((h) => {
      const share = (Number(h.balance) / Number(snapshot.totalHeld)) * 100;
      console.log(`  ${h.account}  ${share.toFixed(3).padStart(7)}%  ${formatEther(h.balance)}`);
    });

  if (snapshot.holders.length === 0) return;

  // And a dry run of the payout the keeper would post for this holder set.
  const roundAmount = 13_435_676_894_782_655n; // one real NVDA purchase
  const allocation = allocatePro(snapshot.holders, snapshot.totalHeld, roundAmount);
  const built = buildAllocation(allocation);

  const everyProofValid = [...built.claims.values()].every((claim) =>
    verifyProof(built.root, claim.account, claim.amount, claim.proof),
  );

  console.log(`\nallocation of ${roundAmount} wei of NVDA over this holder set:`);
  console.log(`  root      ${built.root}`);
  console.log(`  leaves    ${built.claims.size}`);
  console.log(`  sums to   ${built.total} (exact: ${built.total === roundAmount})`);
  console.log(`  proofs    ${everyProofValid ? 'all verify' : 'INVALID'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
