import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface FeeClaimRecord {
  token: string;
  feeWalletId: string;
  walletAddress: string;
  privyUserId: string;
  claimTransactionHash: string | null;
  claimedAt: string;
}

type FeeClaimRow = {
  token: string;
  fee_wallet_id: string;
  wallet_address: string;
  privy_user_id: string;
  claim_transaction_hash: string | null;
  claimed_at: string;
};

function rowToClaim(row: FeeClaimRow): FeeClaimRecord {
  return {
    token: row.token,
    feeWalletId: row.fee_wallet_id,
    walletAddress: row.wallet_address,
    privyUserId: row.privy_user_id,
    claimTransactionHash: row.claim_transaction_hash,
    claimedAt: row.claimed_at,
  };
}

export async function recordFeeClaim(input: {
  token: string;
  feeWalletId: string;
  walletAddress: string;
  privyUserId: string;
  claimTransactionHash?: string;
}): Promise<FeeClaimRecord> {
  if (!isSupabaseConfigured()) {
    throw new Error('Fee claim tracking requires Supabase.');
  }

  const { data, error } = await supabase
    .from('fee_claims')
    .upsert(
      {
        token: input.token.toLowerCase(),
        fee_wallet_id: input.feeWalletId,
        wallet_address: input.walletAddress.toLowerCase(),
        privy_user_id: input.privyUserId,
        claim_transaction_hash: input.claimTransactionHash ?? null,
        claimed_at: new Date().toISOString(),
      },
      { onConflict: 'token,fee_wallet_id' },
    )
    .select(
      'token, fee_wallet_id, wallet_address, privy_user_id, claim_transaction_hash, claimed_at',
    )
    .single();

  if (error) throw new Error(error.message);
  return rowToClaim(data as FeeClaimRow);
}

export async function listFeeClaimsForWalletId(
  feeWalletId: string,
): Promise<FeeClaimRecord[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('fee_claims')
    .select(
      'token, fee_wallet_id, wallet_address, privy_user_id, claim_transaction_hash, claimed_at',
    )
    .eq('fee_wallet_id', feeWalletId)
    .order('claimed_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data as FeeClaimRow[]).map(rowToClaim);
}

export async function listFeeClaimsForTokens(
  tokens: string[],
): Promise<FeeClaimRecord[]> {
  if (!isSupabaseConfigured() || tokens.length === 0) return [];

  const normalized = tokens.map((token) => token.toLowerCase());
  const { data, error } = await supabase
    .from('fee_claims')
    .select(
      'token, fee_wallet_id, wallet_address, privy_user_id, claim_transaction_hash, claimed_at',
    )
    .in('token', normalized);

  if (error) throw new Error(error.message);
  return (data as FeeClaimRow[]).map(rowToClaim);
}
