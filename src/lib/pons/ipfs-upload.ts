import { fetchPonsApi, isHtmlResponse, readResponseJson } from './pons-http';
import { PONS_API_BASE } from './constants';

export type IpfsUploadSource = 'pons' | 'pinata';

export interface IpfsUploadResult {
  uri: string;
  source: IpfsUploadSource;
}

function ponsApiBase(): string {
  return process.env.PONS_API_BASE?.replace(/\/$/, '') || PONS_API_BASE;
}

async function uploadViaPons(file: File | Blob, filename: string): Promise<IpfsUploadResult> {
  const form = new FormData();
  form.append('image', file, filename);

  const res = await fetchPonsApi('/api/ipfs/image', {
    method: 'POST',
    body: form,
    baseUrl: ponsApiBase(),
  });

  const contentType = res.headers.get('content-type');
  const raw = await res.text();

  if (isHtmlResponse(raw, contentType)) {
    throw new Error('pons image upload blocked by Cloudflare');
  }

  let data: { uri?: string; error?: string };
  try {
    data = JSON.parse(raw) as { uri?: string; error?: string };
  } catch {
    throw new Error(`pons image upload returned invalid JSON (${res.status})`);
  }

  if (!res.ok || !data.uri) {
    throw new Error(data.error ?? `pons image upload failed (${res.status})`);
  }

  return { uri: data.uri, source: 'pons' };
}

async function uploadViaPinata(file: File | Blob, filename: string): Promise<IpfsUploadResult> {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) {
    throw new Error('PINATA_JWT is not configured');
  }

  const form = new FormData();
  form.append('file', file, filename);

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  const data = await readResponseJson<{ IpfsHash?: string; error?: string }>(res);
  if (!res.ok || !data.IpfsHash) {
    throw new Error(data.error ?? 'Pinata upload failed');
  }

  return { uri: `ipfs://${data.IpfsHash}`, source: 'pinata' };
}

/** Try pons `/api/ipfs/image` first, then Pinata when pons is unreachable. */
export async function uploadTokenImageFile(
  file: File | Blob,
  filename: string,
): Promise<IpfsUploadResult> {
  try {
    return await uploadViaPons(file, filename);
  } catch (ponsError) {
    try {
      return await uploadViaPinata(file, filename);
    } catch (pinataError) {
      const ponsMessage =
        ponsError instanceof Error ? ponsError.message : 'pons upload failed';
      const pinataMessage =
        pinataError instanceof Error ? pinataError.message : 'pinata upload failed';

      throw new Error(
        `Image upload failed. pons: ${ponsMessage}. fallback: ${pinataMessage}. Paste an ipfs:// URI instead.`,
      );
    }
  }
}
