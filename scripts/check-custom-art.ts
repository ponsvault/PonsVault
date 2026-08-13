/**
 * Walks the bring-your-own-art path the whole way: pin a pack, create a series pointed at it, mint a
 * seat, and read the metadata back out of tokenURI.
 *
 * Only the Originals path had been proven end to end. This one uploads real files to Pinata (a small
 * supply, so it barely touches quota) and then puts the resulting base URI on-chain on a mainnet
 * fork, which is the part that catches a base URI that does not line up with `tokenURI(id)`.
 *
 * Usage: KEEPER_KEY=0x… npm run seats:check-custom-art
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import { ipfsToGateway } from '@/lib/utils';
import {
  ERC721_ABI,
  PONS_SEAT_AMM_ABI,
  PONS_SEAT_SERIES_FACTORY_ABI,
  PONS_SEAT_SERIES_REGISTRY_ABI,
} from '@/lib/seats/abis';
import { buildCreateSeriesArgs } from '@/lib/seats/create-series';
import { PONS_SEAT_DEPLOYMENT } from '@/lib/seats/deployments';
import { uploadSeatMetadataPack } from '@/lib/seats/metadata-upload';

const MAINNET_RPC = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const PORT = 8552;
const RPC = `http://127.0.0.1:${PORT}`;
const SUPPLY = 5;

/** foundry installs outside the default PATH of a non-login shell often enough to be worth this. */
function anvilBin() {
  const installed = `${homedir()}/.foundry/bin/anvil`;
  return existsSync(installed) ? installed : 'anvil';
}

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`   ${ok ? 'OK  ' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}
function step(label: string) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}`);
}

/** A tiny valid PNG, so the run does not depend on a file being left lying around. */
function makeArtwork(): File {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAK0lEQVR42mNkYPhfz0AEYBxVSF+F' +
      'jIyM/xkYGP4zMjIyMDAwMDAwMDAAAB0nBgWq1jsxAAAAAElFTkSuQmCC',
    'base64',
  );
  return new File([new Uint8Array(png)], 'seat-art.png', { type: 'image/png' });
}

async function waitForChain(client: PublicClient) {
  for (let i = 0; i < 60; i += 1) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('anvil did not come up');
}

async function fetchJson(uri: string) {
  const res = await fetch(ipfsToGateway(uri));
  if (!res.ok) throw new Error(`${uri} returned ${res.status}`);
  return res.json();
}

