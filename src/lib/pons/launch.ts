import {
  encodeFunctionData,
  formatEther,
  getAddress,
  isAddress,
  keccak256,
  parseEther,
  parseUnits,
  toHex,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from 'viem';

import { PONS_LAUNCHPAD_ABI } from './abi';
import {
  PONS_DEFAULT_CONFIG_ID,
  PONS_DEFAULT_DEX_ID,
  PONS_FACTORY,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_SYMBOL_MAX_LENGTH,
} from './constants';
import { computeMaxDevBuyWei, formatMaxDevBuyEth } from './max-dev-buy';
import type { LaunchFormInput, PonsLaunchMetadata, PonsLaunchpadStatus } from './types';
import { findV2PairToken } from './v2-deployments';
import { validateV2VaultInput } from './v2-vault';
import { validateVaultInput } from './vault';

const TOKEN_NAME_RE = /^[A-Za-z0-9 ]+$/;
const TOKEN_SYMBOL_RE = /^[A-Za-z0-9]+$/;
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const TELEGRAM_HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;

export function isValidIpfsUri(uri: string): boolean {
  return /^ipfs:\/\/[a-zA-Z0-9]+/.test(uri.trim());
}

export function isValidTokenName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= TOKEN_NAME_MAX_LENGTH && TOKEN_NAME_RE.test(trimmed);
}

export function isValidTokenSymbol(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= TOKEN_SYMBOL_MAX_LENGTH && TOKEN_SYMBOL_RE.test(trimmed);
}

export function isValidXHandle(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || X_HANDLE_RE.test(trimmed.replace(/^@/, ''));
}

export function isValidTelegramHandle(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || TELEGRAM_HANDLE_RE.test(trimmed.replace(/^@/, ''));
}

export function isValidWebsiteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isValidEthAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isAddress(trimmed, { strict: false });
}

export function normalizeEthAddress(value: string): `0x${string}` {
  return getAddress(value.trim()) as `0x${string}`;
}

export function normalizeTokenName(value: string): string {
  return value
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/ {2,}/g, ' ')
    .slice(0, TOKEN_NAME_MAX_LENGTH);
}

export function normalizeTokenSymbol(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TOKEN_SYMBOL_MAX_LENGTH);
}

function normalizeSocialHandle(
  value: string,
  hosts: string[],
): string {
  let handle = value.trim().replace(/^@/, '');
  try {
    const candidate = /^https?:\/\//i.test(handle) ? handle : `https://${handle}`;
    const url = new URL(candidate);
    if (hosts.includes(url.hostname.toLowerCase())) {
      handle = url.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    }
  } catch {
    // Keep raw handle when URL parsing fails.
  }
  return handle.replace(/^\/+/, '');
}

export function normalizeTwitter(value: string): string {
  const handle = normalizeSocialHandle(value, [
    'x.com',
    'www.x.com',
    'twitter.com',
    'www.twitter.com',
  ]);
  if (!handle) return '';
  return `https://x.com/${handle}`;
}

export function normalizeTelegram(value: string): string {
  const handle = normalizeSocialHandle(value, [
    't.me',
    'www.t.me',
    'telegram.me',
    'www.telegram.me',
  ]);
  if (!handle) return '';
  return `https://t.me/${handle}`;
}

export function generateLaunchSalt(symbol: string): Hex {
  const seed = `${symbol}:${Date.now()}:${Math.random()}`;
  return keccak256(toHex(seed));
}

export function buildLaunchMetadata(
  input: LaunchFormInput,
  connectedAddress: `0x${string}`,
  feeWalletOverride?: `0x${string}`,
): PonsLaunchMetadata {
  const feeWallet = feeWalletOverride ?? connectedAddress;

  return {
    name: normalizeTokenName(input.name),
    symbol: normalizeTokenSymbol(input.symbol),
    logo: input.imageUri.trim(),
    description: input.description.trim(),
    socials: {
      twitter: normalizeTwitter(input.twitter),
      telegram: normalizeTelegram(input.telegram),
      discord: '',
      website: input.website.trim(),
      farcaster: '',
    },
    feeWallet,
  };
}

