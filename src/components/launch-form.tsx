'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ImageIcon, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  useAccount,
  useBalance,
  useConnect,
  useSwitchChain,
  useWalletClient,
} from 'wagmi';
import { erc20Abi, formatUnits, parseAbi, parseUnits } from 'viem';

import {
  fetchV2Status,
  uploadTokenImage,
  verifyLaunchedToken,
} from '@/lib/pons/api';
import { robinhoodChain } from '@/lib/pons/chain';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';
import {
  PONS_CHAIN_ID,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_SYMBOL_MAX_LENGTH,
} from '@/lib/pons/constants';
import {
  isValidIpfsUri,
  isValidTelegramHandle,
  isValidTokenName,
  isValidTokenSymbol,
  isValidWebsiteUrl,
  isValidEthAddress,
  isValidXHandle,
  normalizeTelegram,
  normalizeTokenName,
  normalizeTokenSymbol,
  normalizeTwitter,
  validateLaunchInput,
} from '@/lib/pons/launch';
import {
  BUYBACK_BURN_DEFAULTS,
  LOTTERY_DEFAULTS,
  RWA_DEFAULTS,
  STAKING_DEFAULTS,
  VAULT_TEMPLATES,
  type VaultTemplateId,
} from '@/lib/pons/vault';
import { PONS_V2_PAIR_TOKENS, isV2VaultLauncherDeployed } from '@/lib/pons/v2-deployments';
import { defaultV2PairAddress } from '@/lib/pons/v2-status';
import {
  encodeLaunchWithV2VaultTransaction,
  extractV2VaultLaunch,
  isV2VaultTemplate,
  validateV2VaultInput,
  v2VaultLauncherAddress,
} from '@/lib/pons/v2-vault';
import type { LaunchFormInput } from '@/lib/pons/types';
import { cn, ipfsToGateway } from '@/lib/utils';

const vaultsAvailable = isV2VaultLauncherDeployed();

const emptyForm: LaunchFormInput = {
  name: '',
  symbol: '',
  description: '',
  imageUri: '',
  twitter: '',
  telegram: '',
  website: '',
  devBuyEth: '',
  pairToken: PONS_V2_PAIR_TOKENS[0].address,
  creatorTaxBps: '0',
  vaultTemplate: vaultsAvailable ? 'buyback-burn' : 'none',
  vaultBurnPercent: BUYBACK_BURN_DEFAULTS.burnPercent,
  vaultTreasury: '',
  vaultMinHarvestEth: BUYBACK_BURN_DEFAULTS.minHarvestEth,
  vaultStakingLockDays: STAKING_DEFAULTS.lockDays,
  vaultRwaAsset: RWA_DEFAULTS.asset,
  vaultLotteryEntryHours: LOTTERY_DEFAULTS.entryHours,
  vaultLotteryRevealMinutes: LOTTERY_DEFAULTS.revealMinutes,
};

const GAS_BUFFER = 50_000_000_000_000n;

/** One entry of /api/rwa/assets: a curated stock, measured against the chain now. */
interface RwaAssetOption {
  symbol: string;
  name: string;
  address: string;
  poolFee: number;
  decimals: number;
  perRound: string;
  impactBps: number;
  tradeable: boolean;
  /** The check could not be run, which is not the same as an unusable pool. */
  unknown: boolean;
  reason: string | null;
}

interface RwaAvailability {
  registered: boolean;
  /** False when part of the answer came from a chain we could not read. */
  complete: boolean;
  assets: RwaAssetOption[];
}

