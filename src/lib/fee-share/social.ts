import type { SocialPlatform } from './types';

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

export function toCustomUserId(platform: SocialPlatform, handle: string): string {
  return `${platform}:${normalizeHandle(handle)}`;
}

export function isValidTwitterHandle(handle: string): boolean {
  const normalized = normalizeHandle(handle);
  return /^[0-9a-z_]{1,15}$/i.test(normalized);
}

export function isValidGithubHandle(handle: string): boolean {
  const normalized = normalizeHandle(handle);
  return /^(?!-)(?!.*--)[a-z0-9-]{1,39}(?<!-)$/i.test(normalized);
}

export function isValidSocialHandle(platform: SocialPlatform, handle: string): boolean {
  if (platform === 'twitter') return isValidTwitterHandle(handle);
  if (platform === 'github') return isValidGithubHandle(handle);
  return normalizeHandle(handle).length > 0;
}

export function displayHandle(platform: SocialPlatform, handle: string): string {
  if (platform === 'twitter') return `@${normalizeHandle(handle)}`;
  if (platform === 'github') return normalizeHandle(handle);
  return normalizeHandle(handle);
}
