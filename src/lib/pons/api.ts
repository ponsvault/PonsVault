import type { PonsLaunchpadStatus, PonsLaunchRecord } from './types';
import { readResponseJson } from './pons-http';

async function readJson<T>(res: Response): Promise<T> {
  const data = await readResponseJson<T & { error?: string }>(res);
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data;
}

async function readUploadJson(res: Response): Promise<{ uri: string }> {
  let data: { uri?: string; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new Error(`Image upload failed (${res.status}). Paste an ipfs:// URI instead.`);
  }
  if (!res.ok || !data.uri) {
    throw new Error(data.error ?? `Image upload failed (${res.status}). Paste an ipfs:// URI instead.`);
  }
  return { uri: data.uri };
}

export async function fetchLaunchpadStatus(): Promise<PonsLaunchpadStatus> {
  const res = await fetch('/api/pons/status', { cache: 'no-store' });
  return readJson<PonsLaunchpadStatus>(res);
}

export async function uploadTokenImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);

  const res = await fetch('/api/pons/ipfs', { method: 'POST', body: form });
  const data = await readUploadJson(res);
  return data.uri;
}

export async function verifyLaunchedToken(token: string): Promise<void> {
  const res = await fetch('/api/pons/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  await readJson(res);
}

export async function fetchRecentLaunches(): Promise<PonsLaunchRecord[]> {
  const res = await fetch('/api/pons/launches?kind=latest', { cache: 'no-store' });
  return readJson<PonsLaunchRecord[]>(res);
}

export async function fetchTokenDetail(token: string): Promise<import('./types').TokenDetailResponse> {
  const res = await fetch(`/api/pons/token/${token}`, { cache: 'no-store' });
  return readJson(res);
}

export async function fetchSwapQuote(params: {
  token: string;
  side: 'buy' | 'sell';
  amount: string;
}): Promise<import('./types').SwapQuoteResponse> {
  const query = new URLSearchParams({
    token: params.token,
    side: params.side,
    amount: params.amount,
  });
  const res = await fetch(`/api/pons/quote?${query.toString()}`, { cache: 'no-store' });
  return readJson(res);
}
