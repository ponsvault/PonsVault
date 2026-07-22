import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import type { VaultTemplateId } from '@/lib/pons/vault';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { PonsVaultLaunchRecord, PonsVaultLaunchRegistryFile } from './types';

const REGISTRY_PATH = path.join(process.cwd(), 'data', 'ponsvault-launches.json');

type LaunchRow = {
  token: string;
  name: string;
  symbol: string;
  description: string;
  logo: string;
  deployer: string;
  fee_wallet: string;
  vault: string | null;
  vault_template: VaultTemplateId | null;
  transaction_hash: string;
  launched_at: string;
};

const LAUNCH_COLUMNS =
  'token, name, symbol, description, logo, deployer, fee_wallet, vault, vault_template, transaction_hash, launched_at';

function rowToLaunch(row: LaunchRow): PonsVaultLaunchRecord {
  return {
    token: row.token,
    name: row.name,
    symbol: row.symbol,
    description: row.description,
    logo: row.logo,
    deployer: row.deployer,
    feeWallet: row.fee_wallet as `0x${string}`,
    vault: row.vault ?? undefined,
    vaultTemplate: row.vault_template ?? undefined,
    transactionHash: row.transaction_hash as `0x${string}`,
    launchedAt: row.launched_at,
  };
}

function launchToRow(launch: PonsVaultLaunchRecord): LaunchRow {
  return {
    token: launch.token.toLowerCase(),
    name: launch.name,
    symbol: launch.symbol,
    description: launch.description,
    logo: launch.logo,
    deployer: launch.deployer.toLowerCase(),
    fee_wallet: launch.feeWallet.toLowerCase(),
    vault: launch.vault ? launch.vault.toLowerCase() : null,
    vault_template: launch.vaultTemplate ?? null,
    transaction_hash: launch.transactionHash,
    launched_at: launch.launchedAt,
  };
}

async function ensureRegistry(): Promise<PonsVaultLaunchRegistryFile> {
  await mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as PonsVaultLaunchRegistryFile;
  } catch {
    const empty: PonsVaultLaunchRegistryFile = { launches: [] };
    await writeFile(REGISTRY_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
}

async function saveRegistry(registry: PonsVaultLaunchRegistryFile): Promise<void> {
  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export async function recordPonsVaultLaunch(
  launch: PonsVaultLaunchRecord,
): Promise<PonsVaultLaunchRecord> {
  if (isSupabaseConfigured()) {
    const row = launchToRow(launch);
    const { data, error } = await supabase
      .from('ponsvault_launches')
      .upsert(row, { onConflict: 'token' })
      .select(LAUNCH_COLUMNS)
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

export async function getPonsVaultLaunchByToken(
  token: string,
): Promise<PonsVaultLaunchRecord | null> {
  const normalized = token.toLowerCase();

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('ponsvault_launches')
      .select(LAUNCH_COLUMNS)
      .eq('token', normalized)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? rowToLaunch(data as LaunchRow) : null;
  }

  const registry = await ensureRegistry();
  return (
    registry.launches.find((item) => item.token.toLowerCase() === normalized) ?? null
  );
}

export async function listPonsVaultLaunches(limit = 100): Promise<PonsVaultLaunchRecord[]> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('ponsvault_launches')
      .select(LAUNCH_COLUMNS)
      .order('launched_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as LaunchRow[]).map(rowToLaunch);
  }

  const registry = await ensureRegistry();
  return registry.launches.slice(0, limit);
}
