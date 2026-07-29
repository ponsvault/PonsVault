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
import { formatUnits, parseEther } from 'viem';

import {
  fetchLaunchpadStatus,
  uploadTokenImage,
  verifyLaunchedToken,
} from '@/lib/pons/api';
import { robinhoodChain } from '@/lib/pons/chain';
import { ROBINHOOD_RPC_URL } from '@/lib/pons/constants';
import {
  PONS_CHAIN_ID,
  PONS_FACTORY,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_SYMBOL_MAX_LENGTH,
} from '@/lib/pons/constants';
import {
  buildLaunchMetadata,
  computeLaunchValue,
  encodeLaunchTransaction,
  extractLaunchedToken,
  formatMaxDevBuyEth,
  generateLaunchSalt,
  isValidIpfsUri,
  isValidTelegramHandle,
  isValidTokenName,
  isValidTokenSymbol,
  isValidWebsiteUrl,
  isValidEthAddress,
  isValidXHandle,
  normalizeEthAddress,
  validateLaunchInput,
} from '@/lib/pons/launch';
import { computeMaxDevBuyWei } from '@/lib/pons/max-dev-buy';
import {
  BUYBACK_BURN_DEFAULTS,
  LOTTERY_DEFAULTS,
  RWA_DEFAULTS,
  STAKING_DEFAULTS,
  STAKING_MAX_LOCK_DAYS,
  VAULT_TEMPLATES,
  encodeLaunchWithVaultTransaction,
  extractVaultLaunch,
  isVaultLauncherDeployed,
  validateVaultInput,
  vaultLauncherAddress,
  type VaultTemplateId,
} from '@/lib/pons/vault';
import type { LaunchFormInput } from '@/lib/pons/types';
import { cn, ipfsToGateway, shortAddress } from '@/lib/utils';

const vaultsAvailable = isVaultLauncherDeployed();

const emptyForm: LaunchFormInput = {
  name: '',
  symbol: '',
  description: '',
  imageUri: '',
  twitter: '',
  telegram: '',
  website: '',
  devBuyEth: '',
  vaultTemplate: vaultsAvailable ? 'buyback-burn' : 'none',
  vaultBurnPercent: BUYBACK_BURN_DEFAULTS.burnPercent,
  vaultTreasury: '',
  vaultMinHarvestEth: BUYBACK_BURN_DEFAULTS.minHarvestEth,
  vaultStakingLockDays: STAKING_DEFAULTS.lockDays,
  vaultRwaAsset: RWA_DEFAULTS.asset,
  vaultLotteryEntryHours: LOTTERY_DEFAULTS.entryHours,
  vaultLotteryRevealMinutes: LOTTERY_DEFAULTS.revealMinutes,
};

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

const GAS_BUFFER = 50_000_000_000_000n;