export function validateLaunchInput(
  input: LaunchFormInput,
  status: PonsLaunchpadStatus | undefined,
): string | null {
  if (!isValidTokenName(input.name)) {
    return 'Token names must use letters, numbers, and spaces with at most 32 characters.';
  }
  if (!isValidTokenSymbol(input.symbol)) {
    return 'Token symbols must use letters and numbers with at most 10 characters.';
  }
  if (!isValidIpfsUri(input.imageUri)) {
    return 'Upload an image or provide a valid ipfs:// URI.';
  }
  if (!isValidXHandle(input.twitter)) {
    return 'X handle is invalid.';
  }
  if (!isValidTelegramHandle(input.telegram)) {
    return 'Telegram handle is invalid.';
  }
  if (!isValidWebsiteUrl(input.website)) {
    return 'Website must be a valid http(s) URL.';
  }

  // v2 launches carry a pair token; their vault config and launch gate differ from v1.
  if (input.pairToken.trim()) {
    const pair = findV2PairToken(input.pairToken);
    if (!pair) {
      return 'Choose an approved pairing asset.';
    }
    // Form passes live buybackHelperReady into validateV2VaultInput separately;
    // here we only reject structurally bad configs.
    const vaultError = validateV2VaultInput(input);
    if (vaultError) return vaultError;

    const initialBuy = input.devBuyEth.trim();
    if (initialBuy) {
      try {
        if (parseUnits(initialBuy, pair.decimals) < 0n) throw new Error('negative');
      } catch {
        return `Initial buy must be a valid ${pair.symbol} amount.`;
      }
    }
    return null;
  }

  const vaultError = validateVaultInput(input);
  if (vaultError) return vaultError;

  if (status) {
    const devBuyWei = parseDevBuyWei(input.devBuyEth);
    if (devBuyWei < 0n) return 'Developer buy must be zero or positive.';

    const maxDevBuy = computeMaxDevBuyWei(status);
    if (maxDevBuy > 0n && devBuyWei > maxDevBuy) {
      return `Developer buy cannot exceed ${formatMaxDevBuyEth(status)} ETH.`;
    }
  } else if (input.devBuyEth.trim()) {
    const devBuy = Number(input.devBuyEth);
    if (Number.isNaN(devBuy) || devBuy < 0) return 'Developer buy must be zero or positive.';
  }

  if (status && !status.launchEnabled) return 'Launches are currently disabled on pons.';

  return null;
}

function parseDevBuyWei(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  try {
    return parseEther(trimmed);
  } catch {
    return -1n;
  }
}

export function computeLaunchValue(
  status: PonsLaunchpadStatus,
  devBuyEth: string,
): bigint {
  const launchFee = BigInt(status.launchFeeWei);
  const devBuy = parseDevBuyWei(devBuyEth);
  return launchFee + (devBuy < 0n ? 0n : devBuy);
}

export function encodeLaunchTransaction(
  metadata: PonsLaunchMetadata,
  status: PonsLaunchpadStatus,
  devBuyEth: string,
  salt?: Hex,
) {
  void status;
  void devBuyEth;

  return encodeFunctionData({
    abi: PONS_LAUNCHPAD_ABI,
    functionName: 'launchToken',
    args: [
      {
        name: metadata.name,
        symbol: metadata.symbol,
        logo: metadata.logo,
        description: metadata.description,
        socials: metadata.socials,
        feeWallet: metadata.feeWallet,
      },
      PONS_DEFAULT_CONFIG_ID,
      PONS_DEFAULT_DEX_ID,
      salt ?? generateLaunchSalt(metadata.symbol),
    ],
  });
}

export function extractLaunchedToken(receipt: TransactionReceipt): `0x${string}` | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PONS_FACTORY.toLowerCase()) continue;
    if (log.topics.length < 2 || !log.topics[1]) continue;
    return `0x${log.topics[1].slice(26)}` as `0x${string}`;
  }
  return null;
}

export function formatLaunchSummary(
  status: PonsLaunchpadStatus,
  devBuyEth: string,
): string {
  const total = formatEther(computeLaunchValue(status, devBuyEth));
  return `${total} ETH total (${status.launchFeeEth} fee + ${devBuyEth || '0'} dev buy)`;
}

export function ponsTokenUrl(token: string): string {
  return `https://ponsfamily.com/launchpad/${token}`;
}

export function txUrl(hash: Hash): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

export { formatMaxDevBuyEth } from './max-dev-buy';
