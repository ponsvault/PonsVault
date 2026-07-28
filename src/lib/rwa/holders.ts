import { getAddress, parseAbiItem, zeroAddress, type Address } from 'viem';

import { robinhoodPublicClient } from '@/lib/pons/client';
import { PONS_ACTIVE_LOCKER, PONS_LEGACY_LOCKER } from '@/lib/pons/contracts';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

/** The burn address pons tokens are sent to. */
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;

/**
 * Blocks per `getLogs` request, before any splitting.
 *
 * Starts wide because a quiet token's whole history fits in one call, and
 * narrows itself when it has to. Callers that know when their token launched
 * should pass `fromBlock` regardless, which is cheaper than any page size.
 */
const LOG_PAGE_SIZE = 2_000_000n;

/**
 * Whether the node is complaining that a range was too big to answer.
 *
 * It says so two different ways — a hard cap of ten thousand logs, and a
 * timeout on ranges it could not gather in time — and both mean the same thing
 * to us. This is the failure that only appears on success: a quiet token is
 * fine at any range, and the snapshot starts throwing precisely when a token
 * gets busy enough for its dividend to be worth anything.
 *
 * Treating a timeout as splittable is safe even when it was really transient,
 * because the retry is simply a narrower version of the same query.
 */
function isRangeTooLarge(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /exceed|limit|too many|10000|query returned more than|timed out|timeout/i.test(message);
}

/** Whether the provider is asking us to slow down rather than to ask differently. */
function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|403|rate limit|too many requests|forbidden/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads a block range, halving it as many times as the node demands.
 *
 * Splitting on the error rather than guessing a safe size keeps a quiet token
 * to a single request while still completing for one trading thousands of
 * times an hour.
 *
 * The halves are read one after another rather than together. Recursing in
 * parallel looks faster and is how this was first written, but the concurrency
 * doubles at every level, so a token that needs a few splits arrives as a burst
 * of simultaneous requests and the provider starts returning 403s — turning a
 * range problem into a rate-limit problem. One at a time is slower and finishes.
 */
async function getLogsAdaptive(
  token: Address,
  fromBlock: bigint,
  toBlock: bigint,
  depth = 0,
): Promise<{ from: Address; to: Address; value: bigint }[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const logs = await robinhoodPublicClient.getLogs({
        address: token,
        event: TRANSFER_EVENT,
        fromBlock,
        toBlock,
      });

      return logs.flatMap((log) => {
        const { from, to, value } = log.args;
        if (!from || !to || value === undefined) return [];
        return [{ from, to, value }];
      });
    } catch (error) {
      if (isRateLimited(error) && attempt < 4) {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      // A single block over the cap cannot be split any further. Better to fail
      // loudly than to return a holder set that is quietly missing transfers,
      // which would produce a wrong allocation that still looks valid.
      if (!isRangeTooLarge(error) || fromBlock >= toBlock || depth > 24) throw error;

      const mid = fromBlock + (toBlock - fromBlock) / 2n;
      const left = await getLogsAdaptive(token, fromBlock, mid, depth + 1);
      const right = await getLogsAdaptive(token, mid + 1n, toBlock, depth + 1);
      return [...left, ...right];
    }
  }
}

export interface HolderBalance {
  account: Address;
  balance: bigint;
}

export interface HolderSnapshot {
  /** Block the balances are correct as of. */
  block: bigint;
  holders: HolderBalance[];
  /** Sum of every included balance, the denominator for a pro-rata split. */
  totalHeld: bigint;
  /** Addresses deliberately left out, for anyone reproducing this. */
  excluded: Address[];
}

/**
 * Addresses that hold the token but are not holders in the sense that matters.
 *
 * A dividend is meant for people, and each of these is plumbing: the pool holds
 * the float everyone trades against, the vault holds fees and its own burn pile
 * before it moves them, the locker holds the LP position, and the burn address
 * holds supply that is gone. Paying them would divert most of every round into
 * addresses that cannot claim, and in the pool's case would hand the dividend
 * to whoever the liquidity belongs to rather than to holders.
 *
 * This list is part of the payout's definition, not an implementation detail.
 * Anyone checking a root has to exclude exactly the same set, so it is returned
 * with the snapshot rather than applied silently.
 */