function parseDevBuyWei(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  try {
    return parseEther(trimmed);
  } catch {
    return -1n;
  }
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
    queryKey: ['launchpad-status'],
    queryFn: fetchLaunchpadStatus,
    refetchInterval: 60_000,
  });

  // Whether the RWA Dividend template can be launched, and into which stocks,
  // are both facts about the chain rather than this build: the template needs a
  // registered factory, and a stock is only worth picking while its pool is
  // deep enough. Asked here so the picker reflects what would actually happen.
  const { data: rwa, isLoading: rwaLoading } = useQuery<RwaAvailability>({
    queryKey: ['rwa-assets'],
    queryFn: async () => {
      const response = await fetch('/api/rwa/assets');
      // Rejecting rather than returning an empty answer. Handing back
      // "registered: false" here would be recorded as a successful result and
      // cached, so a moment of RPC trouble would hide the template until the
      // page was reloaded — and look identical to the template not existing.
      if (!response.ok) throw new Error('Could not check which stocks are available.');
      return response.json();
    },
    // `complete: false` means the chain could not be read, which is worth
    // asking about again shortly. A complete answer is left alone.
    refetchInterval: (query) => (query.state.data?.complete === false ? 5_000 : false),
    staleTime: 60_000,
  });

  const rwaAssets = useMemo(() => rwa?.assets ?? [], [rwa]);
  const rwaTradeable = useMemo(() => rwaAssets.filter((a) => a.tradeable), [rwaAssets]);
  const rwaAvailable = Boolean(rwa?.registered) && rwaTradeable.length > 0;
  /** The answer is missing rather than negative, so it is still being fetched. */
  const rwaUnknown = rwa !== undefined && !rwa.complete;

  const { data: lotteryStatus, isLoading: lotteryLoading } = useQuery<{ registered: boolean }>({
    queryKey: ['lottery-status'],
    queryFn: async () => {
      const response = await fetch('/api/lottery/status');
      if (!response.ok) throw new Error('Could not check lottery registration.');
      return response.json();
    },
    staleTime: 60_000,
  });
  const lotteryAvailable = Boolean(lotteryStatus?.registered);

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
  const maxDevBuyEth = status ? formatMaxDevBuyEth(status) : null;
  const maxDevBuyWei = status ? computeMaxDevBuyWei(status) : 0n;
  const devBuyWei = parseDevBuyWei(form.devBuyEth);
  const totalCostWei = status ? computeLaunchValue(status, form.devBuyEth) : 0n;
  const devBuyTooHigh = maxDevBuyWei > 0n && devBuyWei > maxDevBuyWei;
  const hasEnoughEth =
    !isConnected || (balance?.value ?? 0n) >= totalCostWei + GAS_BUFFER;

  const hasValidImage = isValidIpfsUri(form.imageUri);
  const hasValidDetails =
    isValidTokenName(form.name) &&
    isValidTokenSymbol(form.symbol) &&
    isValidXHandle(form.twitter) &&
    isValidTelegramHandle(form.telegram) &&
    isValidWebsiteUrl(form.website);

  const validationError = useMemo(
    () => validateLaunchInput(form, status),
    [form, status],
  );

  const vaultConfigError = useMemo(() => validateVaultInput(form), [form]);

  const burnSharePercent = Number(form.vaultBurnPercent);
  const treasuryInvalid =
    form.vaultTemplate === 'buyback-burn' &&
    burnSharePercent < 100 &&
    form.vaultTreasury.trim().length > 0 &&
    !isValidEthAddress(form.vaultTreasury);

  const lockDaysLabel = useMemo(() => {
    const days = Number(form.vaultStakingLockDays || '0');
    if (!Number.isFinite(days) || days < 0) return 'Zero or more.';
    if (days === 0) return 'No lock — stakers can withdraw whenever they want.';
    if (days > STAKING_MAX_LOCK_DAYS) return `At most ${STAKING_MAX_LOCK_DAYS} days.`;
    return `Withdrawals open ${days === 1 ? 'a day' : `${days} days`} after a deposit. Rewards stay claimable throughout.`;
  }, [form.vaultStakingLockDays]);

  const selectedRwaAsset = useMemo(
    () => rwaAssets.find((a) => a.address.toLowerCase() === form.vaultRwaAsset.toLowerCase()),
    [rwaAssets, form.vaultRwaAsset],
  );

  const selectedVault = VAULT_TEMPLATES.find((entry) => entry.id === form.vaultTemplate);

  function selectVault(id: VaultTemplateId) {
    setForm((f) => ({ ...f, vaultTemplate: id }));
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
    if (devBuyTooHigh) {
      return { label: 'Developer buy too high', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (status && !status.launchEnabled) {
      return { label: 'Launches not open yet', disabled: true, mode: 'launch' as const, blocked: true };
    }
    if (!hasEnoughEth) {
      return { label: 'Insufficient ETH', disabled: true, mode: 'launch' as const, blocked: true };
    }
    return { label: 'Launch token', disabled: false, mode: 'launch' as const, blocked: false };
  }, [
    devBuyTooHigh,
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

    const validation = validateLaunchInput(form, status);
    if (validation) {
      setError(validation);
      return;
    }

    setIsLaunching(true);
    setStatusText('Preparing transaction…');

    const withVault = form.vaultTemplate !== 'none';

    try {
      // With a vault, the launcher becomes the token's deployer and fee wallet so
      // it can re-point the locker's redirect at the vault; without one, fees
      // stay with the launching wallet.
      const metadata = buildLaunchMetadata(
        form,
        address,
        withVault ? vaultLauncherAddress() : undefined,
      );
      const value = computeLaunchValue(status, form.devBuyEth);
      const salt = generateLaunchSalt(metadata.symbol);

      const data = withVault
        ? encodeLaunchWithVaultTransaction(metadata, form, salt)
        : encodeLaunchTransaction(metadata, status, form.devBuyEth, salt);

      setStatusText('Confirm in your wallet…');
      const hash = await walletClient.sendTransaction({
        account: address,
        chain: robinhoodChain,
        to: withVault ? vaultLauncherAddress() : PONS_FACTORY,
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

      const vaultLaunch = withVault ? extractVaultLaunch(receipt) : null;
      const token = vaultLaunch?.token ?? extractLaunchedToken(receipt);

      if (!token) {
        throw new Error('Launch transaction confirmed but token address was not found in logs.');
      }

      setStatusText('Registering with pons indexer…');
      try {
        await verifyLaunchedToken(token);
      } catch {
        // Non-fatal.
      }

      await fetch('/api/launches/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: metadata.name,
          symbol: metadata.symbol,
          description: metadata.description,
          logo: metadata.logo,
          deployer: address,
          // On a vault launch the locker pays the vault, so that is what the
          // record's fee wallet has to be for on-chain verification to pass.
          feeWallet: vaultLaunch?.vault ?? metadata.feeWallet,
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

  function setMaxDevBuy() {
    if (!maxDevBuyEth) return;
    setForm((f) => ({ ...f, devBuyEth: maxDevBuyEth }));
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
          <h2 className="split-shell-title">Launch token</h2>
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
                // Templates that answer to the registry stay unselectable until
                // their factory is registered (and for RWA, until a stock is
                // deep enough to buy).
                const gatedOnChain = template.id === 'rwa' || template.id === 'lottery';
                const chainReady =
                  template.id === 'rwa'
                    ? rwaAvailable
                    : template.id === 'lottery'
                      ? lotteryAvailable
                      : true;
                const checking =
                  (template.id === 'rwa' && (rwaLoading || rwaUnknown)) ||
                  (template.id === 'lottery' && lotteryLoading);
                const selectable =
                  template.status === 'available' && vaultsAvailable && (!gatedOnChain || chainReady);
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
                      ) : checking ? (
                        <span className="pv-badge">Checking</span>
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
                      ? 'Everything is burned. No treasury needed.'
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
                      ? 'Enter a valid address, or set the burn share to 100%.'
                      : burnSharePercent >= 100
                        ? 'Unused while everything is burned.'
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
                        <span className="launchpad-label">Minimum fees before a run (ETH)</span>
                        <input
                          className="launchpad-input"
                          inputMode="decimal"
                          value={form.vaultMinHarvestEth}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, vaultMinHarvestEth: e.target.value }))
                          }
                        />
                        <p className="launchpad-field-note">
                          The vault waits until this much has built up, then buys. Set it higher and
                          it buys less often in bigger amounts.
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
                Holders who stake earn the creator fees in WETH, split by how much they have
                staked. Nothing is minted and no supply is burned — stakers are paid the fees the
                pool actually generates.
              </p>

              <div className="vault-config-row">
                <label className="launchpad-field">
                  <span className="launchpad-label">Lock period (days)</span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultStakingLockDays}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultStakingLockDays: e.target.value }))
                    }
                    aria-label="Days a stake is locked before it can be withdrawn"
                  />
                  <p className="launchpad-field-note">
                    {lockDaysLabel}
                  </p>
                </label>

                <label className="launchpad-field">
                  <span className="launchpad-label">Minimum fees before a payout (ETH)</span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultMinHarvestEth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultMinHarvestEth: e.target.value }))
                    }
                  />
                  <p className="launchpad-field-note">
                    The vault waits until this much has built up, then pays out. Set it higher and
                    stakers are paid less often in bigger amounts.
                  </p>
                </label>
              </div>
            </div>
          ) : null}

          {form.vaultTemplate === 'lottery' ? (
            <div className="launchpad-field launchpad-field-wide vault-config">
              <p className="launchpad-field-note">
                Fees fill a prize pot. When the floor is hit, a round opens — holders enter, then
                a commit–reveal draw pays the whole pot to one wallet. Token-side fees are burned.
              </p>

              <div className="vault-config-row">
                <label className="launchpad-field">
                  <span className="launchpad-label">Entry window (hours)</span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultLotteryEntryHours}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultLotteryEntryHours: e.target.value }))
                    }
                  />
                  <p className="launchpad-field-note">
                    How long holders have to Enter after a pot opens. Fixed forever once you launch.
                  </p>
                </label>

                <label className="launchpad-field">
                  <span className="launchpad-label">Reveal delay (minutes)</span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultLotteryRevealMinutes}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultLotteryRevealMinutes: e.target.value }))
                    }
                  />
                  <p className="launchpad-field-note">
                    Wait between locking the draw and paying the winner — stops the operator
                    picking a seed after seeing who entered.
                  </p>
                </label>
              </div>

              <div className="vault-config-row">
                <label className="launchpad-field">
                  <span className="launchpad-label">Minimum fees before a round (ETH)</span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultMinHarvestEth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultMinHarvestEth: e.target.value }))
                    }
                  />
                  <p className="launchpad-field-note">
                    The vault waits until this much has built up, then opens a raffle over the pot.
                  </p>
                </label>
              </div>
            </div>
          ) : null}

          {form.vaultTemplate === 'rwa' ? (
            <div className="launchpad-field launchpad-field-wide vault-config">
              <p className="launchpad-field-note">
                Fees buy a tokenized stock, which the vault holds until holders claim it. Holders
                earn simply by holding — there is nothing to stake and nothing to opt into. The
                token side of the fees is burned.
              </p>

              <div className="launchpad-field">
                <span className="launchpad-label">Stock the fees buy</span>
                <div className="rwa-asset-picker" role="radiogroup" aria-label="Tokenized stock">
                  {rwaAssets.map((asset) => {
                    const selected =
                      form.vaultRwaAsset.toLowerCase() === asset.address.toLowerCase();

                    return (
                      <button
                        key={asset.address}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!asset.tradeable}
                        onClick={() => setForm((f) => ({ ...f, vaultRwaAsset: asset.address }))}
                        className={cn('rwa-asset-option', selected && 'is-selected')}
                      >
                        <span className="rwa-asset-head">
                          <span className="rwa-asset-symbol">{asset.symbol}</span>
                          {!asset.tradeable ? <span className="pv-badge">Unavailable</span> : null}
                        </span>
                        <span className="rwa-asset-name">{asset.name}</span>
                        {asset.tradeable ? (
                          <span className="rwa-asset-rate">
                            {formatUnits(BigInt(asset.perRound), asset.decimals).slice(0, 8)}{' '}
                            {asset.symbol} per {form.vaultMinHarvestEth || '0.025'} ETH
                          </span>
                        ) : (
                          <span className="rwa-asset-rate">{asset.reason}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="launchpad-field-note">
                  {selectedRwaAsset
                    ? `Fixed forever once this launches — the vault can never be pointed at a different stock.`
                    : 'Pick one. This can never be changed after launch.'}
                </p>
              </div>

              <div className="vault-config-row">
                <label className="launchpad-field">
                  <span className="launchpad-label">Minimum fees before a purchase (ETH)</span>
                  <input
                    className="launchpad-input"
                    inputMode="decimal"
                    value={form.vaultMinHarvestEth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vaultMinHarvestEth: e.target.value }))
                    }
                  />
                  <p className="launchpad-field-note">
                    The vault waits until this much has built up, then buys the stock and opens a
                    round holders can claim from.
                  </p>
                </label>
              </div>
            </div>
          ) : null}

          <div className="launchpad-field launchpad-field-wide">
            <span className="launchpad-label">Developer buy</span>
            <div className={cn('launchpad-buy-field', devBuyTooHigh && 'is-invalid')}>
              <div className="launchpad-buy-entry">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.devBuyEth}
                  onChange={(e) => setForm((f) => ({ ...f, devBuyEth: e.target.value }))}
                  aria-label="Developer buy amount in ETH"
                />
                <span className="launchpad-buy-token">
                  <img src="/ethereum.svg" alt="" width={18} height={18} className="token-icon" />
                  ETH
                </span>
              </div>
              <div className="launchpad-buy-meta">
                <span>
                  {maxDevBuyEth
                    ? `Max ${maxDevBuyEth} · 5% of supply`
                    : statusLoading
                      ? 'Loading max buy…'
                      : 'Max buy unavailable'}
                </span>
                {maxDevBuyEth ? (
                  <button type="button" className="convert-max" onClick={setMaxDevBuy}>
                    Max
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {error ? <div className="launchpad-alert">{error}</div> : null}
        </div>

        <footer className="launchpad-create-actions">
          <div className="convert-footer">
            <span className="convert-footer-rate">
              Robinhood, ETH {status?.launchFeeEth ?? '…'} due
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
            <dt>Trading fees</dt>
            <dd>70% creator / 30% protocol</dd>
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
                  ? burnSharePercent >= 100
                    ? '100% burned'
                    : `${burnSharePercent}% burned / ${100 - burnSharePercent}% treasury`
                  : '—'}
              </dd>
            </div>
          ) : null}
          {form.vaultTemplate === 'staking' ? (
            <div>
              <dt>Creator fees</dt>
              <dd>
                Paid to stakers
                {Number(form.vaultStakingLockDays || '0') > 0
                  ? ` · ${form.vaultStakingLockDays}d lock`
                  : ' · no lock'}
              </dd>
            </div>
          ) : null}
          {form.vaultTemplate === 'rwa' ? (
            <div>
              <dt>Creator fees</dt>
              <dd>
                {selectedRwaAsset
                  ? `Buy ${selectedRwaAsset.symbol} · claimable by holders`
                  : 'Pick a stock'}
              </dd>
            </div>
          ) : null}
          {form.vaultTemplate === 'lottery' ? (
            <div>
              <dt>Creator fees</dt>
              <dd>
                Raffle · {form.vaultLotteryEntryHours || '6'}h entry ·{' '}
                {form.vaultLotteryRevealMinutes || '30'}m reveal
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Graduation</dt>
            <dd>
              <span className="launchpad-preview-eth">
                {status?.graduationEth ?? '—'}
                <img src="/ethereum.svg" alt="" width={14} height={14} className="token-icon" />
              </span>
            </dd>
          </div>
          <div>
            <dt>Liquidity</dt>
            <dd>Locked</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
