import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { normalizeHandle } from '@/lib/fee-share/social';
import type { SocialPlatform } from '@/lib/fee-share/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { PonsShareLaunchRecord, PonsShareLaunchRegistryFile } from './types';

const REGISTRY_PATH = path.join(process.cwd(), 'data', 'ponsshare-launches.json');

type LaunchRow = {
  token: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  deployer: string;
  fee_wallet: string;
  fee_share_platform: SocialPlatform | null;
  fee_share_handle: string | null;
  transaction_hash: string;
  launched_at: string;
};

function rowToLaunch(row: LaunchRow): PonsShareLaunchRecord {
  return {
    token: row.token,
    name: row.name,
    symbol: row.symbol,
    description: row.description,
    logo: row.logo,
    deployer: row.deployer,
    feeWallet: row.fee_wallet as `0x${string}`,
    feeSharePlatform: row.fee_share_platform ?? undefined,
    feeShareHandle: row.fee_share_handle ?? undefined,
    transactionHash: row.transaction_hash as `0x${string}`,
    launchedAt: row.launched_at,
  };
}

function launchToRow(launch: PonsShareLaunchRecord): LaunchRow {
  return {
    token: launch.token.toLowerCase(),
    name: launch.name,
    symbol: launch.symbol,
    description: launch.description,
    logo: launch.logo,
    deployer: launch.deployer.toLowerCase(),
    fee_wallet: launch.feeWallet.toLowerCase(),
    fee_share_platform: launch.feeSharePlatform ?? null,
    fee_share_handle: launch.feeShareHandle
      ? normalizeHandle(launch.feeShareHandle)
      : null,
    transaction_hash: launch.transactionHash,
    launched_at: launch.launchedAt,
  };
}

async function ensureRegistry(): Promise<PonsShareLaunchRegistryFile> {
  await mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as PonsShareLaunchRegistryFile;
  } catch {
    const empty: PonsShareLaunchRegistryFile = { launches: [] };
    await writeFile(REGISTRY_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
}

async function saveRegistry(registry: PonsShareLaunchRegistryFile): Promise<void> {
  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export async function recordPonsShareLaunch(
  launch: PonsShareLaunchRecord,
): Promise<PonsShareLaunchRecord> {
  if (isSupabaseConfigured()) {
    const row = launchToRow(launch);
    const { data, error } = await supabase
      .from('ponsshare_launches')
      .upsert(row, { onConflict: 'token' })
      .select(
        'token, name, symbol, description, logo, deployer, fee_wallet, fee_share_platform, fee_share_handle, transaction_hash, launched_at',
      )
      .single();

    if (error) throw new Error(error.message);
    return rowToLaunch(data as LaunchRow);
  }

  const registry = await ensureRegistry();
  const existingIdx = registry.launches.findIndex(
    (item) => item.token.toLowerCase() === launch.token.toLowerCase(),
  );

  if (existingIdx >= 0) {
    registry.launches[existingIdx] = launch;
  } else {
    registry.launches.unshift(launch);
  }

  await saveRegistry(registry);
  return launch;
}

export async function listPonsShareLaunches(limit = 100): Promise<PonsShareLaunchRecord[]> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('ponsshare_launches')
      .select(
        'token, name, symbol, description, logo, deployer, fee_wallet, fee_share_platform, fee_share_handle, transaction_hash, launched_at',
      )
      .order('launched_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as LaunchRow[]).map(rowToLaunch);
  }

  const registry = await ensureRegistry();
  return registry.launches.slice(0, limit);
}

export async function listPonsShareLaunchesForFeeHandle(
  handle: string,
  platform?: SocialPlatform,
  limit = 100,
): Promise<PonsShareLaunchRecord[]> {
  const normalized = normalizeHandle(handle);

  if (isSupabaseConfigured()) {
    let query = supabase
      .from('ponsshare_launches')
      .select(
        'token, name, symbol, description, logo, deployer, fee_wallet, fee_share_platform, fee_share_handle, transaction_hash, launched_at',
      )
      .eq('fee_share_handle', normalized)
      .order('launched_at', { ascending: false })
      .limit(limit);

    if (platform) {
      query = query.eq('fee_share_platform', platform);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as LaunchRow[]).map(rowToLaunch);
  }

  const registry = await ensureRegistry();
  return registry.launches
    .filter((launch) => {
      if (launch.feeShareHandle?.toLowerCase() !== normalized) return false;
      if (platform && launch.feeSharePlatform && launch.feeSharePlatform !== platform) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

export async function listPonsShareLaunchesForWallet(
  walletAddress: string,
  limit = 100,
): Promise<PonsShareLaunchRecord[]> {
  const wallet = walletAddress.toLowerCase();

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('ponsshare_launches')
      .select(
        'token, name, symbol, description, logo, deployer, fee_wallet, fee_share_platform, fee_share_handle, transaction_hash, launched_at',
      )
      .or(`fee_wallet.eq.${wallet},deployer.eq.${wallet}`)
      .order('launched_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as LaunchRow[]).map(rowToLaunch);
  }

  const registry = await ensureRegistry();
  return registry.launches
    .filter(
      (launch) =>
        launch.feeWallet.toLowerCase() === wallet ||
        launch.deployer.toLowerCase() === wallet,
    )
    .slice(0, limit);
}
