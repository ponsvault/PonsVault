'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ImageIcon, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  erc20Abi,
  formatUnits,
  parseEther,
  parseEventLogs,
  parseUnits,
  zeroAddress as ZERO_ADDRESS,
  type Address,
  type Hex,
} from 'viem';
import { getCapabilities, sendCalls, waitForCallsStatus } from 'viem/actions';
import {
  useAccount,
  useBalance,
  useConnect,
  useGasPrice,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from 'wagmi';

import { PONS_CHAIN_ID } from '@/lib/pons/constants';
import { PONS_V2 } from '@/lib/pons/v2-deployments';
import { PONS_SEAT_SERIES_FACTORY_ABI } from '@/lib/seats/abis';
import { EMPTY_PROVENANCE } from '@/lib/seats/create-series';
import { PONS_SEAT_DEPLOYMENT, isSeatInfraConfigured } from '@/lib/seats/deployments';
import {
  FUEL_PAIR_OPTIONS,
  PONS_LAUNCH_FEE_ABI,
  findFuelPair,
  planLaunchedSeries,
} from '@/lib/seats/fuel-launch';
import { MAX_SEAT_SUPPLY } from '@/lib/seats/supply';
import {
  ORIGINAL_ANIMALS,
  ORIGINALS_ONE_OF_ONE,
  PONS_ORIGINALS_SUPPLY,
  originalsRarityTable,
} from '@/lib/seats/originals';
import { cn, ipfsToGateway } from '@/lib/utils';

type ArtSource = 'originals' | 'custom';

/** ETH by default: buyers already hold it, so getting fuel needs no other asset first. */
const DEFAULT_PAIR = FUEL_PAIR_OPTIONS[0];

/** Gas the whole batch needs, measured by `npm run seats:check-batch`, doubled for headroom. */
const BATCH_GAS_RESERVE = 21_000_000n;

async function uploadLogo(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch('/api/pons/ipfs', { method: 'POST', body: form });
  const data = (await res.json()) as { uri?: string; error?: string };
  if (!res.ok || !data.uri) throw new Error(data.error ?? 'Could not upload the token logo');
  return data.uri;
}

/**
 * Prepares an Originals pack. The layout of the pack never reaches the browser: what comes back is
 * the sealed card the series sells against and the commitment to the pack behind it.
 */
async function buildOriginalsPack(input: {
  name: string;
  symbol: string;
  description: string;
}): Promise<{ imageUri: string; baseTokenURI: string; provenanceHash: `0x${string}` }> {
  const res = await fetch('/api/seats/originals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    imageUri?: string;
    placeholderUri?: string;
    provenanceHash?: `0x${string}`;
    error?: string;
  };
  if (!res.ok || !data.placeholderUri || !data.provenanceHash || !data.imageUri) {
    throw new Error(data.error ?? 'Could not prepare the Originals pack');
  }
  return {
    imageUri: data.imageUri,
    baseTokenURI: data.placeholderUri,
    provenanceHash: data.provenanceHash,
  };
}

async function uploadSeatPack(input: {
  file: File;
  name: string;
  symbol: string;
  description: string;
  maxSupply: string;
}): Promise<{ imageUri: string; baseTokenURI: string }> {
  const form = new FormData();
  form.append('image', input.file);
  form.append('name', input.name);
  form.append('symbol', input.symbol);
  form.append('description', input.description);
  form.append('maxSupply', input.maxSupply);

  const res = await fetch('/api/seats/metadata', { method: 'POST', body: form });
  const data = (await res.json()) as {
    imageUri?: string;
    baseTokenURI?: string;
    error?: string;
  };
  if (!res.ok || !data.baseTokenURI || !data.imageUri) {
    throw new Error(data.error ?? 'Metadata upload failed');
  }
  return { imageUri: data.imageUri, baseTokenURI: data.baseTokenURI };
}

export function SeatsCreateForm() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artSource, setArtSource] = useState<ArtSource>('originals');
  const [ipfsAccepted, setIpfsAccepted] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [maxSupply, setMaxSupply] = useState('100');
  const [seatPrice, setSeatPrice] = useState('666666');
  const [baseUri, setBaseUri] = useState('');
  const [imageUri, setImageUri] = useState('');
  const [provenanceHash, setProvenanceHash] = useState<`0x${string}`>(EMPTY_PROVENANCE);

  const [pairAddress, setPairAddress] = useState<string>(DEFAULT_PAIR.address);
  const [firstBuy, setFirstBuy] = useState('');
  const [logoUri, setLogoUri] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Whether this wallet can sign the launch and the series as one atomic batch. Asked up front so
  // the form can say how many prompts are coming instead of hedging with "if your wallet supports it".
  const { data: batchesAtomically } = useQuery({
    queryKey: ['seat-create-atomic', address, PONS_CHAIN_ID],
    enabled: Boolean(walletClient && address),
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const capabilities = await getCapabilities(walletClient!, { chainId: PONS_CHAIN_ID });
        return capabilities.atomic?.status === 'supported' || capabilities.atomic?.status === 'ready';
      } catch {
        // Wallets that do not implement wallet_getCapabilities at all get a prompt per call.
        return false;
      }
    },
  });

  const configured = isSeatInfraConfigured();
  const onWrongChain = isConnected && chainId !== PONS_CHAIN_ID;
  const usingOriginals = artSource === 'originals';
  const effectiveSupply = usingOriginals ? String(PONS_ORIGINALS_SUPPLY) : maxSupply;
  const rarity = useMemo(() => originalsRarityTable(), []);

  const derivedTokenName = tokenName.trim() || (name.trim() ? `${name.trim()} Fuel` : '');
  const derivedTokenSymbol =
    tokenSymbol.trim().toUpperCase() ||
    (symbol.trim() ? `${symbol.trim().toUpperCase()}F` : '');

  const pair = useMemo(() => findFuelPair(pairAddress) ?? DEFAULT_PAIR, [pairAddress]);
  const nativePair = pair.address === ZERO_ADDRESS;
  const firstBuyAmount = useMemo(() => {
    const raw = firstBuy.trim();
    if (!raw) return 0n;
    try {
      const parsed = parseUnits(raw, pair.decimals);
      return parsed > 0n ? parsed : 0n;
    } catch {
      return 0n;
    }
  }, [firstBuy, pair.decimals]);

  // The launcher runs the fuel launch, the first buy and the series inside one call, so the only
  // thing that can add a step is an ERC-20 pair, which has to be approved before it can be pulled.
  const stepCount = useMemo(
    () => (!nativePair && firstBuyAmount > 0n ? 2 : 1),
    [firstBuyAmount, nativePair],
  );

  const { data: nativeBalance } = useBalance({
    address,
    query: { enabled: Boolean(address) && nativePair },
  });
  const { data: pairBalanceRaw } = useReadContract({
    address: pair.address as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && !nativePair },
  });
  const balance = nativePair ? nativeBalance?.value : pairBalanceRaw;

  const { data: launchFeeWei } = useReadContract({
    address: PONS_V2.factory as Address,
    abi: PONS_LAUNCH_FEE_ABI,
    functionName: 'launchFee',
  });
  const { data: gasPrice } = useGasPrice();

  /**
   * The most fuel a creator can buy right now.
   *
   * An ETH buy shares the wallet with the launch fee and the gas for the whole batch, so those come
   * off the top — otherwise pressing Max would leave nothing to pay for the launch it is part of.
   * An ERC-20 pair has no such conflict, since gas is still paid in ETH.
   */
  const spendable = useMemo(() => {
    if (balance === undefined) return undefined;
    if (!nativePair) return balance;
    const reserve = (launchFeeWei ?? 0n) + (gasPrice ?? 0n) * BATCH_GAS_RESERVE;
    return balance > reserve ? balance - reserve : 0n;
  }, [balance, gasPrice, launchFeeWei, nativePair]);

  function applyBuyFraction(numerator: bigint, denominator: bigint) {
    if (spendable === undefined) return;
    const amount = (spendable * numerator) / denominator;
    setFirstBuy(amount === 0n ? '' : formatUnits(amount, pair.decimals));
  }

  const logoMutation = useMutation({
    mutationFn: uploadLogo,
    onSuccess: (uri) => {
      setLogoUri(uri);
      setLogoPreview(ipfsToGateway(uri));
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Could not upload the token logo.');
    },
  });

  /** The seat art doubles as the token logo unless a creator uploads one for the token itself. */
  const effectiveLogo = logoUri || imageUri;

  const uploadMutation = useMutation({
    mutationFn: uploadSeatPack,
    onSuccess: (result) => {
      setImageUri(result.imageUri);
      setBaseUri(result.baseTokenURI);
      // One picture for the whole series: there is no layout to hide, so nothing to seal.
      setProvenanceHash(EMPTY_PROVENANCE);
      setPreviewUrl(ipfsToGateway(result.imageUri));
      setPendingFile(null);
      setError(null);
      setStatus('Picture saved. You are ready to create the series.');
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Could not upload your picture. Try again.');
    },
  });

  const originalsMutation = useMutation({
    mutationFn: buildOriginalsPack,
    onSuccess: (result) => {
      setImageUri(result.imageUri);
      setBaseUri(result.baseTokenURI);
      setProvenanceHash(result.provenanceHash);
      setPreviewUrl(ipfsToGateway(result.imageUri));
      setError(null);
      setStatus(
        `Pack ready — ${PONS_ORIGINALS_SUPPLY.toLocaleString()} sealed seats. You can create the series.`,
      );
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Could not prepare the Originals pack.');
    },
  });

  const canCreate = useMemo(() => {
    if (!configured || !name.trim() || !symbol.trim()) return false;
    if (!baseUri.startsWith('ipfs://')) return false;
    const supply = Number(effectiveSupply);
    if (!Number.isInteger(supply) || supply < 1 || supply > MAX_SEAT_SUPPLY) return false;
    try {
      if (parseEther(seatPrice) <= 0n) return false;
    } catch {
      return false;
    }
    return true;
  }, [baseUri, configured, effectiveSupply, name, seatPrice, symbol]);

  function switchArtSource(next: ArtSource) {
    if (next === artSource) return;
    setArtSource(next);
    // The pinned folder belongs to one art choice and one supply, so it cannot carry over.
    setBaseUri('');
    setImageUri('');
    setProvenanceHash(EMPTY_PROVENANCE);
    setPreviewUrl(null);
    setPendingFile(null);
    setError(null);
    setStatus(null);
  }

  async function handleImageChange(file: File | null) {
    if (!file || !ipfsAccepted) return;
    if (!file.type.startsWith('image/')) {
      setError('Use a PNG, JPEG, WebP, or GIF image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Images must be smaller than 5 MB.');
      return;
    }
    if (!name.trim() || !symbol.trim()) {
      setError('Add a series name and ticker before uploading a picture.');
      return;
    }
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setStatus('Saving your picture and preparing seat info…');
    uploadMutation.mutate({
      file,
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      description: description.trim(),
      maxSupply,
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isConnected) {
      const connector = connectors[0];
      if (connector) connect({ connector });
      return;
    }
    if (onWrongChain) {
      try {
        await switchChainAsync({ chainId: PONS_CHAIN_ID });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to switch network');
      }
      return;
    }
    if (!configured) {
      setError('Seat factory is not configured.');
      return;
    }
    if (!walletClient || !publicClient || !address) {
      setError('Connect a wallet first.');
      return;
    }
    if (!canCreate) {
      setError(
        usingOriginals
          ? 'Add a name, ticker and price, then prepare your Originals pack.'
          : 'Add a name, ticker, seat count, price, and upload your picture first.',
      );
      return;
    }

    setBusy(true);

    try {
      const draft = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        tokenName: derivedTokenName,
        tokenSymbol: derivedTokenSymbol,
        baseTokenURI: baseUri,
        provenanceHash,
        maxSupply: BigInt(effectiveSupply),
        seatPrice: parseEther(seatPrice),
        protocolTreasury: (PONS_SEAT_DEPLOYMENT.protocolTreasury as Address) || address,
      };

      setStatus('Preparing your launch…');
      const plan = await planLaunchedSeries(publicClient, {
        creator: address,
        series: draft,
        fuel: {
          pairToken: pair.address as Address,
          logo: effectiveLogo,
          description: description.trim(),
          firstBuy: firstBuyAmount,
        },
      });
      const calls = plan.calls;
      setStatus(
        calls.length === 1
          ? 'Confirm in your wallet — one transaction.'
          : `Confirm in your wallet — approve ${pair.symbol}, then launch.`,
      );

      // One call on an ETH pair, so this is a single confirmation whatever the wallet supports. An
      // ERC-20 pair adds its approval, which a batching wallet folds into the same signature.
      const { id } = await sendCalls(walletClient, {
        calls,
        experimental_fallback: true,
      });

      setStatus('Waiting for the network to finish…');
      const bundle = await waitForCallsStatus(walletClient, { id, timeout: 300_000 });
      if (bundle.status !== 'success') {
        throw new Error('Creation did not go through. Check your wallet and try again.');
      }

      // The launcher is the last call, so its receipt carries the series id.
      const last = bundle.receipts?.at(-1);
      if (!last) throw new Error('Wallet reported no receipts for the transaction.');
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: last.transactionHash as Hex,
      });

      const created = parseEventLogs({
        abi: PONS_SEAT_SERIES_FACTORY_ABI,
        logs: receipt.logs,
        eventName: 'SeriesCreated',
      })[0];
      const seriesId = created?.args.seriesId;
      if (seriesId === undefined) {
        throw new Error('Series was created but we could not open it. Check Vault Seats.');
      }

      setStatus('Opening your series…');
      router.push(`/seats/${seriesId.toString()}`);
    } catch (err) {
      // A failed launch leaves nothing behind: the fuel token and the series are created in the
      // same transaction, so either both exist or neither does.
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
      setStatus(null);
    }
  }

  const primaryLabel = !isConnected
    ? 'Connect wallet'
    : onWrongChain
      ? isSwitching
        ? 'Switching…'
        : 'Switch to Robinhood'
      : busy
        ? status || 'Creating…'
        : uploadMutation.isPending
          ? 'Saving picture…'
          : originalsMutation.isPending
            ? 'Preparing pack…'
            : 'Create series';

  return (
    <div className="split-shell float launchpad-create-shell">
      <div className="split-shell-form launchpad-create-form">
        <header className="launchpad-create-header">
          <div className="launchpad-create-heading">
            <h2 className="split-shell-title">Your series</h2>
            <span className="pv-badge pv-badge-live">Vault Seats</span>
          </div>
          <p className="launchpad-field-note">
            You create two things: <strong>seat NFTs</strong> (the collectibles) and a{' '}
            <strong>fuel $TOKEN</strong> (the coin people spend to buy those NFTs and activate
            them). Not a normal meme-token launch.
          </p>
        </header>

        <form className="launchpad-form" onSubmit={onSubmit}>
          <label className="launchpad-field">
            <span className="launchpad-label">Series name</span>
            <input
              className="launchpad-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Night Market Seats"
              required
              autoComplete="off"
            />
            <p className="launchpad-field-note">Shown on the collection and marketplace cards.</p>
          </label>

          <label className="launchpad-field">
            <span className="launchpad-label">Short ticker</span>
            <input
              className="launchpad-input"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. SEAT"
              required
              autoComplete="off"
              spellCheck={false}
            />
            <p className="launchpad-field-note">A few letters, like a stock ticker.</p>
          </label>

          <label className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Short description</span>
            <textarea
              className="launchpad-input launchpad-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people what this series is about"
              rows={3}
            />
          </label>

          <div className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Seat art</span>
            <p className="launchpad-field-note">
              Every seat is an NFT, so every seat needs a picture. Use our ready-made pack or bring
              your own.
            </p>

            <div className="seat-art-choice" role="tablist" aria-label="Seat art source">
              <button
                type="button"
                role="tab"
                aria-selected={usingOriginals}
                className={cn('seat-art-option', usingOriginals && 'is-active')}
                onClick={() => switchArtSource('originals')}
                disabled={busy}
              >
                <span className="seat-art-option-title">PonsVault Originals</span>
                <span className="seat-art-option-note">
                  {PONS_ORIGINALS_SUPPLY.toLocaleString()} seats · 12 animals · no upload
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!usingOriginals}
                className={cn('seat-art-option', !usingOriginals && 'is-active')}
                onClick={() => switchArtSource('custom')}
                disabled={busy}
              >
                <span className="seat-art-option-title">Your own art</span>
                <span className="seat-art-option-note">One image · you pick the supply</span>
              </button>
            </div>

            {usingOriginals ? (
              <div className="seat-originals">
                <figure className="seat-oneofone">
                  <Image
                    src={`/originals/variants/${ORIGINALS_ONE_OF_ONE.file}`}
                    alt="The PonsVault Originals 1 of 1"
                    width={132}
                    height={132}
                  />
                  <figcaption>
                    <span className="seat-oneofone-tag">1 of 1</span>
                    <strong>The rarest seat in the pack</strong>
                    <span className="seat-oneofone-note">
                      One seat in your {PONS_ORIGINALS_SUPPLY.toLocaleString()} holds this piece, and
                      it is never colour graded, so there is nothing close to it. Nobody learns which
                      seat — not even you — until the series is revealed. It is also the artwork your
                      series leads with.
                    </span>
                  </figcaption>
                </figure>
                <div className="seat-originals-strip">
                  {ORIGINAL_ANIMALS.map((animal) => (
                    <span key={animal.id} className="seat-originals-thumb" title={animal.name}>
                      <Image
                        src={`/originals/${animal.source}`}
                        alt={animal.name}
                        width={56}
                        height={56}
                      />
                    </span>
                  ))}
                </div>
                <p className="launchpad-field-note">
                  A fixed run of {PONS_ORIGINALS_SUPPLY.toLocaleString()} seats. Every other seat
                  gets one of twelve animals in one of eight light grades, dealt at random from the
                  table below, so no two series deal the same hand.
                </p>
                <p className="launchpad-field-note">
                  The series sells sealed: every seat shows the same card, and the art appears when
                  the series sells out or after seven days, whichever comes first. The pack is locked
                  in before the first sale by a hash your series commits to, so the reveal can only
                  produce the hand that was dealt — and until it happens, nobody can pick out the seat
                  holding the 1 of 1.
                </p>
                <ul className="seat-rarity">
                  {rarity.map((row) => (
                    <li key={row.name}>
                      <span className="seat-rarity-name">{row.name}</span>
                      <span className="seat-rarity-count">
                        {row.count} · {row.percent}%
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={cn(
                    'pv-btn pv-btn-lg seat-pack-btn',
                    baseUri ? 'pv-btn-secondary' : 'pv-btn-primary',
                  )}
                  disabled={
                    !name.trim() || !symbol.trim() || originalsMutation.isPending || busy
                  }
                  onClick={() =>
                    originalsMutation.mutate({
                      name: name.trim(),
                      symbol: symbol.trim().toUpperCase(),
                      description: description.trim(),
                    })
                  }
                >
                  {originalsMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      <span className="ui-btn-label">Dealing {PONS_ORIGINALS_SUPPLY} seats…</span>
                    </>
                  ) : (
                    <span className="ui-btn-label">
                      {baseUri ? 'Re-deal my pack' : 'Prepare my pack'}
                    </span>
                  )}
                </button>
                <p className="launchpad-field-note">
                  {!name.trim() || !symbol.trim()
                    ? 'Add a name and ticker first.'
                    : originalsMutation.isPending
                      ? 'Assigning art to every seat and pinning it to IPFS.'
                      : baseUri
                        ? 'Pack is pinned and ready — your series can be created below.'
                        : 'One click, no upload. Takes a moment the first time.'}
                </p>
              </div>
            ) : (
              <>
                <label className="launchpad-field-note">
                  <input
                    type="checkbox"
                    checked={ipfsAccepted}
                    onChange={(e) => setIpfsAccepted(e.target.checked)}
                  />
                  I understand this picture will be stored publicly on the internet so wallets and
                  marketplaces can show it.
                </label>
                <label
                  className={cn(
                    'launchpad-upload',
                    ipfsAccepted && 'is-ready',
                    !ipfsAccepted && 'is-disabled',
                  )}
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    disabled={!ipfsAccepted || uploadMutation.isPending || busy}
                    onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
                  />
                  <span className="launchpad-upload-thumb">
                    {previewUrl ? (
                      <Image
                        src={previewUrl}
                        alt=""
                        width={52}
                        height={52}
                        className="launchpad-upload-preview"
                        unoptimized
                      />
                    ) : (
                      <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    )}
                  </span>
                  <span className="launchpad-upload-copy">
                    {uploadMutation.isPending
                      ? 'Saving your picture…'
                      : previewUrl
                        ? pendingFile
                          ? 'Saving…'
                          : 'Change picture'
                        : ipfsAccepted
                          ? 'Click to choose a picture'
                          : 'Check the box above first'}
                  </span>
                </label>
                <p className="launchpad-field-note">
                  The same image is used on every seat. Change the seat count after uploading and
                  you will need to upload again.
                </p>
              </>
            )}

            <div className="launchpad-disclosure" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="launchpad-advanced-toggle"
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
              >
                <span className="launchpad-advanced-title">Advanced art settings</span>
                <span className={cn('launchpad-advanced-chevron', advancedOpen && 'is-open')}>
                  <ChevronDown className="h-4 w-4" strokeWidth={1.75} />
                </span>
              </button>
              {advancedOpen ? (
                <div className="launchpad-advanced">
                  <label className="launchpad-field">
                    <span className="launchpad-label">Art storage link</span>
                    <input
                      className="launchpad-input font-mono text-sm"
                      value={baseUri}
                      onChange={(e) => setBaseUri(e.target.value.trim())}
                      placeholder="Filled automatically after you upload"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="launchpad-field-note">
                      Leave this alone unless you already host your own seat files online.
                    </p>
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          <div className="launchpad-field launchpad-field-wide vault-config">
            <span className="launchpad-label">Fuel $TOKEN — launched with your series</span>
            <p className="launchpad-field-note" style={{ marginBottom: 12 }}>
              Every series runs on its own ERC-20, and it goes out on a pons curve in the same
              confirmation as the series itself. Buyers spend it on seat NFTs and on activating
              them, and they can get it without asking you. Leave the names blank and we take them
              from your series.
            </p>

            <div className="vault-config-row">
              <label className="launchpad-field">
                <span className="launchpad-label">Fuel token name</span>
                <input
                  className="launchpad-input"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder={derivedTokenName || 'Series Fuel'}
                />
              </label>
              <label className="launchpad-field">
                <span className="launchpad-label">Fuel ticker</span>
                <input
                  className="launchpad-input"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value)}
                  placeholder={derivedTokenSymbol || 'SEATF'}
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="vault-config-row" style={{ marginTop: 12 }}>
              <div className="launchpad-field">
                <span className="launchpad-label">Token logo</span>
                <label
                  className={cn('launchpad-upload', 'is-ready')}
                  aria-label="Upload a logo for the fuel token"
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    disabled={logoMutation.isPending || busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 5 * 1024 * 1024) {
                        setError('Logos must be smaller than 5 MB.');
                        return;
                      }
                      setLogoPreview(URL.createObjectURL(file));
                      logoMutation.mutate(file);
                    }}
                  />
                  <span className="launchpad-upload-thumb">
                    {logoPreview ?? (effectiveLogo ? ipfsToGateway(effectiveLogo) : null) ? (
                      <Image
                        src={logoPreview ?? ipfsToGateway(effectiveLogo)}
                        alt=""
                        width={52}
                        height={52}
                        className="launchpad-upload-preview"
                        unoptimized
                      />
                    ) : (
                      <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    )}
                  </span>
                  <span className="launchpad-upload-copy">
                    {logoMutation.isPending
                      ? 'Saving logo…'
                      : logoUri
                        ? 'Change logo'
                        : effectiveLogo
                          ? 'Using your seat art — click to use a different image'
                          : 'Click to choose a logo'}
                  </span>
                </label>
                <p className="launchpad-field-note">
                  What wallets and explorers show for the token. Defaults to your seat art.
                </p>
              </div>
              <label className="launchpad-field">
                <span className="launchpad-label">Buyers pay with</span>
                <select
                  className="launchpad-input"
                  value={pairAddress}
                  onChange={(e) => {
                    setPairAddress(e.target.value);
                    setFirstBuy('');
                  }}
                  disabled={busy}
                >
                  {FUEL_PAIR_OPTIONS.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.symbol} — {token.name}
                    </option>
                  ))}
                </select>
                <p className="launchpad-field-note">
                  What the curve prices fuel in. ETH needs nothing else in the wallet; USDG is a
                  dollar, so fuel keeps a steadier price.
                </p>
              </label>
            </div>

            <div className="launchpad-field launchpad-field-wide" style={{ marginTop: 12 }}>
              <span className="launchpad-label">Buy fuel for yourself (optional)</span>
              <div className="launchpad-buy-field">
                <div className="launchpad-buy-entry">
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={firstBuy}
                    onChange={(e) => setFirstBuy(e.target.value)}
                    disabled={busy}
                    aria-label={`Amount of ${pair.symbol} to spend on fuel`}
                  />
                  <span className="launchpad-buy-token">{pair.symbol}</span>
                </div>
                <div className="launchpad-buy-meta">
                  <span>
                    {spendable === undefined
                      ? 'Connect to see your balance'
                      : `Available ${Number(formatUnits(spendable, pair.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${pair.symbol}`}
                  </span>
                  <span className="seat-buy-chips">
                    <button
                      type="button"
                      className="seat-buy-chip"
                      disabled={busy || !spendable}
                      onClick={() => applyBuyFraction(1n, 4n)}
                    >
                      25%
                    </button>
                    <button
                      type="button"
                      className="seat-buy-chip"
                      disabled={busy || !spendable}
                      onClick={() => applyBuyFraction(1n, 2n)}
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      className="convert-max"
                      disabled={busy || !spendable}
                      onClick={() => applyBuyFraction(1n, 1n)}
                    >
                      Max
                    </button>
                  </span>
                </div>
              </div>
              <p className="launchpad-field-note">
                {nativePair
                  ? 'Bought on the curve in the same transaction, so you hold fuel from minute one. Max leaves back the launch fee and gas.'
                  : `Bought on the curve in the same transaction. Gas and the launch fee are still paid in ETH, so Max here spends all your ${pair.symbol}.`}
              </p>
            </div>
          </div>

          <div className="vault-config-row">
            <label className="launchpad-field">
              <span className="launchpad-label">How many seats?</span>
              <input
                className="launchpad-input"
                inputMode="numeric"
                value={effectiveSupply}
                onChange={(e) => setMaxSupply(e.target.value)}
                readOnly={usingOriginals}
                disabled={usingOriginals}
                required
              />
              <p className="launchpad-field-note">
                {usingOriginals
                  ? `Fixed at ${PONS_ORIGINALS_SUPPLY.toLocaleString()} for Originals — the rarity table is built for that run.`
                  : `Total seats that will exist (up to ${MAX_SEAT_SUPPLY.toLocaleString()}). Creating the series costs you the same either way, since each seat is minted when someone buys it. Bigger numbers only take longer to prepare after you upload a picture.`}
              </p>
            </label>
            <label className="launchpad-field">
              <span className="launchpad-label">Price per seat</span>
              <input
                className="launchpad-input"
                inputMode="decimal"
                value={seatPrice}
                onChange={(e) => setSeatPrice(e.target.value)}
                required
              />
              <p className="launchpad-field-note">
                How much of this series&apos; $TOKEN someone pays to buy one seat NFT.
              </p>
            </label>
          </div>

          {isConnected && !onWrongChain ? (
            <p className="launchpad-field-note">
              {stepCount === 1
                ? 'Your wallet asks once. The fuel token, your first buy and the series all go out in a single transaction.'
                : batchesAtomically
                  ? `Your wallet signs this as one confirmation, covering the ${pair.symbol} approval and the launch.`
                  : `Your wallet asks twice: once to approve the ${pair.symbol}, once for the launch itself.`}
            </p>
          ) : null}

          {error ? <p className="launchpad-alert">{error}</p> : null}
          {status && !error ? <p className="launchpad-success">{status}</p> : null}

          <footer className="launchpad-create-footer" style={{ marginTop: 8 }}>
            <button
              type="submit"
              className="pv-btn pv-btn-primary"
              disabled={
                busy ||
                uploadMutation.isPending ||
                isSwitching ||
                (isConnected && !onWrongChain && !canCreate)
              }
            >
              {(busy || uploadMutation.isPending || isSwitching) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <span className="ui-btn-label">{primaryLabel}</span>
            </button>
          </footer>
        </form>
      </div>

      <aside className="split-shell-preview launchpad-preview-panel">
        <div className="launchpad-preview-top">
          <div className="launchpad-preview-image">
            {previewUrl ? (
              <Image src={previewUrl} alt="" width={68} height={68} unoptimized />
            ) : (
              <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            )}
          </div>
          <div className="launchpad-preview-identity">
            <h2>{name || 'Your series'}</h2>
            <p>{symbol ? `$${symbol.toUpperCase()}` : 'ticker'}</p>
          </div>
        </div>

        <p className="launchpad-preview-description">
          {description ||
            'Seat NFTs people can buy, plus a fuel $TOKEN to pay for them. Trading fees go to activated NFTs.'}
        </p>

        <dl className="launchpad-preview-details">
          <div>
            <dt>You create</dt>
            <dd>Seat NFTs + $TOKEN</dd>
          </div>
          <div>
            <dt>Fuel $TOKEN</dt>
            <dd>
              {derivedTokenName || '—'}
              {derivedTokenSymbol ? ` ($${derivedTokenSymbol})` : ''}
            </dd>
          </div>
          <div>
            <dt>Buyers get fuel</dt>
            <dd>On a curve · {pair.symbol}</dd>
          </div>
          <div>
            <dt>Your first buy</dt>
            <dd>{firstBuyAmount > 0n ? `${firstBuy.trim()} ${pair.symbol}` : 'None'}</dd>
          </div>
          <div>
            <dt>Seats</dt>
            <dd>{Number(effectiveSupply).toLocaleString() || '—'}</dd>
          </div>
          <div>
            <dt>Price each</dt>
            <dd>{seatPrice || '—'} fuel</dd>
          </div>
          <div>
            <dt>Art</dt>
            <dd>
              {baseUri
                ? usingOriginals
                  ? 'Originals · dealt'
                  : 'Your art · ready'
                : usingOriginals
                  ? 'Originals · prepare it'
                  : imageUri
                    ? 'Almost ready'
                    : 'Upload one'}
            </dd>
          </div>
          <div>
            <dt>Built in</dt>
            <dd>Shop · rewards · loans</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