function excludedAddresses(token: Address, vault: Address, pool: Address | null): Address[] {
  const set = [
    zeroAddress,
    BURN_ADDRESS,
    token,
    vault,
    PONS_ACTIVE_LOCKER,
    PONS_LEGACY_LOCKER,
    ...(pool ? [pool] : []),
  ];

  return [...new Set(set.map((address) => getAddress(address)))];
}

/**
 * Every holder of `token` and their balance at `atBlock`.
 *
 * Reconstructed by folding the token's whole `Transfer` history, because a pons
 * token is a plain ERC-20: it has no transfer hook to notify anything, and no
 * historical balance lookup to query. Replaying the log is the only way to
 * learn who held what, and it is why this cannot happen on-chain.
 *
 * Deterministic by construction, which is the property that matters most here:
 * the same token and block always produce the same list, in the same order, so
 * anyone can rebuild the tree from public data and check a posted root against
 * it without trusting whoever posted it.
 */
export async function snapshotHolders(
  token: Address,
  vault: Address,
  atBlock: bigint,
  options: { fromBlock?: bigint; pool?: Address | null } = {},
): Promise<HolderSnapshot> {
  const excluded = excludedAddresses(token, vault, options.pool ?? null);
  const isExcluded = new Set(excluded.map((address) => address.toLowerCase()));

  const balances = new Map<string, bigint>();
  const credit = (address: string, delta: bigint) => {
    const key = address.toLowerCase();
    // Minting shows as a transfer from the zero address and burning as one to
    // the burn address; skipping both here is what keeps the running totals
    // equal to real circulating supply rather than to gross movement.
    if (isExcluded.has(key)) return;
    balances.set(key, (balances.get(key) ?? 0n) + delta);
  };

  let cursor = options.fromBlock ?? 0n;
  while (cursor <= atBlock) {
    const toBlock = cursor + LOG_PAGE_SIZE - 1n > atBlock ? atBlock : cursor + LOG_PAGE_SIZE - 1n;

    for (const { from, to, value } of await getLogsAdaptive(token, cursor, toBlock)) {
      credit(from, -value);
      credit(to, value);
    }

    cursor = toBlock + 1n;
  }

  const holders: HolderBalance[] = [];
  let totalHeld = 0n;

  for (const [account, balance] of balances) {
    // A zero balance is somebody who has fully exited, and a negative one
    // cannot happen unless the fold is wrong — neither belongs in a payout.
    if (balance <= 0n) continue;
    holders.push({ account: getAddress(account), balance });
    totalHeld += balance;
  }

  // Sorted so the tree built from this is byte-identical everywhere, whatever
  // order the RPC happened to return logs in.
  holders.sort((a, b) => (a.account.toLowerCase() < b.account.toLowerCase() ? -1 : 1));

  return { block: atBlock, holders, totalHeld, excluded };
}

/**
 * Splits `amount` across `holders` in proportion to what each one holds.
 *
 * Integer division always leaves a remainder, and it has to go somewhere: an
 * allocation summing to less than the round total would strand the difference
 * until the round expired, and one summing to more would let the last claimants
 * find the round already empty. Giving the dust to the largest holder keeps the
 * sum exact while distorting the split by less than it would anywhere else.
 *
 * Holders whose share rounds to nothing are dropped rather than carried as
 * zero-value leaves, so nobody is offered a claim that costs more gas than it
 * pays.
 */
export function allocatePro(
  holders: HolderBalance[],
  totalHeld: bigint,
  amount: bigint,
): Map<Address, bigint> {
  const allocation = new Map<Address, bigint>();
  if (totalHeld <= 0n || amount <= 0n) return allocation;

  let distributed = 0n;
  let largest: Address | null = null;
  let largestBalance = 0n;

  for (const { account, balance } of holders) {
    const share = (amount * balance) / totalHeld;
    if (share > 0n) {
      allocation.set(account, share);
      distributed += share;
    }
    if (balance > largestBalance) {
      largestBalance = balance;
      largest = account;
    }
  }

  const remainder = amount - distributed;
  if (remainder > 0n && largest) {
    allocation.set(largest, (allocation.get(largest) ?? 0n) + remainder);
  }

  return allocation;
}
