import { encodePacked, keccak256, type Address, type Hex, createWalletClient } from 'viem';
import type { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

import { LOTTERY_PHASE, PONS_LOTTERY_VAULT_ABI } from '@/lib/lottery/abi';
import { robinhoodChain } from '@/lib/pons/chain';
import { robinhoodPublicClient } from '@/lib/pons/client';

/**
 * Advances a lottery round past entry: commit when the window closes, reveal
 * after the delay.
 *
 * Secrets are generated here and discarded after reveal — they only need to
 * survive from commit to reveal inside this process. A crash between those
 * steps leaves the round stuck until someone with the operator key intervenes;
 * that is accepted for v1 (the pot is not lost, only delayed).
 */

export type DrawOutcome =
  | { status: 'committed'; roundId: number; hash: Hex }
  | { status: 'revealed'; roundId: number; hash: Hex }
  | { status: 'cancelled'; roundId: number; hash: Hex }
  | { status: 'idle' }
  | { status: 'failed'; reason: string };

type Keeper = ReturnType<typeof privateKeyToAccount>;
type Wallet = ReturnType<typeof createWalletClient>;

/** In-process secrets keyed by vault+round, so reveal can find what commit used. */
const secrets = new Map<string, bigint>();

function secretKey(vault: Address, roundId: number): string {
  return `${vault.toLowerCase()}:${roundId}`;
}

function commitmentFor(secret: bigint, roundId: number, vault: Address): Hex {
  return keccak256(encodePacked(['uint256', 'uint256', 'address'], [secret, BigInt(roundId), vault]));
}

export async function advanceLotteryDraw(params: {
  vault: Address;
  account: Keeper;
  wallet: Wallet;
  dryRun?: boolean;
}): Promise<DrawOutcome> {
  const { vault, account, wallet, dryRun } = params;
  const now = Math.floor(Date.now() / 1000);

  try {
    const roundCount = await robinhoodPublicClient.readContract({
      address: vault,
      abi: PONS_LOTTERY_VAULT_ABI,
      functionName: 'roundCount',
    });
    if (roundCount === 0n) return { status: 'idle' };

    const roundId = Number(roundCount - 1n);
    const round = await robinhoodPublicClient.readContract({
      address: vault,
      abi: PONS_LOTTERY_VAULT_ABI,
      functionName: 'rounds',
      args: [BigInt(roundId)],
    });

    const phase = Number(round.phase);

    if (phase === LOTTERY_PHASE.Entering && now >= Number(round.entryEndsAt)) {
      const secret = BigInt(`0x${randomBytes(32).toString('hex')}`);
      const commitment = commitmentFor(secret, roundId, vault);
      secrets.set(secretKey(vault, roundId), secret);

      if (dryRun) return { status: 'committed', roundId, hash: '0x' as Hex };

      const hash = await wallet.writeContract({
        address: vault,
        abi: PONS_LOTTERY_VAULT_ABI,
        functionName: 'commit',
        args: [commitment],
        account,
        chain: robinhoodChain,
      });
      const receipt = await robinhoodPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        return { status: 'failed', reason: `Commit reverted in ${hash}` };
      }

      // No entrants cancels inside commit — treat a cancelled round as such.
      const after = await robinhoodPublicClient.readContract({
        address: vault,
        abi: PONS_LOTTERY_VAULT_ABI,
        functionName: 'rounds',
        args: [BigInt(roundId)],
      });
      if (Number(after.phase) === LOTTERY_PHASE.Cancelled) {
        secrets.delete(secretKey(vault, roundId));
        return { status: 'cancelled', roundId, hash };
      }

      return { status: 'committed', roundId, hash };
    }

    if (phase === LOTTERY_PHASE.Committed && now >= Number(round.revealAfter)) {
      const secret = secrets.get(secretKey(vault, roundId));
      if (secret === undefined) {
        return {
          status: 'failed',
          reason: `No secret in memory for round ${roundId} — commit was on another process.`,
        };
      }

      if (dryRun) return { status: 'revealed', roundId, hash: '0x' as Hex };

      const hash = await wallet.writeContract({
        address: vault,
        abi: PONS_LOTTERY_VAULT_ABI,
        functionName: 'reveal',
        args: [secret],
        account,
        chain: robinhoodChain,
      });
      const receipt = await robinhoodPublicClient.waitForTransactionReceipt({ hash });
      secrets.delete(secretKey(vault, roundId));
      if (receipt.status !== 'success') {
        return { status: 'failed', reason: `Reveal reverted in ${hash}` };
      }
      return { status: 'revealed', roundId, hash };
    }

    return { status: 'idle' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', reason: message.split('\n')[0]?.trim() || 'Unknown error' };
  }
}
