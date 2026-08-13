/**
 * Proves the blind sale the whole way round, on a fork, before any of it costs real ETH.
 *
 * A sealed series is only worth anything if three things hold at once: the pack cannot be guessed
 * from what is public, the chain shows every seat the same card until the sale ends, and the reveal
 * still produces exactly the pack that was committed. This run pins a real pack through the app,
 * deploys the current contracts on a fork, sells the series out, and reveals it.
 *
 * Usage: KEEPER_KEY=0x… npm run seats:check-sealed
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { robinhoodChain } from '@/lib/pons/chain';
import {
  PONS_SEAT_AMM_ABI,
  PONS_SEAT_COLLECTION_ABI,
  PONS_SEAT_SERIES_FACTORY_ABI,
  PONS_SEAT_SERIES_REGISTRY_ABI,
} from '@/lib/seats/abis';
import { buildCreateSeriesArgs } from '@/lib/seats/create-series';
import { buildOriginalsPack } from '@/lib/seats/originals-pack';
import { buildOriginalsAssignment } from '@/lib/seats/originals';
import { findPinByKeyvalue } from '@/lib/seats/pinata';
import { ipfsToGateway } from '@/lib/utils';

const MAINNET_RPC = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const PORT = 8553;
const RPC = `http://127.0.0.1:${PORT}`;
const SUPPLY = 3;
const NAME = 'Sealed Check';
const SYMBOL = 'SEALED';

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

async function rpc(method: string, params: unknown[]) {
  await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

/** Deploys the current seat infrastructure onto the fork and reads the addresses back out. */
function deployInfra(key: Hex): { factory: Address; registry: Address } {
  const out = execFileSync(
    `${homedir()}/.foundry/bin/forge`,
    ['script', 'script/DeployPonsSeats.s.sol', '--rpc-url', RPC, '--broadcast', '--slow'],
    { cwd: 'contracts', env: { ...process.env, PRIVATE_KEY: key }, encoding: 'utf8' },
  );
  const find = (label: string) => {
    const match = out.match(new RegExp(`${label}\\s+(0x[0-9a-fA-F]{40})`));
    if (!match) throw new Error(`deploy output had no ${label}`);
    return match[1] as Address;
  };
  return { factory: find('PonsSeatSeriesFactory'), registry: find('PonsSeatSeriesRegistry') };
}

