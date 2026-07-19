import { displayHandle } from './social';
import type { SocialPlatform } from './types';
import { shortAddress } from '@/lib/utils';

export interface FeeShareInfo {
  feeWallet: string;
  deployer: string;
  feeSharePlatform?: SocialPlatform | null;
  feeShareHandle?: string | null;
}

export function hasFeeShareConfig(info: FeeShareInfo): boolean {
  if (info.feeSharePlatform && info.feeShareHandle) return true;
  return info.feeWallet.toLowerCase() !== info.deployer.toLowerCase();
}

export function describeFeeShare(info: FeeShareInfo): string {
  if (info.feeSharePlatform && info.feeShareHandle) {
    const label = displayHandle(info.feeSharePlatform, info.feeShareHandle);
    const platformLabel =
      info.feeSharePlatform === 'github'
        ? 'GitHub'
        : info.feeSharePlatform === 'twitter'
          ? 'X'
          : info.feeSharePlatform;
    return `Fees shared with ${label} on ${platformLabel}`;
  }

  if (info.feeWallet.toLowerCase() !== info.deployer.toLowerCase()) {
    return `Fees shared with ${shortAddress(info.feeWallet, 6)}`;
  }

  return 'Fees go to launcher wallet';
}

export function describeFeeShareShort(info: FeeShareInfo): string {
  if (info.feeSharePlatform && info.feeShareHandle) {
    return displayHandle(info.feeSharePlatform, info.feeShareHandle);
  }

  if (info.feeWallet.toLowerCase() !== info.deployer.toLowerCase()) {
    return shortAddress(info.feeWallet, 4);
  }

  return 'Launcher';
}