async function main() {
  const key = process.env.KEEPER_KEY as Hex | undefined;
  if (!key) throw new Error('set KEEPER_KEY');
  const creator = privateKeyToAccount(key);

  step('pin a pack of custom art');
  // Retries of the on-chain half should not burn pinning quota again.
  const reuse = process.env.REUSE_BASE_URI;
  const pack = reuse
    ? { baseTokenURI: reuse, imageUri: process.env.REUSE_IMAGE_URI ?? '', metadataCount: SUPPLY }
    : await uploadSeatMetadataPack({
        image: makeArtwork(),
        imageFilename: 'seat-art.png',
        name: 'Custom Art Check',
        symbol: 'CAC',
        description: 'A throwaway series used to prove the upload path.',
        maxSupply: SUPPLY,
      });
  if (reuse) console.log('   reusing an already pinned pack');
  console.log(`   image ${pack.imageUri}`);
  console.log(`   base  ${pack.baseTokenURI}`);
  check(pack.baseTokenURI.endsWith('/'), 'the base URI ends in a slash, so tokenURI can append an id');
  check(pack.metadataCount === SUPPLY, 'one metadata file per seat was pinned');

  step('the pinned files are actually readable');
  const first = await fetchJson(`${pack.baseTokenURI}1`);
  const last = await fetchJson(`${pack.baseTokenURI}${SUPPLY}`);
  check(first.name === 'Custom Art Check #1', 'seat 1 metadata came back with the right name');
  check(last.name === `Custom Art Check #${SUPPLY}`, 'the last seat in the pack resolves too');
  check(
    typeof first.image === 'string' && first.image.startsWith('ipfs://'),
    'the metadata points at the uploaded artwork',
  );
  const art = await fetch(ipfsToGateway(first.image));
  check(art.ok, 'the artwork itself is served from the gateway');

  step('put it on-chain and read it back');
  const upstream = createPublicClient({ transport: http(MAINNET_RPC, { retryCount: 8, retryDelay: 2_000 }) });
  const forkBlock = process.env.FORK_BLOCK ?? (await upstream.getBlockNumber()).toString();
  const anvil = spawn(
    anvilBin(),
    [
      '--fork-url',
      MAINNET_RPC,
      '--fork-block-number',
      forkBlock,
      '--retries',
      '10',
      '--fork-retry-backoff',
      '5',
      '--compute-units-per-second',
      '40',
      '--port',
      String(PORT),
      '--silent',
    ],
    { stdio: 'inherit' },
  );

  try {
    const client = createPublicClient({ transport: http(RPC) });
    await waitForChain(client);
    await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'anvil_setBalance',
        params: [creator.address, '0xDE0B6B3A7640000'],
      }),
    });
    const wallet = createWalletClient({ account: creator, transport: http(RPC), chain: robinhoodChain });

    // A series that mints its own fuel: the fuel launch is proven elsewhere, and this run is about
    // whether custom art survives the trip on-chain.
    const hash = await wallet.writeContract({
      account: creator,
      chain: robinhoodChain,
      address: PONS_SEAT_DEPLOYMENT.factory as Address,
      abi: PONS_SEAT_SERIES_FACTORY_ABI,
      functionName: 'createSeries',
      args: [
        buildCreateSeriesArgs({
          name: 'Custom Art Check',
          symbol: 'CAC',
          tokenName: 'Custom Art Fuel',
          tokenSymbol: 'CACF',
          baseTokenURI: pack.baseTokenURI,
          maxSupply: BigInt(SUPPLY),
          seatPrice: parseEther('1000'),
          protocolTreasury: PONS_SEAT_DEPLOYMENT.protocolTreasury as Address,
        }),
      ],
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('createSeries reverted');
    const created = parseEventLogs({
      abi: PONS_SEAT_SERIES_FACTORY_ABI,
      logs: receipt.logs,
      eventName: 'SeriesCreated',
    })[0];
    const seriesId = created?.args.seriesId;
    if (seriesId === undefined) throw new Error('no SeriesCreated event');

    const [, fuel, collection, amm] = await client.readContract({
      address: PONS_SEAT_DEPLOYMENT.registry as Address,
      abi: PONS_SEAT_SERIES_REGISTRY_ABI,
      functionName: 'series',
      args: [seriesId],
    });
    check(collection !== zeroAddress, `series ${seriesId} was created with the pinned base URI`);

    const approve = await wallet.writeContract({
      account: creator,
      chain: robinhoodChain,
      address: fuel,
      abi: erc20Abi,
      functionName: 'approve',
      args: [amm, parseEther('100000')],
    });
    await client.waitForTransactionReceipt({ hash: approve });
    const buy = await wallet.writeContract({
      account: creator,
      chain: robinhoodChain,
      address: amm,
      abi: PONS_SEAT_AMM_ABI,
      functionName: 'buy',
      value: parseEther('0.0015'),
    });
    const bought = await client.waitForTransactionReceipt({ hash: buy });
    if (bought.status !== 'success') throw new Error('buy reverted');

    const tokenUri = await client.readContract({
      address: collection,
      abi: ERC721_ABI,
      functionName: 'tokenURI',
      args: [1n],
    });
    console.log(`   tokenURI(1) = ${tokenUri}`);
    check(tokenUri === `${pack.baseTokenURI}1`, 'tokenURI(1) points straight at the pinned file');

    const onChainMeta = await fetchJson(tokenUri);
    check(onChainMeta.name === 'Custom Art Check #1', 'a marketplace reading the chain gets the art back');

    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
    if (failures > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`\n  FAIL  ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    anvil.kill('SIGTERM');
  }
}

void main();
