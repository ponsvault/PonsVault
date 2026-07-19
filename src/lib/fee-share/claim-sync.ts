import { parseAbiItem, type Address } from 'viem';

import { recordFeeClaim, listFeeClaimsForTokens } from '@/lib/fee-share/claims';
import { PONS_ACTIVE_LOCKER, PONS_ACTIVE_FACTORY_START_BLOCK } from '@/lib/pons/contracts';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { isSupabaseConfigured } from '@/lib/supabase';

const FEES_CLAIMED_EVENT = parseAbiItem(
  'event FeesClaimed(address indexed token, address indexed caller, address token0, address token1, uint256 recipientAmount0, uint256 recipientAmount1, uint256 protocolAmount0, uint256 protocolAmount1)',
);

const LOG_CHUNK = 250_000n;

export async function syncFeeClaimsForWallet(input: {
  tokens: string[];
  walletAddress: string;
  feeWalletId?: string;
  privyUserId: string;
  locker?: Address;
}): Promise<void> {
  if (!isSupabaseConfigured() || !input.feeWalletId || input.tokens.length === 0) {
    return;
  }

  const wallet = input.walletAddress.toLowerCase();
  const locker = input.locker ?? PONS_ACTIVE_LOCKER;
  const existing = await listFeeClaimsForTokens(input.tokens);
  const claimedTokens = new Set(existing.map((claim) => claim.token.toLowerCase()));

  for (const token of input.tokens) {
    const normalized = token.toLowerCase();
    if (claimedTokens.has(normalized)) continue;

    const txHash = await findFeeClaimTxForToken(token as Address, wallet, locker);
    if (!txHash) continue;

    await recordFeeClaim({
      token: normalized,
      feeWalletId: input.feeWalletId,
      walletAddress: wallet,
      privyUserId: input.privyUserId,
      claimTransactionHash: txHash,
    });
    claimedTokens.add(normalized);
  }
}

async function findFeeClaimTxForToken(
  token: Address,
  walletAddress: string,
  locker: Address,
): Promise<`0x${string}` | null> {
  const latest = await robinhoodPublicClient.getBlockNumber();
  let fromBlock = PONS_ACTIVE_FACTORY_START_BLOCK;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + LOG_CHUNK > latest ? latest : fromBlock + LOG_CHUNK;

    const logs = await robinhoodPublicClient.getLogs({
      address: locker,
      event: FEES_CLAIMED_EVENT,
      args: { token },
      fromBlock,
      toBlock,
    });

    const match = logs
      .slice()
      .reverse()
      .find((log) => log.args.caller?.toLowerCase() === walletAddress);

    if (match?.transactionHash) {
      return match.transactionHash;
    }

    fromBlock = toBlock + 1n;
  }

  return null;
}
