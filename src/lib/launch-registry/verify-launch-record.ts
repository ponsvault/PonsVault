import { isAddress, type Address, type Hash } from 'viem';

import type { PonsShareLaunchRecord } from './types';
import { getFeeShareWallet } from '@/lib/fee-share/registry';
import type { SocialPlatform } from '@/lib/fee-share/types';
import { normalizeHandle } from '@/lib/fee-share/social';
import { resolveLaunchedToken } from '@/lib/pons/factory';
import { extractLaunchedToken } from '@/lib/pons/launch';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { readCreatorFeeRouting } from '@/lib/pons/token-state';

export async function verifyLaunchRecordOnChain(
  input: Pick<
    PonsShareLaunchRecord,
    'token' | 'transactionHash' | 'deployer' | 'feeWallet'
  >,
): Promise<void> {
  if (!isAddress(input.token)) {
    throw new Error('Invalid token address.');
  }
  if (!isAddress(input.deployer)) {
    throw new Error('Invalid deployer address.');
  }
  if (!isAddress(input.feeWallet)) {
    throw new Error('Invalid fee wallet address.');
  }

  const token = input.token as Address;
  const deployer = input.deployer as Address;
  const feeWallet = input.feeWallet as Address;
  const transactionHash = input.transactionHash as Hash;

  const resolved = await resolveLaunchedToken(token);
  if (!resolved) {
    throw new Error('Token is not registered on the pons factory.');
  }

  if (resolved.launched.deployer.toLowerCase() !== deployer.toLowerCase()) {
    throw new Error('Deployer does not match on-chain launch data.');
  }

  const routing = await readCreatorFeeRouting(
    token,
    resolved.launched.deployer,
    resolved.factory,
  );
  if (routing.creatorPayout.toLowerCase() !== feeWallet.toLowerCase()) {
    throw new Error('Fee wallet does not match on-chain fee routing.');
  }

  const [receipt, transaction] = await Promise.all([
    robinhoodPublicClient.getTransactionReceipt({ hash: transactionHash }),
    robinhoodPublicClient.getTransaction({ hash: transactionHash }),
  ]);

  if (!receipt || receipt.status !== 'success') {
    throw new Error('Launch transaction was not successful.');
  }

  if (!transaction || transaction.from.toLowerCase() !== deployer.toLowerCase()) {
    throw new Error('Launch transaction sender does not match deployer.');
  }

  const launchedToken = extractLaunchedToken(receipt);
  if (!launchedToken || launchedToken.toLowerCase() !== token.toLowerCase()) {
    throw new Error('Launch transaction does not match token address.');
  }
}

export async function verifyLaunchSocialFeeShare(input: {
  feeWallet: string;
  feeSharePlatform?: SocialPlatform | null;
  feeShareHandle?: string | null;
}): Promise<void> {
  if (!input.feeSharePlatform || !input.feeShareHandle?.trim()) {
    return;
  }

  const wallet = await getFeeShareWallet(
    input.feeSharePlatform,
    normalizeHandle(input.feeShareHandle),
  );
  if (
    wallet &&
    wallet.walletAddress.toLowerCase() !== input.feeWallet.toLowerCase()
  ) {
    throw new Error('Social fee-share handle does not match the on-chain fee wallet.');
  }
}

export async function verifyLaunchRecord(
  input: Pick<
    PonsShareLaunchRecord,
    | 'token'
    | 'transactionHash'
    | 'deployer'
    | 'feeWallet'
    | 'feeSharePlatform'
    | 'feeShareHandle'
  >,
): Promise<void> {
  await verifyLaunchRecordOnChain(input);
  await verifyLaunchSocialFeeShare(input);
}
