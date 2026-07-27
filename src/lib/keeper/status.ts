import { isSupabaseConfigured, supabase } from '@/lib/supabase';

import type { KeeperTickResult } from './run-vaults';

/**
 * How long the keeper may go quiet before something is wrong.
 *
 * Three cron intervals. One missed tick is a deploy or a cold start; three in a
 * row is the scheduler, the secret, or the host.
 */
const STALE_AFTER_SECONDS = 15 * 60;

export interface KeeperTickRecord {
  ranAt: string;
  checked: number;
  ran: number;
  keeper: string;
  balance: string;
  outcomes: unknown[];
  durationMs: number | null;
  error: string | null;
}

export interface KeeperStatus {
  /** False when nothing has ever been recorded, or Supabase is not configured. */
  observed: boolean;
  /** Whether the last tick is recent enough that the scheduler looks alive. */
  healthy: boolean;
  reason: string;
  lastTickAt: string | null;
  ageSeconds: number | null;
  staleAfterSeconds: number;
  last: KeeperTickRecord | null;
  /** Recent history, newest first, for spotting a gap rather than a single miss. */
  recent: Array<Pick<KeeperTickRecord, 'ranAt' | 'checked' | 'ran' | 'error'>>;
}

interface TickRow {
  ran_at: string;
  checked: number;
  ran: number;
  keeper: string;
  balance_wei: string;
  outcomes: unknown[];
  duration_ms: number | null;
  error: string | null;
}

const rowToRecord = (row: TickRow): KeeperTickRecord => ({
  ranAt: row.ran_at,
  checked: row.checked,
  ran: row.ran,
  keeper: row.keeper,
  balance: row.balance_wei,
  outcomes: row.outcomes ?? [],
  durationMs: row.duration_ms,
  error: row.error,
});

/**
 * Records one keeper pass.
 *
 * Never throws. A tick that ran successfully but could not write its own history
 * has still done the useful work, and failing the request over bookkeeping would
 * turn a monitoring gap into an outage.
 */
export async function recordTick(
  result: Pick<KeeperTickResult, 'keeper' | 'balance' | 'checked' | 'ran' | 'outcomes'> | null,
  options: { durationMs: number; error?: string },
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    await supabase.from('keeper_ticks').insert({
      checked: result?.checked ?? 0,
      ran: result?.ran ?? 0,
      keeper: result?.keeper ?? '',
      balance_wei: result?.balance ?? '0',
      outcomes: result?.outcomes ?? [],
      duration_ms: Math.round(options.durationMs),
      error: options.error ?? null,
    });
  } catch {
    // Deliberately swallowed — see the note above.
  }
}

/** The keeper's own account of whether it is running. */
export async function readKeeperStatus(limit = 12): Promise<KeeperStatus> {
  const base = {
    staleAfterSeconds: STALE_AFTER_SECONDS,
    lastTickAt: null,
    ageSeconds: null,
    last: null,
    recent: [],
  };

  if (!isSupabaseConfigured()) {
    return {
      ...base,
      observed: false,
      healthy: false,
      reason: 'Supabase is not configured, so keeper ticks are not recorded.',
    };
  }

  const { data, error } = await supabase
    .from('keeper_ticks')
    .select('ran_at, checked, ran, keeper, balance_wei, outcomes, duration_ms, error')
    .order('ran_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { ...base, observed: false, healthy: false, reason: error.message };
  }

  const rows = (data ?? []) as TickRow[];
  const latest = rows[0];

  if (!latest) {
    return {
      ...base,
      observed: false,
      healthy: false,
      reason: 'The keeper has never run. On Vercel, cron fires only on production deployments.',
    };
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(latest.ran_at)) / 1000));

  // Recency alone is not health. A keeper whose every pass throws still ticks on
  // schedule, so judging by age would report a permanently broken keeper — a bad
  // key, an unreachable RPC — as fine right up until someone noticed the burns
  // had stopped. Both failures have to fail the check.
  const stale = ageSeconds > STALE_AFTER_SECONDS;
  const failed = Boolean(latest.error);

  return {
    observed: true,
    healthy: !stale && !failed,
    reason: stale
      ? `No tick for ${ageSeconds}s, over the ${STALE_AFTER_SECONDS}s threshold. The schedule is probably not firing.`
      : failed
        ? `Last tick ran ${ageSeconds}s ago but failed: ${latest.error}`
        : `Last tick ${ageSeconds}s ago.`,
    lastTickAt: latest.ran_at,
    ageSeconds,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    last: rowToRecord(latest),
    recent: rows.map((row) => ({
      ranAt: row.ran_at,
      checked: row.checked,
      ran: row.ran,
      error: row.error,
    })),
  };
}
