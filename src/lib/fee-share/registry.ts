import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import type { FeeShareRegistryFile, FeeShareWalletRecord, SocialPlatform } from './types';
import { decryptPrivateKey, encryptPrivateKey } from './wallet-crypto';
import { normalizeHandle } from './social';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const REGISTRY_PATH = path.join(process.cwd(), 'data', 'fee-share-registry.json');

const WALLET_SELECT =
  'id, platform, handle, custom_user_id, privy_user_id, privy_wallet_id, wallet_address, private_key, linked_at, created_at';

type FeeShareWalletRow = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  custom_user_id: string;
  privy_user_id: string | null;
  privy_wallet_id: string | null;
  wallet_address: string;
  private_key: string;
  linked_at: string | null;
  created_at: string;
};

function rowToRecord(row: FeeShareWalletRow): FeeShareWalletRecord {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    customUserId: row.custom_user_id,
    privyUserId: row.privy_user_id,
    privyWalletId: row.privy_wallet_id,
    walletAddress: row.wallet_address as `0x${string}`,
    privateKey: decryptPrivateKey(row.private_key),
    linkedAt: row.linked_at,
    createdAt: row.created_at,
    launches: [],
  };
}

function persistPrivateKey(privateKey: string): string {
  return encryptPrivateKey(privateKey);
}

function hydrateWalletRecord(record: FeeShareWalletRecord): FeeShareWalletRecord {
  if (!record.privateKey) return record;
  return {
    ...record,
    privateKey: decryptPrivateKey(record.privateKey),
  };
}

function serializeWalletRecord(record: FeeShareWalletRecord): FeeShareWalletRecord {
  if (!record.privateKey) return record;
  return {
    ...record,
    privateKey: persistPrivateKey(record.privateKey),
  };
}

async function ensureRegistry(): Promise<FeeShareRegistryFile> {
  await mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as FeeShareRegistryFile;
  } catch {
    const empty: FeeShareRegistryFile = { wallets: [] };
    await writeFile(REGISTRY_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
}

async function saveRegistry(registry: FeeShareRegistryFile): Promise<void> {
  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

async function getFeeShareWalletFromJson(
  platform: SocialPlatform,
  handle: string,
): Promise<FeeShareWalletRecord | null> {
  const registry = await ensureRegistry();
  const normalized = normalizeHandle(handle);
  const wallet = registry.wallets.find(
    (w) => w.platform === platform && w.handle === normalized,
  );
  return wallet ? hydrateWalletRecord(wallet) : null;
}

async function upsertFeeShareWalletToJson(
  record: FeeShareWalletRecord,
): Promise<FeeShareWalletRecord> {
  const registry = await ensureRegistry();
  const stored = serializeWalletRecord(record);
  const idx = registry.wallets.findIndex(
    (w) => w.platform === record.platform && w.handle === record.handle,
  );
  if (idx >= 0) registry.wallets[idx] = stored;
  else registry.wallets.push(stored);
  await saveRegistry(registry);
  return hydrateWalletRecord(stored);
}

export async function getFeeShareWallet(
  platform: SocialPlatform,
  handle: string,
): Promise<FeeShareWalletRecord | null> {
  const normalized = normalizeHandle(handle);

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('fee_share_wallets')
      .select(WALLET_SELECT)
      .eq('platform', platform)
      .eq('handle', normalized)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? rowToRecord(data as FeeShareWalletRow) : null;
  }

  return getFeeShareWalletFromJson(platform, normalized);
}

export async function upsertFeeShareWallet(
  record: FeeShareWalletRecord,
): Promise<FeeShareWalletRecord> {
  if (isSupabaseConfigured()) {
    if (!record.privateKey) {
      throw new Error('Cannot persist fee wallet without private key.');
    }

    const { data, error } = await supabase
      .from('fee_share_wallets')
      .upsert(
        {
          platform: record.platform,
          handle: record.handle,
          custom_user_id: record.customUserId,
          privy_user_id: record.privyUserId,
          privy_wallet_id: record.privyWalletId,
          wallet_address: record.walletAddress.toLowerCase(),
          private_key: persistPrivateKey(record.privateKey),
          linked_at: record.linkedAt,
          created_at: record.createdAt,
        },
        { onConflict: 'platform,handle' },
      )
      .select(WALLET_SELECT)
      .single();

    if (error) throw new Error(error.message);
    return rowToRecord(data as FeeShareWalletRow);
  }

  return upsertFeeShareWalletToJson(record);
}

export async function listClaimedFeeShareWalletKeys(): Promise<Set<string>> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('fee_share_wallets')
      .select('platform, handle')
      .not('linked_at', 'is', null);

    if (error) throw new Error(error.message);

    return new Set(
      (data ?? []).map((row) => `${row.platform}:${row.handle}`),
    );
  }

  const registry = await ensureRegistry();
  return new Set(
    registry.wallets
      .filter((wallet) => wallet.linkedAt)
      .map((wallet) => `${wallet.platform}:${wallet.handle}`),
  );
}

export async function recordFeeShareLaunch(input: {
  platform: SocialPlatform;
  handle: string;
  token: string;
  symbol: string;
  name: string;
  transactionHash: string;
}): Promise<void> {
  if (isSupabaseConfigured()) {
    return;
  }

  const existing = await getFeeShareWalletFromJson(input.platform, input.handle);
  if (!existing) return;

  existing.launches.unshift({
    token: input.token,
    symbol: input.symbol,
    name: input.name,
    transactionHash: input.transactionHash,
    launchedAt: new Date().toISOString(),
  });

  await upsertFeeShareWalletToJson(existing);
}
