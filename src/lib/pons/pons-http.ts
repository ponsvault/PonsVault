import { PONS_API_BASE } from './constants';

export class PonsApiBlockedError extends Error {
  constructor(message = 'pons.family API blocked by Cloudflare. Using on-chain fallback.') {
    super(message);
    this.name = 'PonsApiBlockedError';
  }
}

export function isHtmlResponse(body: string, contentType: string | null): boolean {
  const ct = contentType?.toLowerCase() ?? '';
  if (ct.includes('text/html')) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html');
}

export async function readResponseJson<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type');
  const body = await res.text();

  if (isHtmlResponse(body, contentType)) {
    throw new PonsApiBlockedError(
      `Expected JSON from ${res.url || 'upstream'} but received HTML (status ${res.status}).`,
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Invalid JSON from upstream (status ${res.status}).`);
  }
}

const BROWSER_HEADERS: HeadersInit = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: PONS_API_BASE,
  Referer: `${PONS_API_BASE}/launchpad/create`,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export async function fetchPonsApi(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${PONS_API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...BROWSER_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

export async function tryFetchPonsJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetchPonsApi(path, init);
    if (!res.ok) return null;
    return await readResponseJson<T>(res);
  } catch {
    // Network errors, Cloudflare HTML, DNS failures — fall back to on-chain reads.
    return null;
  }
}
