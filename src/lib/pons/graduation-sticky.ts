import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { erc20Abi, parseEther, type Address } from 'viem';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

import { robinhoodPublicClient } from './client';
import { PONS_EXPLORER_URL, PONS_GRADUATION_ETH } from './constants';
import { PONS_WETH } from './contracts';
import type { GraduationStatus } from './token-state';

/**
 * pons `graduationStatus.graduated` is computed from *current* paired WETH.
 * Once sells drain the pool below 4.2 ETH the flag flips back to false even
 * though the token already graduated. We treat graduation as sticky once we
 * have ever observed a crossing (chain, seed list, DB, or peak WETH scan).
 */

/** Tokens that already crossed the threshold (peak pool WETH ≥ 4.2). */
const KNOWN_EVER_GRADUATED = new Set(
  [
    // PonsVault $VAULT — peak ~8 ETH
    '0xfdae23ce76018da62507bb5ef20e6ef5450e8312',
    // Sandbox $SBX — peak ~6.6 ETH
    '0xa84b9f3b386a4875e524a0c35a4569ce85a1d083',
  ].map((t) => t.toLowerCase()),
);

const LOCAL_STICKY_PATH = path.join(process.cwd(), 'data', 'ever-graduated.json');

const memorySticky = new Set<string>(KNOWN_EVER_GRADUATED);

type LocalStickyFile = { tokens: string[] };

async function loadLocalSticky(): Promise<Set<string>> {
  try {
    const raw = await readFile(LOCAL_STICKY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LocalStickyFile;
    for (const token of parsed.tokens ?? []) {
      memorySticky.add(token.toLowerCase());
    }
  } catch {
    // Missing file is fine — seeds + runtime marks still apply.
  }
  return memorySticky;
}

async function persistLocalSticky(token: string): Promise<void> {
  await loadLocalSticky();
  memorySticky.add(token);
  await mkdir(path.dirname(LOCAL_STICKY_PATH), { recursive: true });
  await writeFile(
    LOCAL_STICKY_PATH,
    JSON.stringify({ tokens: [...memorySticky].sort() }, null, 2),
  );
}

export function isKnownEverGraduated(token: string): boolean {
  return KNOWN_EVER_GRADUATED.has(token.toLowerCase());
}

export async function isEverGraduated(token: string): Promise<boolean> {
  const normalized = token.toLowerCase();
  if (memorySticky.has(normalized) || KNOWN_EVER_GRADUATED.has(normalized)) {
    return true;
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('ponsvault_launches')
      .select('ever_graduated')
      .eq('token', normalized)
      .maybeSingle();

    if (!error && data && (data as { ever_graduated?: boolean }).ever_graduated) {
      memorySticky.add(normalized);
      return true;
    }
  }

  await loadLocalSticky();
  return memorySticky.has(normalized);
}

export async function markEverGraduated(token: string): Promise<void> {
  const normalized = token.toLowerCase();
  if (memorySticky.has(normalized)) return;
  memorySticky.add(normalized);

  if (isSupabaseConfigured()) {
    const { error } = await supabase
      .from('ponsvault_launches')
      .update({ ever_graduated: true })
      .eq('token', normalized);

    // Column may not exist until the migration is applied — fall through.
    if (error && !/ever_graduated|column/i.test(error.message)) {
      console.warn('[graduation-sticky] supabase mark failed:', error.message);
    }
  }

  try {
    await persistLocalSticky(normalized);
  } catch (err) {
    console.warn(
      '[graduation-sticky] local mark failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

export function applyStickyGraduation(
  status: GraduationStatus,
  sticky: boolean,
): GraduationStatus {
  if (status.graduated || sticky) {
    return {
      ...status,
      graduated: true,
      progress: 1,
    };
  }
  return status;
}

/**
 * Resolve graduation with sticky semantics. Optionally scan historical pool
 * WETH transfers when the live factory flag has flipped back to false.
 */
export async function resolveStickyGraduation(params: {
  token: Address;
  status: GraduationStatus;
  pool?: Address | null;
  everGraduated?: boolean;
  /** Peak scan is slower — use on token detail, not explore lists. */
  checkPeak?: boolean;
}): Promise<GraduationStatus> {
  const {
    token,
    status,
    pool,
    everGraduated = false,
    checkPeak = false,
  } = params;

  if (
    status.graduated ||
    (status.threshold > 0n && status.pairedPrincipal >= status.threshold)
  ) {
    void markEverGraduated(token);
    return applyStickyGraduation(status, true);
  }

  if (everGraduated || (await isEverGraduated(token))) {
    return applyStickyGraduation(status, true);
  }

  if (checkPeak && pool && status.threshold > 0n) {
    const crossed = await poolEverReachedThreshold(pool, status.threshold).catch(
      () => false,
    );
    if (crossed) {
      void markEverGraduated(token);
      return applyStickyGraduation(status, true);
    }
  }

  return status;
}

type TokenTx = {
  from: string;
  to: string;
  value: string;
  timeStamp?: string;
  blockNumber?: string;
};

/**
 * Walk WETH transfers for a Uniswap pool backwards from the live balance.
 * Returns true once any reconstructed historical balance is ≥ threshold.
 */
export async function poolEverReachedThreshold(
  pool: Address,
  threshold: bigint = parseEther(String(PONS_GRADUATION_ETH)),
): Promise<boolean> {
  const poolLower = pool.toLowerCase();
  let balance = await robinhoodPublicClient.readContract({
    address: PONS_WETH,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [pool],
  });

  if (balance >= threshold) return true;

  const pageSize = 100;
  const maxPages = 25;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${PONS_EXPLORER_URL}/api`);
    url.searchParams.set('module', 'account');
    url.searchParams.set('action', 'tokentx');
    url.searchParams.set('contractaddress', PONS_WETH);
    url.searchParams.set('address', pool);
    url.searchParams.set('page', String(page));
    url.searchParams.set('offset', String(pageSize));
    url.searchParams.set('sort', 'desc');

    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) break;

    const body = (await res.json()) as {
      status?: string;
      message?: string;
      result?: TokenTx[] | string;
    };

    if (!Array.isArray(body.result) || body.result.length === 0) break;

    for (const tx of body.result) {
      const value = BigInt(tx.value || '0');
      // Undo newest→oldest so balance reconstructs earlier pool state.
      if (tx.to?.toLowerCase() === poolLower) balance -= value;
      if (tx.from?.toLowerCase() === poolLower) balance += value;
      if (balance < 0n) balance = 0n;
      if (balance >= threshold) return true;
    }

    if (body.result.length < pageSize) break;
  }

  return false;
}
