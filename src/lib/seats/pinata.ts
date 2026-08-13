/**
 * Shared Pinata folder pinning for seat series.
 *
 * Pinata counts every file inside a folder against the account file cap, not the folder as one pin.
 * A series pins one metadata file per seat, so a large run can exhaust the cap in a single launch —
 * and the raw API error does not say that. Translate it into something a creator can act on.
 */

export interface PinFolderOptions {
  /** How many files the form carries, used only to explain a quota failure. */
  fileCount: number;
  /** What is being pinned, e.g. "seat metadata". */
  label: string;
}

function pinataJwt(): string {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) throw new Error('PINATA_JWT is not configured, so seat art and metadata cannot be pinned.');
  return jwt;
}

export async function pinFolderToIpfs(form: FormData, options: PinFolderOptions): Promise<string> {
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJwt()}` },
    body: form,
  });

  let data: { IpfsHash?: string; error?: unknown };
  try {
    data = (await res.json()) as { IpfsHash?: string; error?: unknown };
  } catch {
    throw new Error(`Pinata returned an unreadable response while pinning ${options.label} (${res.status}).`);
  }

  if (res.ok && data.IpfsHash) return data.IpfsHash;

  const detail =
    typeof data.error === 'string'
      ? data.error
      : typeof data.error === 'object' && data.error !== null && 'reason' in data.error
        ? String((data.error as { reason: unknown }).reason)
        : JSON.stringify(data.error ?? res.statusText);

  if (/pin limit|exceed/i.test(detail)) {
    throw new Error(
      `Your Pinata plan cannot take the ${options.fileCount.toLocaleString()} files this series needs ` +
        `(one per seat, plus the art). Pinata counts every file in a folder against the account cap. ` +
        `Raise the plan limit or launch a smaller series, then try again — nothing was created on-chain.`,
    );
  }

  throw new Error(`Pinata could not pin ${options.label}: ${detail}`);
}

/** Pins one JSON file and returns its CID. */
export async function pinJsonToIpfs(
  content: unknown,
  metadata: { name: string; keyvalues?: Record<string, string> },
): Promise<string> {
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJwt()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinataContent: content, pinataMetadata: metadata }),
  });

  const data = (await res.json().catch(() => ({}))) as { IpfsHash?: string; error?: unknown };
  if (!res.ok || !data.IpfsHash) {
    throw new Error(`Pinata could not pin ${metadata.name}: ${JSON.stringify(data.error ?? res.statusText)}`);
  }
  return data.IpfsHash;
}

/**
 * Labels an existing pin, which is how a blind series stays blind.
 *
 * The tag can only be written after the pin exists, because it is derived from the CID, and the
 * lookup that reads it back needs the Pinata key. That keeps the finished pack off the public path
 * until the sale is over, while leaving it recoverable by whoever runs this app.
 */
export async function tagPin(cid: string, keyvalues: Record<string, string>): Promise<void> {
  const res = await fetch('https://api.pinata.cloud/pinning/hashMetadata', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${pinataJwt()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ipfsPinHash: cid, keyvalues }),
  });
  if (!res.ok) {
    throw new Error(`Pinata could not label pin ${cid} (${res.status}).`);
  }
}

/** Finds the most recent pin carrying a given label, or null when there is none. */
export async function findPinByKeyvalue(key: string, value: string): Promise<string | null> {
  const query = new URLSearchParams({
    status: 'pinned',
    pageLimit: '1',
    [`metadata[keyvalues][${key}]`]: JSON.stringify({ value, op: 'eq' }),
  });

  const res = await fetch(`https://api.pinata.cloud/data/pinList?${query}`, {
    headers: { Authorization: `Bearer ${pinataJwt()}` },
  });
  if (!res.ok) throw new Error(`Pinata pin lookup failed (${res.status}).`);

  const data = (await res.json()) as { rows?: Array<{ ipfs_pin_hash?: string }> };
  return data.rows?.[0]?.ipfs_pin_hash ?? null;
}
