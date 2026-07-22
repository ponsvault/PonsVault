import { isAddress, type Address, type Hash } from 'viem';

import type { PonsVaultLaunchRecord } from './types';
import { resolveLaunchedToken } from '@/lib/pons/factory';
import { extractLaunchedToken } from '@/lib/pons/launch';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { readCreatorFeeRouting } from '@/lib/pons/token-state';
import { PONSVAULT_LAUNCHER, isVaultLauncherDeployed } from '@/lib/pons/vault';

export async function verifyLaunchRecordOnChain(
  input: Pick<
    PonsVaultLaunchRecord,
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

  // A vault launch goes through PonsVaultLauncher, which becomes the token's
  // on-chain deployer so that fees can be swept permissionlessly. The creator is
  // then the transaction sender, which is still asserted below — so recording a
  // launch you did not send remains impossible.
  const onChainDeployer = resolved.launched.deployer.toLowerCase();
  const launchedViaVaultLauncher =
    isVaultLauncherDeployed() && onChainDeployer === PONSVAULT_LAUNCHER.toLowerCase();

  if (!launchedViaVaultLauncher && onChainDeployer !== deployer.toLowerCase()) {
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

export async function verifyLaunchRecord(
  input: Pick<
    PonsVaultLaunchRecord,
    'token' | 'transactionHash' | 'deployer' | 'feeWallet'
  >,
): Promise<void> {
  await verifyLaunchRecordOnChain(input);
}