export function LaunchForm() {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { data: balance } = useBalance({
    address,
    chainId: PONS_CHAIN_ID,
    query: { enabled: !!address },
  });

  const [form, setForm] = useState<LaunchFormInput>(emptyForm);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [ipfsAccepted, setIpfsAccepted] = useState(false);
  const [vaultAdvancedOpen, setVaultAdvancedOpen] = useState(false);
  const router = useRouter();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['v2-status'],
    queryFn: fetchV2Status,
    refetchInterval: 60_000,
  });

  // Whether RWA can be launched, and into which stocks, are facts about the chain.
  const { data: rwa, isLoading: rwaLoading } = useQuery<RwaAvailability>({
    queryKey: ['rwa-assets'],
    queryFn: async () => {
      const response = await fetch('/api/rwa/assets');
      if (!response.ok) throw new Error('Could not check which stocks are available.');
      return response.json();
    },
    refetchInterval: (query) => (query.state.data?.complete === false ? 5_000 : false),
    staleTime: 60_000,
  });

  const rwaAssets = useMemo(() => rwa?.assets ?? [], [rwa]);
  const rwaUnknown = rwa !== undefined && !rwa.complete;

  const approvedPairs = useMemo(() => {
    if (!status) {
      return PONS_V2_PAIR_TOKENS.map((p) => ({
        ...p,
        approved: true,
        phantomQuote: '0',
        graduationThreshold: '0',
      }));
    }
    return status.pairTokens.filter((p) => p.approved);
  }, [status]);

  const selectedPair = useMemo(() => {
    const address = form.pairToken || defaultV2PairAddress(status);
    return (
      approvedPairs.find((p) => p.address.toLowerCase() === address.toLowerCase()) ??
      approvedPairs[0] ??
      PONS_V2_PAIR_TOKENS[0]
    );
  }, [approvedPairs, form.pairToken, status]);

  const isRwaOptionOpen = (asset: RwaAssetOption) =>
    asset.tradeable ||
    asset.address.toLowerCase() === selectedPair.address.toLowerCase();

  /** Buyable via WETH for this pair, or same-as-pair (direct allocation). */
  const rwaOptionsForPair = useMemo(
    () => rwaAssets.filter(isRwaOptionOpen),
    // isRwaOptionOpen closes over selectedPair.address
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rwaAssets, selectedPair.address],
  );

  // Template is launchable if any stock has a WETH market, or any equity pair
  // can do same-asset dividends (every equity pair is in the curated list).
  const rwaAvailable =
    Boolean(rwa?.registered) &&
    (rwaAssets.some((a) => a.tradeable) ||
      approvedPairs.some((p) =>
        rwaAssets.some((a) => a.address.toLowerCase() === p.address.toLowerCase()),
      ));

  const selectedRwaAsset = useMemo(
    () => rwaAssets.find((a) => a.address.toLowerCase() === form.vaultRwaAsset.toLowerCase()),
    [rwaAssets, form.vaultRwaAsset],
  );

  const rwaIsDirect = Boolean(
    selectedRwaAsset &&
      selectedRwaAsset.address.toLowerCase() === selectedPair.address.toLowerCase(),
  );

  function pickDefaultRwaAsset(pairAddress: string, assets: RwaAssetOption[]): string {
    const same = assets.find(
      (a) => a.address.toLowerCase() === pairAddress.toLowerCase(),
    );
    if (same) return same.address;
    return assets.find((a) => a.tradeable)?.address ?? '';
  }

  const uploadMutation = useMutation({
    mutationFn: uploadTokenImage,
    onSuccess: (uri) => {
      setForm((prev) => ({ ...prev, imageUri: uri }));
      setPreviewUrl(ipfsToGateway(uri));
      setError('');
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? `${err.message} You can paste an ipfs:// URI below instead.`
          : 'Image upload failed. Paste an ipfs:// URI below instead.',
      );
    },
  });

  const onWrongChain = isConnected && chainId !== PONS_CHAIN_ID;
  const launchFeeWei = status ? BigInt(status.launchFeeWei) : 0n;
  const hasEnoughEth =
    !isConnected || (balance?.value ?? 0n) >= launchFeeWei + GAS_BUFFER;

  const hasValidImage = isValidIpfsUri(form.imageUri);
  const hasValidDetails =
    isValidTokenName(form.name) &&
    isValidTokenSymbol(form.symbol) &&
    isValidXHandle(form.twitter) &&
    isValidTelegramHandle(form.telegram) &&
    isValidWebsiteUrl(form.website);

  const validationError = useMemo(() => validateLaunchInput(form, undefined), [form]);

  const vaultConfigError = useMemo(
    () => validateV2VaultInput(form, { buybackHelperReady: status?.buybackHelperReady }),
    [form, status?.buybackHelperReady],
  );

  const burnSharePercent = Number(form.vaultBurnPercent);
  const treasuryInvalid =
    form.vaultTemplate === 'buyback-burn' &&
    burnSharePercent < 100 &&
    form.vaultTreasury.trim().length > 0 &&
    !isValidEthAddress(form.vaultTreasury);

  const graduationLabel = useMemo(() => {
    if (!selectedPair || !('graduationThreshold' in selectedPair)) return '—';
    try {
      const raw = BigInt(selectedPair.graduationThreshold || '0');
      if (raw === 0n) return '—';
      return `${formatUnits(raw, selectedPair.decimals)} ${selectedPair.symbol}`;
    } catch {
      return '—';
    }
  }, [selectedPair]);

  const selectedVault = VAULT_TEMPLATES.find((entry) => entry.id === form.vaultTemplate);

  function selectVault(id: VaultTemplateId) {
    setForm((f) => {
      const next = { ...f, vaultTemplate: id };
      if (id === 'rwa') {
        const currentOk = rwaAssets.some(
          (a) =>
            a.address.toLowerCase() === f.vaultRwaAsset.toLowerCase() &&
            (a.tradeable ||
              a.address.toLowerCase() === selectedPair.address.toLowerCase()),
        );
        if (!currentOk) {
          next.vaultRwaAsset = pickDefaultRwaAsset(selectedPair.address, rwaAssets);
        }
      }
      return next;
    });
  }

  function selectPairToken(pairAddress: string) {
    setForm((f) => {
      const next = { ...f, pairToken: pairAddress };
      if (f.vaultTemplate === 'rwa') {
        const stillOk = rwaAssets.some(
          (asset) =>
            asset.address.toLowerCase() === f.vaultRwaAsset.toLowerCase() &&
            (asset.tradeable ||
              asset.address.toLowerCase() === pairAddress.toLowerCase()),
        );
        if (!stillOk) {
          next.vaultRwaAsset = pickDefaultRwaAsset(pairAddress, rwaAssets);
        }
      }
      return next;
    });
  }

  const primaryAction = useMemo(() => {
    if (!isConnected) {
      return { label: 'Connect wallet', disabled: false, mode: 'connect' as const };
    }
    if (onWrongChain) {
      return {
        label: isSwitching ? 'Switching…' : 'Switch to Robinhood',
        disabled: isSwitching,
        mode: 'switch' as const,
      };
    }
    if (isLaunching || uploadMutation.isPending) {
      return {
        label: statusText || (uploadMutation.isPending ? 'Uploading image…' : 'Working…'),
        disabled: true,
        mode: 'busy' as const,
      };
    }
    if (!ipfsAccepted) {
      return { label: 'Confirm public upload first', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (!hasValidImage) {
      return { label: 'Add token image', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (!hasValidDetails) {
      return { label: 'Fill token details', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (vaultConfigError) {
      return { label: 'Check vault settings', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (status && !status.publicReady && !status.vaultCanLaunch) {
      return { label: 'Launches not open yet', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (status && !status.vaultCanLaunch) {
      return { label: 'Vault launcher not ready', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (!hasEnoughEth) {
      return { label: 'Insufficient ETH', disabled: true, mode: 'launch' as const, blocked: true };
    }
    return { label: 'Launch token', disabled: false, mode: 'launch' as const, blocked: false };
  }, [
    hasEnoughEth,
    hasValidDetails,
    hasValidImage,
    ipfsAccepted,
    isConnected,
    isLaunching,
    isSwitching,
    onWrongChain,
    status,
    statusText,
    uploadMutation.isPending,
    vaultConfigError,
  ]);

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
    setPreviewUrl(URL.createObjectURL(file));
    uploadMutation.mutate(file);
  }

  async function handlePrimaryAction() {
    setError('');

    if (primaryAction.mode === 'connect') {
      const connector = connectors[0];
      if (connector) connect({ connector });
      return;
    }

    if (primaryAction.mode === 'switch') {
      try {
        await switchChainAsync({ chainId: PONS_CHAIN_ID });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to switch network');
      }
      return;
    }

    if (primaryAction.mode !== 'launch' || primaryAction.disabled) return;
    await handleLaunch();
  }

  async function handleLaunch() {
    setError('');

    if (!isConnected || !address || !walletClient || !status) {
      setError('Connect your wallet first.');
      return;
    }

    if (!isV2VaultTemplate(form.vaultTemplate)) {
      setError('Choose an available vault template.');
      return;
    }

    const launchForm: LaunchFormInput = {
      ...form,
      pairToken: selectedPair.address,
    };

    const validation = validateLaunchInput(launchForm, undefined);
    if (validation) {
      setError(validation);
      return;
    }

    setIsLaunching(true);
    setStatusText('Preparing transaction…');

    try {
      const name = normalizeTokenName(launchForm.name);
      const symbol = normalizeTokenSymbol(launchForm.symbol);
      const socials = {
        twitter: normalizeTwitter(launchForm.twitter),
        telegram: normalizeTelegram(launchForm.telegram),
        discord: '',
        website: launchForm.website.trim(),
        farcaster: '',
      };
      const creatorTaxBps = Math.min(
        Math.max(0, Math.round(Number(launchForm.creatorTaxBps || '0'))),
        status.maxCreatorTaxBps,
      );

      const data = encodeLaunchWithV2VaultTransaction(launchForm, socials, {
        name,
        symbol,
        creatorTaxBps,
      });
      const value = BigInt(status.launchFeeWei);

      setStatusText('Confirm in your wallet…');
      const hash = await walletClient.sendTransaction({
        account: address,
        chain: robinhoodChain,
        to: v2VaultLauncherAddress(),
        value,
        data,
      });

      setStatusText('Waiting for confirmation…');
      const { createPublicClient, http } = await import('viem');
      const publicClient = createPublicClient({
        chain: robinhoodChain,
        transport: http(ROBINHOOD_RPC_URL),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== 'success') {
        throw new Error(
          'Launch transaction reverted on-chain. For RWA Dividend with a thin WETH market, pair and dividend asset must be the same stock (e.g. SPCX + SPCX).',
        );
      }

      const vaultLaunch = extractV2VaultLaunch(receipt);
      const token = vaultLaunch?.token;
      const curve = vaultLaunch?.curve;

      if (!token) {
        throw new Error('Launch transaction confirmed but token address was not found in logs.');
      }

      // Optional initial buy in the pairing asset (v2 has no ETH top-up on launch).
      const initialBuyRaw = launchForm.devBuyEth.trim();
      if (initialBuyRaw && curve) {
        const quoteIn = parseUnits(initialBuyRaw, selectedPair.decimals);
        if (quoteIn > 0n) {
          const pair = selectedPair.address as `0x${string}`;
          const curveBuyAbi = parseAbi([
            'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) returns (uint256)',
          ]);

          setStatusText(`Approve ${selectedPair.symbol} for initial buy…`);
          const approveHash = await walletClient.writeContract({
            account: address,
            chain: robinhoodChain,
            address: pair,
            abi: erc20Abi,
            functionName: 'approve',
            args: [curve, quoteIn],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });

          setStatusText(`Buying with ${selectedPair.symbol}…`);
          const buyHash = await walletClient.writeContract({
            account: address,
            chain: robinhoodChain,
            address: curve,
            abi: curveBuyAbi,
            functionName: 'buy',
            args: [quoteIn, 0n, address],
          });
          await publicClient.waitForTransactionReceipt({ hash: buyHash });
        }
      }

      setStatusText('Registering with pons indexer…');
      try {
        await verifyLaunchedToken(token);
      } catch {
        // Non-fatal — pons indexer may not index v2 yet.
      }

      await fetch('/api/launches/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name,
          symbol,
          description: launchForm.description.trim(),
          logo: launchForm.imageUri.trim(),
          deployer: address,
          feeWallet: vaultLaunch.vault,
          transactionHash: hash,
          launchedAt: new Date().toISOString(),
        }),
      }).catch(() => undefined);

      setStatusText('Opening token page…');
      router.push(`/launchpad/${token}`);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setIsLaunching(false);
      setStatusText('');
    }
  }

  const uploadLabel = uploadMutation.isPending
    ? 'Uploading image…'
    : previewUrl
      ? 'Change image'
      : ipfsAccepted
        ? 'Click to upload image'
        : 'Confirm public upload first';

  return (
    <div className="split-shell float launchpad-create-shell">
      <div className="split-shell-form launchpad-create-form">
        <header className="launchpad-create-header">
          <div className="launchpad-create-heading">
            <h2 className="split-shell-title">Launch token</h2>
            <span className="pv-badge pv-badge-live">PonsVault V2</span>
          </div>
          <p className="launchpad-field-note">
            Deploys through the open pons v2 factory with a vault attached to creator fees.
          </p>
        </header>

        <div className="launchpad-form">
          <label className="launchpad-field">
            <span className="launchpad-label">Name</span>
            <input
              className="launchpad-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Token name"
              maxLength={TOKEN_NAME_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="launchpad-field-note">
              Letters, numbers, and spaces. {TOKEN_NAME_MAX_LENGTH} characters max.
            </span>
          </label>

          <label className="launchpad-field">
            <span className="launchpad-label">Ticker</span>
            <input
              className="launchpad-input"
              value={form.symbol}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
              placeholder="symbol"
              maxLength={TOKEN_SYMBOL_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="launchpad-field-note">
              Letters and numbers. {TOKEN_SYMBOL_MAX_LENGTH} characters max.
            </span>
          </label>

          <label className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Description</span>
            <textarea
              className="launchpad-input launchpad-textarea"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="A short description of the token"
              rows={3}
            />
          </label>

          <div className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Token image</span>
            <label className="launchpad-field-note">
              <input
                type="checkbox"
                checked={ipfsAccepted}
                onChange={(e) => setIpfsAccepted(e.target.checked)}
              />
              I understand that selected artwork will be moderated and uploaded to public IPFS.
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
                disabled={!ipfsAccepted || uploadMutation.isPending}
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
                <span>{uploadLabel}</span>
              </span>
            </label>
            <label className="launchpad-field mt-3">
              <span className="launchpad-label">Or paste ipfs:// URI</span>
              <input
                className="launchpad-input font-mono text-sm"
                value={form.imageUri.startsWith('ipfs://') ? form.imageUri : ''}
                onChange={(e) => {
                  const uri = e.target.value.trim();
                  setForm((f) => ({ ...f, imageUri: uri }));
                  setPreviewUrl(uri && isValidIpfsUri(uri) ? ipfsToGateway(uri) : previewUrl);
                  if (uri && isValidIpfsUri(uri)) setError('');
                }}
                placeholder="ipfs://…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>

          <label className="launchpad-field">
            <span className="launchpad-label">X profile</span>
            <span className="launchpad-prefixed-input">
              <span aria-hidden="true">x.com/</span>
              <input
                placeholder="handle"
                value={form.twitter}
                onChange={(e) => setForm((f) => ({ ...f, twitter: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                aria-label="X profile handle"
              />
            </span>
          </label>

          <label className="launchpad-field">
            <span className="launchpad-label">Telegram</span>
            <span className="launchpad-prefixed-input">
              <span aria-hidden="true">t.me/</span>
              <input
                placeholder="community"
                value={form.telegram}
                onChange={(e) => setForm((f) => ({ ...f, telegram: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                aria-label="Telegram public username"
              />
            </span>
          </label>

          <label className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Website</span>
            <input
              className="launchpad-input"
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="https://example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Pairing asset</span>
            <select
              className="launchpad-input"
              aria-label="Pairing asset"
              value={selectedPair.address}
              onChange={(e) => selectPairToken(e.target.value)}
            >
              {approvedPairs.map((pair) => (
                <option key={pair.address} value={pair.address}>
                  {pair.symbol} — {pair.name}
                </option>
              ))}
            </select>
            <p className="launchpad-field-note">
              Buyers spend this on the curve, and creator fees arrive in it. Pair with the same
              stock as an RWA dividend to pay that stock out with no Uniswap buy. Native ETH is
              not open yet.
            </p>
          </label>

          <div className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Vault</span>
            <p className="launchpad-field-note">
              Decides what happens to this token&apos;s creator fees. Fixed at launch —{' '}
              <Link href="/docs#vaults" className="link">
                read how vaults work
              </Link>
              .
            </p>

            <div className="vault-picker" role="radiogroup" aria-label="Vault template">
              {VAULT_TEMPLATES.map((template) => {
                const gatedOnChain = template.id === 'rwa';
                const selectable =
                  template.status === 'available' &&
                  vaultsAvailable &&
                  isV2VaultTemplate(template.id) &&
                  (!gatedOnChain || rwaAvailable);
                const selected = form.vaultTemplate === template.id;

                return (
                  <button
                    key={template.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!selectable}
                    onClick={() => selectVault(template.id)}
                    className={cn('vault-option', selected && 'is-selected')}
                  >
                    <span className="vault-option-head">
                      <span className="vault-option-name">{template.name}</span>
                      {template.status === 'soon' ? (
                        <span className="pv-badge">Soon</span>
                      ) : gatedOnChain && (rwaLoading || rwaUnknown) ? (
                        <span className="pv-badge">Checking…</span>
                      ) : !selectable ? (
                        <span className="pv-badge">Not deployed</span>
                      ) : null}
                    </span>
                    <span className="vault-option-tagline">{template.tagline}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {form.vaultTemplate === 'buyback-burn' ? (
            <div className="launchpad-field launchpad-field-wide vault-config">
              <div className="vault-config-row">
                <label className="launchpad-field">
                  <span className="launchpad-label">Burn share</span>
                  <span className="launchpad-prefixed-input">
                    <input
                      inputMode="decimal"
                      value={form.vaultBurnPercent}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, vaultBurnPercent: e.target.value }))
                      }
                      aria-label="Percentage of fees spent on buyback and burn"
                    />
                    <span className="vault-suffix">%</span>
                  </span>
                  <p className="launchpad-field-note">
                    {burnSharePercent >= 100
                      ? '100% burn needs a buyback helper that is not live yet — leave a treasury share.'
                      : `${(100 - burnSharePercent).toFixed(burnSharePercent % 1 === 0 ? 0 : 2)}% goes to the treasury.`}
                  </p>
                </label>

                <label className="launchpad-field">
                  <span className="launchpad-label">
                    Treasury {burnSharePercent >= 100 ? '(not needed)' : ''}
                  </span>
                  <input
                    className="launchpad-input"
                    value={form.vaultTreasury}
                    onChange={(e) => setForm((f) => ({ ...f, vaultTreasury: e.target.value }))}
                    placeholder="0x…"
                    disabled={burnSharePercent >= 100}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Treasury address receiving the remaining fees"
                  />
                  <p
                    className={cn(
                      'launchpad-field-note',
                      treasuryInvalid && 'is-error',
                    )}
                  >
                    {treasuryInvalid
                      ? 'Enter a valid address for the unburned share.'
                      : 'Receives whatever is not burned.'}
                  </p>
                </label>
              </div>

              <div className="launchpad-disclosure">
                <button
                  type="button"
                  className="launchpad-advanced-toggle"
                  onClick={() => setVaultAdvancedOpen((open) => !open)}
                  aria-expanded={vaultAdvancedOpen}
                >
                  <span className="launchpad-advanced-title">Advanced vault settings</span>
                  <span
                    className={cn(
                      'launchpad-advanced-chevron',
                      vaultAdvancedOpen && 'is-open',
                    )}
                  >
                    <ChevronDown className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                </button>

                {vaultAdvancedOpen ? (
                  <div className="launchpad-advanced">
                    <p className="launchpad-field-note">
                      The default is what we test with, and like everything else here it is fixed
                      once the vault exists.
                    </p>

                    <div className="vault-config-row">
                      <label className="launchpad-field">
                        <span className="launchpad-label">
                          Minimum fees before a run ({selectedPair.symbol})
                        </span>
                        <input
                          className="launchpad-input"
                          inputMode="decimal"
                          value={form.vaultMinHarvestEth}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, vaultMinHarvestEth: e.target.value }))
                          }
                        />
                        <p className="launchpad-field-note">
                          The vault waits until this much {selectedPair.symbol} has built up, then
                          buys. Set it higher and it buys less often in bigger amounts.
                        </p>
                      </label>
                    </div>

                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {form.vaultTemplate === 'staking' ? (
            <div className="launchpad-field launchpad-field-wide vault-config">
              <p className="launchpad-field-note">
                Holders who stake earn the creator fees in {selectedPair.symbol}, split by how much
                they have staked. Nothing is minted and no supply is burned.
              </p>

              <div className="vault-config-row">
                <label className="launchpad-field">
                  <span className="launchpad-label">
                    Minimum fees before a payout ({selectedPair.symbol})
                  </span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultMinHarvestEth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultMinHarvestEth: e.target.value }))
                    }
                  />
                  <p className="launchpad-field-note">
                    The vault waits until this much {selectedPair.symbol} has built up, then pays
                    out. Set it higher and stakers are paid less often in bigger amounts.
                  </p>
                </label>
              </div>
            </div>
          ) : null}

          {form.vaultTemplate === 'rwa' ? (
            <div className="launchpad-field launchpad-field-wide vault-config">
              <p className="launchpad-field-note">
                {rwaIsDirect
                  ? `Fees arrive as ${selectedPair.symbol} and are paid out as ${selectedPair.symbol} dividends — no Uniswap buy needed.`
                  : `Fees in ${selectedPair.symbol} buy a tokenized stock, which holders claim by balance. There is nothing to stake. The token side of the fees is burned.`}
              </p>

              <label className="launchpad-field">
                <span className="launchpad-label">
                  {rwaIsDirect ? 'Dividend asset' : 'Stock the fees buy'}
                </span>
                <select
                  className="launchpad-input"
                  aria-label="Dividend stock"
                  value={form.vaultRwaAsset}
                  onChange={(e) => setForm((f) => ({ ...f, vaultRwaAsset: e.target.value }))}
                >
                  <option value="" disabled>
                    {rwaLoading || rwaUnknown ? 'Checking markets…' : 'Choose a stock'}
                  </option>
                  {rwaAssets.map((asset) => {
                    const sameAsPair =
                      asset.address.toLowerCase() === selectedPair.address.toLowerCase();
                    const selectable = asset.tradeable || sameAsPair;
                    const route = sameAsPair
                      ? 'direct — same as pair'
                      : asset.tradeable
                        ? 'via WETH pool'
                        : 'needs same-as-pair or deeper WETH pool';
                    return (
                      <option key={asset.address} value={asset.address} disabled={!selectable}>
                        {asset.symbol} — {asset.name} ({route})
                      </option>
                    );
                  })}
                </select>
                <p className="launchpad-field-note">
                  {selectedRwaAsset
                    ? rwaIsDirect
                      ? `Pairing is ${selectedPair.symbol}, so the vault pays ${selectedPair.symbol} directly with no swap. Fixed forever at launch.`
                      : `Fees in ${selectedPair.symbol} will buy ${selectedRwaAsset.symbol} on Uniswap. Fixed forever at launch.`
                    : rwaOptionsForPair.length === 0
                      ? `No dividend stock works with ${selectedPair.symbol} right now — pick an equity pair (e.g. SPCX) for direct payout, or a pair that can buy GME/NVDA.`
                      : 'Pick one. Same-as-pair pays that stock directly; other stocks need a live WETH market.'}
                </p>
              </label>

              <div className="vault-config-row">
                <label className="launchpad-field">
                  <span className="launchpad-label">
                    Minimum fees before a{' '}
                    {rwaIsDirect ? 'dividend round' : 'purchase'} ({selectedPair.symbol})
                  </span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultMinHarvestEth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultMinHarvestEth: e.target.value }))
                    }
                  />
                  <p className="launchpad-field-note">
                    {rwaIsDirect
                      ? `The vault waits until this much ${selectedPair.symbol} has built up, then opens a round holders can claim.`
                      : `The vault waits until this much ${selectedPair.symbol} has built up, then buys the stock and opens a round holders can claim from.`}
                  </p>
                </label>
              </div>
            </div>
          ) : null}

          <div className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Initial buy (optional)</span>
            <div className="launchpad-buy-field">
              <div className="launchpad-buy-entry">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.devBuyEth}
                  onChange={(e) => setForm((f) => ({ ...f, devBuyEth: e.target.value }))}
                  aria-label={`Initial buy amount in ${selectedPair.symbol}`}
                />
                <span className="launchpad-buy-token">{selectedPair.symbol}</span>
              </div>
              <div className="launchpad-buy-meta">
                <span>
                  Bought on the curve right after launch · paid in {selectedPair.symbol}, not ETH
                </span>
              </div>
            </div>
            <p className="launchpad-field-note">
              Requires a second approval + buy after the launch tx. Leave empty to skip.
            </p>
          </div>

          {error ? <div className="launchpad-alert">{error}</div> : null}
        </div>

        <footer className="launchpad-create-actions">
          <div className="convert-footer">
            <span className="convert-footer-rate">
              {statusLoading
                ? 'Loading fee…'
                : `Robinhood · ${status?.launchFeeEth ?? '…'} ETH fee${
                    form.devBuyEth.trim()
                      ? ` + ${form.devBuyEth.trim()} ${selectedPair.symbol} buy`
                      : ''
                  }`}
            </span>
            <span className="convert-footer-fee" title="Estimated network fee">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="M4 10H16" strokeLinecap="round" />
                <path d="M4 21L4 9C4 6.17157 4 4.75736 4.87868 3.87868C5.75736 3 7.17157 3 10 3C12.8284 3 14.2426 3 15.1213 3.87868C16 4.75736 16 6.17157 16 9L16 21H4Z" />
                <path d="M2 21H18" strokeLinecap="round" />
              </svg>
              <span>—</span>
            </span>
          </div>
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={
              primaryAction.disabled ||
              isConnecting ||
              (primaryAction.mode === 'launch' && !!validationError && !primaryAction.blocked)
            }
            className={cn(
              'ui-btn ui-btn-primary',
              primaryAction.blocked && 'is-blocked',
            )}
          >
            {(isLaunching || isSwitching || isConnecting || uploadMutation.isPending) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            <span className="ui-btn-label">{primaryAction.label}</span>
          </button>
        </footer>
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
            <h2>{form.name || 'Your token'}</h2>
            <p>{form.symbol.toLowerCase() || 'ticker'}</p>
          </div>
        </div>

        {form.description ? (
          <p className="launchpad-preview-description">{form.description}</p>
        ) : (
          <p className="launchpad-preview-description" />
        )}

        <dl className="launchpad-preview-details">
          <div>
            <dt>Launch fee</dt>
            <dd>
              <span className="launchpad-preview-eth">
                {status?.launchFeeEth ?? '—'}
                <img src="/ethereum.svg" alt="" width={14} height={14} className="token-icon" />
              </span>
            </dd>
          </div>
          <div>
            <dt>Paired in</dt>
            <dd>{selectedPair.symbol}</dd>
          </div>
          <div>
            <dt>Vault</dt>
            <dd>{selectedVault?.name ?? 'No vault'}</dd>
          </div>
          {form.vaultTemplate === 'buyback-burn' ? (
            <div>
              <dt>Creator fees</dt>
              <dd>
                {Number.isFinite(burnSharePercent)
                  ? `${burnSharePercent}% burned / ${100 - burnSharePercent}% treasury`
                  : '—'}
              </dd>
            </div>
          ) : null}
          {form.vaultTemplate === 'staking' ? (
            <div>
              <dt>Creator fees</dt>
              <dd>Paid to stakers in {selectedPair.symbol}</dd>
            </div>
          ) : null}
          {form.vaultTemplate === 'rwa' ? (
            <div>
              <dt>Creator fees</dt>
              <dd>
                {selectedRwaAsset
                  ? `Buy ${selectedRwaAsset.symbol} for holders`
                  : 'Buy a stock for holders'}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Graduation</dt>
            <dd>{graduationLabel}</dd>
          </div>
          <div>
            <dt>Liquidity</dt>
            <dd>Locked Uniswap v4</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