async function main() {
  const key = process.env.KEEPER_KEY as Hex | undefined;
  if (!key) throw new Error('set KEEPER_KEY');
  const creator = privateKeyToAccount(key);

  step('pin a sealed pack the way the app does');
  const pack = await buildOriginalsPack({
    name: NAME,
    symbol: SYMBOL,
    description: 'A throwaway series used to prove the sealed sale.',
  });
  console.log(`   placeholder ${pack.placeholderUri}`);
  console.log(`   provenance  ${pack.provenanceHash}`);
  check(pack.placeholderUri.startsWith('ipfs://'), 'the sale runs against a pinned placeholder');
  check(/^0x[0-9a-f]{64}$/.test(pack.provenanceHash), 'the pack is committed to as a hash');

  const placeholder = await fetch(ipfsToGateway(pack.placeholderUri));
  check(placeholder.ok, 'the placeholder card resolves on the gateway');

  step('the layout cannot be worked out from what is public');
  const guess = buildOriginalsAssignment(`${SYMBOL}:${NAME}`);
  const real = buildOriginalsAssignment(`${SYMBOL}:${NAME}:${pack.salt}`);
  check(
    guess.some((variant, index) => variant.file !== real[index].file),
    'the name and ticker alone do not reproduce the pack',
  );

  step('deploy the current contracts on a fork');
  const upstream = createPublicClient({
    transport: http(MAINNET_RPC, { retryCount: 8, retryDelay: 2_000 }),
  });
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
    await rpc('anvil_setBalance', [creator.address, '0xDE0B6B3A7640000']);

    const { factory, registry } = deployInfra(key);
    console.log(`   factory ${factory}`);

    const wallet = createWalletClient({ account: creator, transport: http(RPC), chain: robinhoodChain });
    const send = async (hash: Hex, label: string) => {
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`${label} reverted`);
      return receipt;
    };

    step('create the series sealed');
    const created = await send(
      await wallet.writeContract({
        account: creator,
        chain: robinhoodChain,
        address: factory,
        abi: PONS_SEAT_SERIES_FACTORY_ABI,
        functionName: 'createSeries',
        args: [
          buildCreateSeriesArgs({
            name: NAME,
            symbol: SYMBOL,
            tokenName: 'Sealed Fuel',
            tokenSymbol: 'SEALEDF',
            baseTokenURI: pack.placeholderUri,
            provenanceHash: pack.provenanceHash,
            maxSupply: BigInt(SUPPLY),
            seatPrice: parseEther('1000'),
            protocolTreasury: creator.address,
          }),
        ],
      }),
      'createSeries',
    );
    const seriesId = parseEventLogs({
      abi: PONS_SEAT_SERIES_FACTORY_ABI,
      logs: created.logs,
      eventName: 'SeriesCreated',
    })[0]?.args.seriesId;
    if (seriesId === undefined) throw new Error('no SeriesCreated event');

    const [, fuel, collection, amm] = await client.readContract({
      address: registry,
      abi: PONS_SEAT_SERIES_REGISTRY_ABI,
      functionName: 'series',
      args: [seriesId],
    });
    check(collection !== zeroAddress, `series ${seriesId} was created`);

    const onChainHash = await client.readContract({
      address: collection,
      abi: PONS_SEAT_COLLECTION_ABI,
      functionName: 'provenanceHash',
    });
    check(onChainHash === pack.provenanceHash, 'the commitment is on-chain, before anyone can buy');

    step('every seat looks the same while it sells');
    await send(
      await wallet.writeContract({
        account: creator,
        chain: robinhoodChain,
        address: fuel,
        abi: erc20Abi,
        functionName: 'approve',
        args: [amm, parseEther('1000000')],
      }),
      'approve',
    );

    for (let i = 0; i < SUPPLY - 1; i += 1) {
      await send(
        await wallet.writeContract({
          account: creator,
          chain: robinhoodChain,
          address: amm,
          abi: PONS_SEAT_AMM_ABI,
          functionName: 'buy',
          value: parseEther('0.0015'),
        }),
        'buy',
      );
    }

    const sealedUris = await Promise.all(
      [1n, 2n].map((id) =>
        client.readContract({
          address: collection,
          abi: PONS_SEAT_COLLECTION_ABI,
          functionName: 'tokenURI',
          args: [id],
        }),
      ),
    );
    check(
      sealedUris.every((uri) => uri === pack.placeholderUri),
      'two different seats return the very same metadata',
    );
    check(
      !(await client.readContract({
        address: collection,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'revealable',
      })),
      'the art cannot be revealed while seats are still for sale',
    );

    step('sell it out, then reveal');
    await send(
      await wallet.writeContract({
        account: creator,
        chain: robinhoodChain,
        address: amm,
        abi: PONS_SEAT_AMM_ABI,
        functionName: 'buy',
        value: parseEther('0.0015'),
      }),
      'final buy',
    );
    check(
      await client.readContract({
        address: collection,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'revealable',
      }),
      'selling out opens the reveal',
    );

    // The same lookup the reveal endpoint does, against the same commitment the chain holds.
    const cid = await findPinByKeyvalue('provenance', onChainHash);
    if (!cid) throw new Error('the pinned pack could not be found by its commitment');
    const baseTokenURI = `ipfs://${cid}/`;
    check(keccak256(toHex(baseTokenURI)) === onChainHash, 'the pack found matches what was committed');

    await send(
      await wallet.writeContract({
        account: creator,
        chain: robinhoodChain,
        address: collection,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'reveal',
        args: [baseTokenURI],
      }),
      'reveal',
    );

    const revealedUris = await Promise.all(
      [1n, 2n, 3n].map((id) =>
        client.readContract({
          address: collection,
          abi: PONS_SEAT_COLLECTION_ABI,
          functionName: 'tokenURI',
          args: [id],
        }),
      ),
    );
    check(
      revealedUris.every((uri, index) => uri === `${baseTokenURI}${index + 1}`),
      'each seat now points at its own metadata file',
    );

    const metas = await Promise.all(
      revealedUris.map(async (uri) => (await fetch(ipfsToGateway(uri))).json()),
    );
    console.log(
      metas
        .map(
          (meta, index) =>
            `   seat ${index + 1}: ${meta.attributes?.map((a: { value: unknown }) => a.value).join(' / ')}`,
        )
        .join('\n'),
    );
    check(
      metas.every((meta) => typeof meta.image === 'string' && meta.image.startsWith('ipfs://')),
      'the revealed metadata carries real artwork',
    );
    check(
      new Set(metas.map((meta) => meta.name)).size === metas.length,
      'the seats are no longer identical',
    );

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
