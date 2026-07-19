'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ImageIcon, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  useAccount,
  useBalance,
  useConnect,
  useSwitchChain,
  useWalletClient,
} from 'wagmi';
import { parseEther } from 'viem';

import {
  fetchLaunchpadStatus,
  uploadTokenImage,
  verifyLaunchedToken,
} from '@/lib/pons/api';
import { resolveSocialFeeWallet, lookupSocialFeeWallet } from '@/lib/fee-share/api';
import { isValidSocialHandle } from '@/lib/fee-share/social';
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
import type { LaunchFormInput } from '@/lib/pons/types';
import { cn, ipfsToGateway, shortAddress } from '@/lib/utils';

const emptyForm: LaunchFormInput = {
  name: '',
  symbol: '',
  description: '',
  imageUri: '',
  twitter: '',
  telegram: '',
  website: '',
  devBuyEth: '',
  useFeeShare: false,
  feeShareMode: 'social',
  feeSharePlatform: 'twitter',
  feeShareHandle: '',
  feeShareWallet: '',
};

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
  const router = useRouter();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['launchpad-status'],
    queryFn: fetchLaunchpadStatus,
    refetchInterval: 60_000,
  });

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
    isValidWebsiteUrl(form.website) &&
    (!form.useFeeShare ||
      (form.feeShareMode === 'wallet'
        ? isValidEthAddress(form.feeShareWallet)
        : isValidSocialHandle(form.feeSharePlatform, form.feeShareHandle)));

  const validationError = useMemo(
    () => validateLaunchInput(form, status),
    [form, status],
  );

  const socialHandleReady =
    form.useFeeShare &&
    form.feeShareMode === 'social' &&
    isValidSocialHandle(form.feeSharePlatform, form.feeShareHandle);

  const { data: socialWalletLookup, isFetching: socialWalletLookupLoading } = useQuery({
    queryKey: ['fee-share-wallet-lookup', form.feeSharePlatform, form.feeShareHandle],
    queryFn: () => lookupSocialFeeWallet(form.feeSharePlatform, form.feeShareHandle),
    enabled: socialHandleReady,
    staleTime: 30_000,
  });

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

    try {
      let feeWalletOverride: `0x${string}` | undefined;
      if (form.useFeeShare) {
        if (form.feeShareMode === 'wallet') {
          feeWalletOverride = normalizeEthAddress(form.feeShareWallet);
        } else {
          setStatusText('Resolving social fee wallet…');
          const resolved = await resolveSocialFeeWallet(
            form.feeSharePlatform,
            form.feeShareHandle,
          );
          feeWalletOverride = resolved.walletAddress;
        }
      }

      const metadata = buildLaunchMetadata(form, address, feeWalletOverride);
      const value = computeLaunchValue(status, form.devBuyEth);
      const data = encodeLaunchTransaction(metadata, status, form.devBuyEth);

      setStatusText('Confirm in your wallet…');
      const hash = await walletClient.sendTransaction({
        account: address,
        chain: robinhoodChain,
        to: PONS_FACTORY,
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
      const token = extractLaunchedToken(receipt);

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
          feeWallet: metadata.feeWallet,
          feeSharePlatform:
            form.useFeeShare && form.feeShareMode === 'social'
              ? form.feeSharePlatform
              : undefined,
          feeShareHandle:
            form.useFeeShare && form.feeShareMode === 'social'
              ? form.feeShareHandle
              : undefined,
          transactionHash: hash,
          launchedAt: new Date().toISOString(),
        }),
      }).catch(() => undefined);

      if (form.useFeeShare && form.feeShareMode === 'social' && form.feeShareHandle.trim()) {
        await fetch('/api/fee-share/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: form.feeSharePlatform,
            handle: form.feeShareHandle,
            token,
            symbol: metadata.symbol,
            name: metadata.name,
            transactionHash: hash,
          }),
        }).catch(() => undefined);
      }

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
          <h1 className="split-shell-title">Launch token</h1>
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
            <label className="launchpad-field-note">
              <input
                type="checkbox"
                checked={form.useFeeShare}
                onChange={(e) =>
                  setForm((f) => ({ ...f, useFeeShare: e.target.checked }))
                }
              />
              Share creator fees through socials or wallet
            </label>
            {form.useFeeShare ? (
              <div className="launchpad-fee-share mt-3">
                <div className="launchpad-fee-share-platforms">
                  <button
                    type="button"
                    aria-pressed={form.feeShareMode === 'social'}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        feeShareMode: 'social',
                      }))
                    }
                    className={cn(
                      'launchpad-fee-mode',
                      form.feeShareMode === 'social' && 'is-active',
                    )}
                  >
                    Social
                  </button>
                  <button
                    type="button"
                    aria-pressed={form.feeShareMode === 'wallet'}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        feeShareMode: 'wallet',
                      }))
                    }
                    className={cn(
                      'launchpad-fee-mode',
                      form.feeShareMode === 'wallet' && 'is-active',
                    )}
                  >
                    Wallet
                  </button>
                </div>

                {form.feeShareMode === 'wallet' ? (
                  <input
                    className="launchpad-input mt-3 font-mono text-sm"
                    value={form.feeShareWallet}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, feeShareWallet: e.target.value }))
                    }
                    placeholder="0x…"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Fee recipient wallet address"
                  />
                ) : (
                  <>
                    <div className="launchpad-fee-share-platforms mt-3">
                      <button
                        type="button"
                        aria-label="Share fees on X"
                        aria-pressed={form.feeSharePlatform === 'twitter'}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            feeSharePlatform: 'twitter',
                            feeShareHandle: '',
                          }))
                        }
                        className={cn(
                          'launchpad-fee-platform',
                          form.feeSharePlatform === 'twitter' && 'is-active',
                        )}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="launchpad-fee-platform-icon">
                          <path
                            fill="currentColor"
                            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label="Share fees on GitHub"
                        aria-pressed={form.feeSharePlatform === 'github'}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            feeSharePlatform: 'github',
                            feeShareHandle: '',
                          }))
                        }
                        className={cn(
                          'launchpad-fee-platform',
                          form.feeSharePlatform === 'github' && 'is-active',
                        )}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="launchpad-fee-platform-icon">
                          <path
                            fill="currentColor"
                            d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
                          />
                        </svg>
                      </button>
                    </div>
                    <input
                      className="launchpad-input mt-3"
                      value={form.feeShareHandle}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, feeShareHandle: e.target.value }))
                      }
                      placeholder={
                        form.feeSharePlatform === 'github'
                          ? 'github_username'
                          : 'creator_handle'
                      }
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={
                        form.feeSharePlatform === 'github'
                          ? 'GitHub username for fee sharing'
                          : 'X handle for fee sharing'
                      }
                    />
                    {socialHandleReady ? (
                      <p className="launchpad-field-note mt-2">
                        {socialWalletLookupLoading
                          ? 'Checking for an existing fee wallet…'
                          : socialWalletLookup?.exists
                            ? `Using existing wallet ${shortAddress(socialWalletLookup.walletAddress ?? '', 6)}. They can claim by logging in with this account.`
                            : 'No wallet yet — one will be created and saved for this account at launch.'}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>

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
