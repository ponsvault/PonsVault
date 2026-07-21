import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'psh1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error(
    'FEE_WALLET_ENCRYPTION_KEY must be 32 bytes as base64 or a 64-character hex string.',
  );
}

function getEncryptionKey(): Buffer {
  const raw = process.env.FEE_WALLET_ENCRYPTION_KEY;
  if (!raw?.trim()) {
    throw new Error(
      'FEE_WALLET_ENCRYPTION_KEY is not configured. Generate one with: openssl rand -base64 32',
    );
  }

  return parseEncryptionKey(raw);
}

export function isEncryptedPrivateKey(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptPrivateKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptPrivateKey(stored: string): string {
  if (!isEncryptedPrivateKey(stored)) {
    return stored;
  }

  const payload = stored.slice(PREFIX.length);
  const [ivPart, tagPart, ciphertextPart] = payload.split(':');
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Stored private key is encrypted but malformed.');
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(ciphertextPart, 'base64url');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function assertWalletEncryptionConfigured(): void {
  getEncryptionKey();
}
