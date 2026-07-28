import type { Address, Hex, createWalletClient } from 'viem';
import type { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONS_RWA_VAULT_ABI } from '@/lib/rwa/abi';
import { buildRoundAllocation } from '@/lib/rwa/round';

/**
 * Publishing who is owed what, for rounds that have money but no allocation.
 *
 * An RWA round is opened by `run` and is unclaimable until its root is posted,
 * so this is the second half of every run rather than a background chore. It is
 * kept separate from the run itself because the two fail independently: a run
 * that succeeds and a root that does not must leave the round recoverable, not
 * stuck.
 *
 * Driven by the vault's own `roundsAwaitingRoot` rather than by what this
 * process just did. A root that failed to post last tick — a reverted send, a
 * crash, a keeper restart — is picked up on the next one, and the allocation is
 * recomputed identically because it is derived from the chain.
 */

export type RootOutcome =
  | { roundId: number; status: 'posted'; hash: Hex; root: Hex; holders: number }
  | { roundId: number; status: 'already-posted'; root: Hex }
  | { roundId: number; status: 'failed'; reason: string };

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]?.trim() || 'Unknown error';
}

type Keeper = ReturnType<typeof privateKeyToAccount>;
type Wallet = ReturnType<typeof createWalletClient>;

export async function postPendingRoots(params: {
  token: Address;
  vault: Address;
  account: Keeper;
  wallet: Wallet;
  /** Skip sending, and report what would have been posted. */
  dryRun?: boolean;
  fromBlock?: bigint;
}): Promise<RootOutcome[]> {
  const { token, vault, account, wallet, dryRun, fromBlock } = params;

  const pending = await robinhoodPublicClient.readContract({
    address: vault,
    abi: PONS_RWA_VAULT_ABI,
    functionName: 'roundsAwaitingRoot',
  });

  const outcomes: RootOutcome[] = [];

  for (const id of pending) {
    const roundId = Number(id);

    try {
      const allocation = await buildRoundAllocation({ token, vault, roundId, fromBlock });

      // `roundsAwaitingRoot` was read before this loop began, and posting is
      // write-once. Re-checking keeps a second keeper, or a retry racing the
      // previous attempt's receipt, from spending gas on a certain revert.
      if (allocation.postedRoot) {
        outcomes.push({ roundId, status: 'already-posted', root: allocation.postedRoot });
        continue;
      }

      if (dryRun) {
        outcomes.push({
          roundId,
          status: 'posted',
          hash: '0x' as Hex,
          root: allocation.root,
          holders: allocation.claims.length,
        });
        continue;
      }

      const hash = await wallet.writeContract({
        address: vault,
        abi: PONS_RWA_VAULT_ABI,
        functionName: 'postRoot',
        args: [BigInt(roundId), allocation.root],
        account,
        chain: robinhoodChain,
      });

      const receipt = await robinhoodPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        outcomes.push({ roundId, status: 'failed', reason: `Reverted in ${hash}` });
        continue;
      }

      outcomes.push({
        roundId,
        status: 'posted',
        hash,
        root: allocation.root,
        holders: allocation.claims.length,
      });
    } catch (error) {
      // One bad round must not strand the others: they are independent
      // allocations and a later one may well build cleanly.
      outcomes.push({ roundId, status: 'failed', reason: reasonOf(error) });
    }
  }

  return outcomes;
}
