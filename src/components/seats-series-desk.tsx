'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { encodeFunctionData, erc20Abi, formatEther, parseEther, type Address, type Hex } from 'viem';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { Loader2 } from 'lucide-react';

import {
  ERC20_ABI,
  ERC721_ABI,
  PONS_SEAT_ACCOUNT_ABI,
  PONS_SEAT_ACTIVATION_ABI,
  PONS_SEAT_AMM_ABI,
  PONS_SEAT_BOOSTER_ABI,
  PONS_SEAT_COLLECTION_ABI,
  PONS_SEAT_LOAN_ABI,
} from '@/lib/seats/abis';
import type { SeatSeries } from '@/lib/seats/types';
import { PONS_EXPLORER_URL } from '@/lib/pons/constants';
import { readSeatTradeFees, seatFeeFloor, seatLoanFeeFloor, SEAT_FEE_BPS } from '@/lib/seats/fees';
import { robinhoodPublicClient } from '@/lib/pons/client';
import { cn, ipfsToGateway, shortAddress } from '@/lib/utils';

/** One thing at a time, the way a trading desk is laid out rather than a wall of panels. */
const DESK_TABS = [
  { id: 'trade', label: 'Trade' },
  { id: 'seats', label: 'My seats' },
  { id: 'activate', label: 'Activate' },
  { id: 'distributions', label: 'Distributions' },
  { id: 'loans', label: 'Loans' },
] as const;

type DeskTab = (typeof DESK_TABS)[number]['id'];

/** Only used until the loan vault's own fee has been read; every series so far sets this. */
const FALLBACK_BORROW_FEE = seatLoanFeeFloor();

interface SeatMetadata {
  name?: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: string | number }>;
}

/** Rounds a token amount for display. Fuel supplies run to the billions, so decimals are noise. */
function formatAmount(value: bigint): string {
  const whole = Number(formatEther(value));
  if (!Number.isFinite(whole)) return formatEther(value);
  return whole.toLocaleString(undefined, { maximumFractionDigits: whole < 1 ? 6 : 2 });
}

export function SeatsSeriesDesk({ series }: { series: SeatSeries }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [tab, setTab] = useState<DeskTab>('trade');
  const [tokenId, setTokenId] = useState('1');
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const stats = useQuery({
    queryKey: ['seat-series-stats', series.seriesId],
    queryFn: async () => {
      const [
        available,
        seatPrice,
        accrued,
        threshold,
        roundCount,
        tier0,
        loanPrincipal,
        minted,
        borrowFee,
      ] = await Promise.all([
        robinhoodPublicClient.readContract({
          address: series.amm as Address,
          abi: PONS_SEAT_AMM_ABI,
          functionName: 'availableSupply',
        }),
        robinhoodPublicClient.readContract({
          address: series.amm as Address,
          abi: PONS_SEAT_AMM_ABI,
          functionName: 'seatPrice',
        }),
        robinhoodPublicClient.readContract({
          address: series.booster as Address,
          abi: PONS_SEAT_BOOSTER_ABI,
          functionName: 'accruedEth',
        }),
        robinhoodPublicClient.readContract({
          address: series.booster as Address,
          abi: PONS_SEAT_BOOSTER_ABI,
          functionName: 'threshold',
        }),
        robinhoodPublicClient.readContract({
          address: series.booster as Address,
          abi: PONS_SEAT_BOOSTER_ABI,
          functionName: 'roundCount',
        }),
        robinhoodPublicClient.readContract({
          address: series.activation as Address,
          abi: PONS_SEAT_ACTIVATION_ABI,
          functionName: 'tiers',
          args: [0n],
        }),
        robinhoodPublicClient.readContract({
          address: series.loan as Address,
          abi: PONS_SEAT_LOAN_ABI,
          functionName: 'principalAmount',
        }),
        robinhoodPublicClient.readContract({
          address: series.collection as Address,
          abi: PONS_SEAT_COLLECTION_ABI,
          functionName: 'totalMinted',
        }),
        robinhoodPublicClient.readContract({
          address: series.loan as Address,
          abi: PONS_SEAT_LOAN_ABI,
          functionName: 'minEthFee',
        }),
      ]);
      return {
        available,
        seatPrice,
        accrued,
        threshold,
        roundCount,
        tier0,
        loanPrincipal,
        minted,
        borrowFee,
      };
    },
    refetchInterval: 12_000,
  });

  /**
   * What each trade has to carry in ETH.
   *
   * A percentage of what the seat is actually worth, priced through the fuel curve, so a series
   * with cheap seats does not charge the same as one with expensive ones. Falls back to the floor
   * the contract enforces whenever the seat cannot be priced.
   */
  const fees = useQuery({
    queryKey: ['seat-fees', series.seriesId, stats.data?.seatPrice?.toString()],
    enabled: Boolean(stats.data?.seatPrice),
    queryFn: () => readSeatTradeFees(series.token as Address, stats.data!.seatPrice),
    refetchInterval: 60_000,
  });

  /** What the connected wallet holds: fuel to spend, and seats already owned. */
  const wallet = useQuery({
    queryKey: ['seat-series-wallet', series.seriesId, address],
    enabled: Boolean(address),
    queryFn: async () => {
      const [fuel, seats] = await Promise.all([
        robinhoodPublicClient.readContract({
          address: series.token as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address as Address],
        }),
        robinhoodPublicClient.readContract({
          address: series.collection as Address,
          abi: PONS_SEAT_COLLECTION_ABI,
          functionName: 'balanceOf',
          args: [address as Address],
        }),
      ]);
      return { fuel, seats };
    },
    refetchInterval: 15_000,
  });

  /**
   * The seat in the box: who owns it, and its art.
   *
   * Seats are minted on purchase, so most ids have no owner and no tokenURI yet — that is not an
   * error, it is what "still for sale" looks like, and it is the thing a sniper wants to know.
   */
  const seat = useQuery({
    queryKey: ['seat-inspect', series.seriesId, tokenId],
    enabled: Boolean(tokenId.trim()) && Number(tokenId) > 0,
    queryFn: async () => {
      const id = BigInt(tokenId);
      const minted = await robinhoodPublicClient.readContract({
        address: series.collection as Address,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'isMinted',
        args: [id],
      });
      if (!minted) return { minted: false as const };

      const [owner, uri] = await Promise.all([
        robinhoodPublicClient.readContract({
          address: series.collection as Address,
          abi: PONS_SEAT_COLLECTION_ABI,
          functionName: 'ownerOf',
          args: [id],
        }),
        robinhoodPublicClient.readContract({
          address: series.collection as Address,
          abi: PONS_SEAT_COLLECTION_ABI,
          functionName: 'tokenURI',
          args: [id],
        }),
      ]);

      let metadata: SeatMetadata | null = null;
      try {
        const res = await fetch(ipfsToGateway(uri));
        if (res.ok) metadata = (await res.json()) as SeatMetadata;
      } catch {
        // Art is a nicety; the seat is still tradeable if the gateway is having a moment.
      }
      return { minted: true as const, owner, metadata };
    },
  });

  /**
   * The wallet the seat itself owns, where delivered rewards land.
   *
   * Its address is fixed from the moment the seat is minted and can hold funds straight away, but
   * the wallet is only deployed on demand — so a seat can be sitting on ETH with no code at that
   * address yet, and deploying is the step between seeing the money and being able to move it.
   */
  const seatWallet = useQuery({
    queryKey: ['seat-wallet', series.seriesId, tokenId],
    enabled: Boolean(seat.data?.minted),
    queryFn: async () => {
      const seatId = BigInt(tokenId);
      const account = await robinhoodPublicClient.readContract({
        address: series.collection as Address,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'accountOf',
        args: [seatId],
      });
      const [eth, fuel, code] = await Promise.all([
        robinhoodPublicClient.getBalance({ address: account }),
        robinhoodPublicClient.readContract({
          address: series.token as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [account],
        }),
        robinhoodPublicClient.getCode({ address: account }),
      ]);
      return { account, eth, fuel, deployed: Boolean(code && code !== '0x') };
    },
    refetchInterval: 15_000,
  });

  /**
   * Whether the art is still sealed, and when it stops being.
   *
   * Series created before sealing existed have none of these functions, and a read that reverts
   * there just means the art was public all along.
   */
  const reveal = useQuery({
    queryKey: ['seat-reveal', series.seriesId],
    queryFn: async () => {
      try {
        const [revealed, revealable, revealAfter] = await Promise.all([
          robinhoodPublicClient.readContract({
            address: series.collection as Address,
            abi: PONS_SEAT_COLLECTION_ABI,
            functionName: 'revealed',
          }),
          robinhoodPublicClient.readContract({
            address: series.collection as Address,
            abi: PONS_SEAT_COLLECTION_ABI,
            functionName: 'revealable',
          }),
          robinhoodPublicClient.readContract({
            address: series.collection as Address,
            abi: PONS_SEAT_COLLECTION_ABI,
            functionName: 'revealAfter',
          }),
        ]);
        return { revealed, revealable, revealAfter };
      } catch {
        return { revealed: true, revealable: false, revealAfter: 0n };
      }
    },
    refetchInterval: 30_000,
  });

  async function ensureErc20(spender: Address, amount: bigint) {
    if (!walletClient || !publicClient) throw new Error('Wallet required');
    const owner = walletClient.account.address;
    const allowance = await publicClient.readContract({
      address: series.token as Address,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    });
    if (allowance >= amount) return;
    const hash = await walletClient.writeContract({
      address: series.token as Address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: hash as Hex });
  }

  async function ensureNft(spender: Address, id: bigint) {
    if (!walletClient || !publicClient) throw new Error('Wallet required');
    const hash = await walletClient.writeContract({
      address: series.collection as Address,
      abi: ERC721_ABI,
      functionName: 'approve',
      args: [spender, id],
    });
    await publicClient.waitForTransactionReceipt({ hash: hash as Hex });
  }

  async function run(label: string, fn: () => Promise<Hex>) {
    if (!walletClient || !publicClient) {
      setFailed(true);
      setStatus('Connect a wallet first.');
      return;
    }
    setBusy(true);
    setFailed(false);
    setStatus(label);
    try {
      const hash = await fn();
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus('Done.');
      await Promise.all([
        stats.refetch(),
        wallet.refetch(),
        seat.refetch(),
        seatWallet.refetch(),
        reveal.refetch(),
      ]);
    } catch (err) {
      setFailed(true);
      setStatus(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const seatPrice = stats.data?.seatPrice ?? 0n;
  const ethFees = {
    buy: fees.data?.buy ?? seatFeeFloor('buy'),
    sell: fees.data?.sell ?? seatFeeFloor('sell'),
    snipe: fees.data?.snipe ?? seatFeeFloor('snipe'),
    borrow: stats.data?.borrowFee ?? FALLBACK_BORROW_FEE,
  };
  const id = BigInt(Number(tokenId) > 0 ? tokenId : '0');
  const activationFee = stats.data?.tier0[0] ?? parseEther('66666');
  const canTrade = busy || !isConnected;
  const hasSeatId = Boolean(tokenId.trim()) && id > 0n;
  /** Selling, activating and borrowing all revert for anyone but the seat's owner. */
  const ownsSeat = Boolean(
    seat.data?.minted && seat.data.owner?.toLowerCase() === address?.toLowerCase(),
  );
  const shortFuel = `$${series.symbol}`;
  /**
   * Where the ETH fee came from. Cheap seats sit under the floor the contract enforces, so saying
   * "10% of a seat" there would not match the number next to it.
   */
  const seatWorth = fees.data?.seatValueEth;
  const rates = `${SEAT_FEE_BPS.buy / 100}% and ${SEAT_FEE_BPS.snipe / 100}%`;
  const feeBasis = !seatWorth
    ? `${rates} of a seat, floored while the price cannot be read off the curve`
    : ethFees.buy === seatFeeFloor('buy')
      ? `the shop's floor, since ${rates} of what a seat is worth (${Number(
          formatEther(seatWorth),
        ).toLocaleString(undefined, { maximumSignificantDigits: 3 })} ETH on the ${shortFuel} curve) comes to less`
      : `${rates} of what a seat is worth (${Number(formatEther(seatWorth)).toLocaleString(
          undefined,
          { maximumSignificantDigits: 3 },
        )} ETH on the ${shortFuel} curve)`;
  const potReady = stats.data ? stats.data.accrued >= stats.data.threshold : false;
  const outOfFuel = Boolean(wallet.data && wallet.data.fuel < seatPrice && seatPrice > 0n);

  const sealed = Boolean(reveal.data && !reveal.data.revealed);
  const revealDate = reveal.data?.revealAfter
    ? new Date(Number(reveal.data.revealAfter) * 1000)
    : null;

  /**
   * Pulls the committed pack and hands it to the collection.
   *
   * The URI only comes back once the chain agrees the sale is over, and the collection checks it
   * against the commitment, so it does not matter who presses this.
   */
  async function revealArt() {
    await run('Revealing the art…', async () => {
      const res = await fetch(`/api/seats/reveal?collection=${series.collection}`);
      const data = (await res.json()) as { baseTokenURI?: string; error?: string };
      if (!res.ok || !data.baseTokenURI) throw new Error(data.error ?? 'Could not find the pack.');
      return walletClient!.writeContract({
        address: series.collection as Address,
        abi: PONS_SEAT_COLLECTION_ABI,
        functionName: 'reveal',
        args: [data.baseTokenURI],
      }) as Promise<Hex>;
    });
  }

  const contracts: Array<{ label: string; address: string }> = [
    { label: `Fuel ${shortFuel}`, address: series.token },
    { label: 'Collection', address: series.collection },
    { label: 'Shop (AMM)', address: series.amm },
    { label: 'Activation', address: series.activation },
    { label: 'Booster', address: series.booster },
    { label: 'Loan vault', address: series.loan },
  ];

  return (
    <div className="seat-desk">
      <div className="seat-desk-stats">
        <div className="seat-stat">
          <span className="seat-stat-label">Seats for sale</span>
          <span className="seat-stat-value">
            {stats.data ? stats.data.available.toLocaleString() : '—'}
          </span>
          <span className="seat-stat-note">
            {stats.data
              ? `${stats.data.minted.toLocaleString()} of ${series.maxSupply.toLocaleString()} minted`
              : 'loading'}
          </span>
        </div>
        <div className="seat-stat">
          <span className="seat-stat-label">Price per seat</span>
          <span className="seat-stat-value">
            {stats.data ? formatAmount(stats.data.seatPrice) : '—'}
          </span>
          <span className="seat-stat-note">{shortFuel} per seat</span>
        </div>
        <div className="seat-stat">
          <span className="seat-stat-label">Reward pot</span>
          <span className="seat-stat-value">
            {stats.data ? Number(formatEther(stats.data.accrued)).toFixed(4) : '—'}
          </span>
          <span className="seat-stat-note">
            {stats.data
              ? `${potReady ? 'ready to distribute' : 'of'} ${formatEther(stats.data.threshold)} ETH`
              : 'ETH'}
          </span>
        </div>
        <div className="seat-stat">
          <span className="seat-stat-label">Loan principal</span>
          <span className="seat-stat-value">
            {stats.data ? formatAmount(stats.data.loanPrincipal) : '—'}
          </span>
          <span className="seat-stat-note">{shortFuel} against one seat</span>
        </div>
      </div>

      {sealed ? (
        <section className="seat-reveal">
          <div className="seat-reveal-body">
            <span className="seat-tag is-sealed">Sealed</span>
            <p>
              Every seat shows the same card until the art is revealed, so nobody can tell which
              seat holds which piece — including whoever launched it. The pack was fixed before the
              first sale and the series only accepts that one pack, so what appears is what was
              dealt.
            </p>
            <p className="seat-reveal-when">
              {reveal.data?.revealable
                ? 'The sale is over. Anyone can reveal it now.'
                : `Reveals when all ${series.maxSupply.toLocaleString()} seats are sold${
                    revealDate ? `, or on ${revealDate.toLocaleDateString()}` : ''
                  }.`}
            </p>
          </div>
          <button
            type="button"
            className="pv-btn pv-btn-primary"
            disabled={busy || !isConnected || !reveal.data?.revealable}
            onClick={revealArt}
          >
            Reveal the art
          </button>
        </section>
      ) : null}

      <section className="seat-desk-focus">
        <div className="seat-inspect">
          <div className="seat-inspect-art">
            {seat.data?.minted && seat.data.metadata?.image ? (
              // Series art is creator-supplied IPFS, so it cannot go through the Next image loader.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ipfsToGateway(seat.data.metadata.image)} alt={`Seat #${tokenId}`} />
            ) : (
              <div className="seat-inspect-art-empty">
                {seat.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : `#${tokenId || '—'}`}
              </div>
            )}
          </div>

          <div className="seat-inspect-body">
            <label className="seat-inspect-field">
              <span>Seat number</span>
              <input
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="e.g. 17"
                aria-label="Seat number"
              />
            </label>

            {!hasSeatId ? (
              <p className="seat-inspect-state">
                Type a seat number between 1 and {series.maxSupply.toString()}.
              </p>
            ) : seat.isLoading ? (
              <p className="seat-inspect-state">Checking seat #{tokenId}…</p>
            ) : seat.data?.minted ? (
              <>
                <p className="seat-inspect-state">
                  <span className="seat-tag is-taken">Owned</span>
                  {seat.data.owner?.toLowerCase() === address?.toLowerCase()
                    ? ' by you'
                    : ` by ${shortAddress(seat.data.owner ?? '')}`}
                </p>
                {seat.data.metadata?.name ? (
                  <p className="seat-inspect-name">{seat.data.metadata.name}</p>
                ) : null}
                {seat.data.metadata?.attributes?.length ? (
                  <ul className="seat-inspect-traits">
                    {seat.data.metadata.attributes.map((trait) => (
                      <li key={`${trait.trait_type}-${trait.value}`}>
                        <span>{trait.trait_type}</span>
                        <strong>{String(trait.value)}</strong>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="seat-inspect-state">
                <span className="seat-tag is-free">For sale</span> nobody has minted #{tokenId} yet,
                so you can snipe it.
              </p>
            )}
            <p className="seat-inspect-hint">
              This seat is what every tab below acts on.
            </p>
          </div>
        </div>
      </section>

      <nav className="seat-tabs" role="tablist" aria-label="Series desk">
        {DESK_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={cn('seat-tab', tab === entry.id && 'is-active')}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="seat-tabpanel" role="tabpanel">
        {tab === 'trade' ? (
          <section className="seat-desk-panel">
            <header className="seat-desk-panel-head">
              <h2 className="seat-desk-panel-title">Trade</h2>
              <p className="seat-desk-panel-note">
                <strong>Buy next</strong> takes whichever seat is next in line and costs the least
                ETH. <strong>Snipe</strong> takes the exact number above — same {shortFuel} price,
                higher ETH fee — and works on any seat nobody owns yet.
                {sealed
                  ? ' While the series is sealed, both are the same gamble: no seat looks different from another.'
                  : ' So you can go straight for the art you want.'}
              </p>
            </header>

            <div className="seat-desk-actions">
              <button
                type="button"
                className="pv-btn pv-btn-primary"
                disabled={canTrade}
                onClick={() =>
                  run('Buying the next seat…', async () => {
                    await ensureErc20(series.amm as Address, seatPrice);
                    return walletClient!.writeContract({
                      address: series.amm as Address,
                      abi: PONS_SEAT_AMM_ABI,
                      functionName: 'buy',
                      value: ethFees.buy,
                    }) as Promise<Hex>;
                  })
                }
              >
                Buy next seat
              </button>

              <button
                type="button"
                className="pv-btn pv-btn-secondary"
                disabled={canTrade || !hasSeatId || Boolean(seat.data?.minted)}
                onClick={() =>
                  run(`Sniping #${tokenId}…`, async () => {
                    await ensureErc20(series.amm as Address, seatPrice);
                    return walletClient!.writeContract({
                      address: series.amm as Address,
                      abi: PONS_SEAT_AMM_ABI,
                      functionName: 'snipe',
                      args: [id],
                      value: ethFees.snipe,
                    }) as Promise<Hex>;
                  })
                }
              >
                Snipe #{tokenId || '…'}
              </button>

              <button
                type="button"
                className="pv-btn pv-btn-secondary"
                disabled={canTrade || !ownsSeat}
                onClick={() =>
                  run(`Selling #${tokenId}…`, async () => {
                    await ensureNft(series.amm as Address, id);
                    return walletClient!.writeContract({
                      address: series.amm as Address,
                      abi: PONS_SEAT_AMM_ABI,
                      functionName: 'sell',
                      args: [id],
                      value: ethFees.sell,
                    }) as Promise<Hex>;
                  })
                }
              >
                Sell #{tokenId || '…'} back
              </button>
            </div>

            <p className="seat-desk-fee-note">
              ETH fee: {formatEther(ethFees.buy)} to buy or sell, {formatEther(ethFees.snipe)} to
              snipe — {feeBasis}. Every wei of it goes into the reward pot and back out to activated
              seats.
            </p>
          </section>
        ) : null}

        {tab === 'seats' ? (
          <>
            <section className="seat-desk-panel">
              <header className="seat-desk-panel-head">
                <h2 className="seat-desk-panel-title">Your position</h2>
              </header>
              {isConnected ? (
                <>
                  <dl className="seat-desk-kv">
                    <div>
                      <dt>{shortFuel} balance</dt>
                      <dd>{wallet.data ? formatAmount(wallet.data.fuel) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Seats owned</dt>
                      <dd>{wallet.data ? wallet.data.seats.toString() : '—'}</dd>
                    </div>
                  </dl>
                  {outOfFuel ? (
                    <p className="seat-desk-warn">
                      You need {formatAmount(seatPrice)} {shortFuel} to buy a seat and hold{' '}
                      {formatAmount(wallet.data?.fuel ?? 0n)}. {shortFuel} trades on a pons curve, so
                      buy some there first.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="seat-desk-panel-note">Connect a wallet to see your fuel and seats.</p>
              )}
            </section>

            <section className="seat-desk-panel">
              <header className="seat-desk-panel-head">
                <h2 className="seat-desk-panel-title">Seat wallet</h2>
                <p className="seat-desk-panel-note">
                  Every seat owns a wallet, and delivered rewards land there rather than in yours. It
                  belongs to the NFT, so whatever is left inside goes with the seat when you sell it.
                </p>
              </header>

              {!seat.data ? (
                <p className="seat-desk-panel-note">
                  {hasSeatId ? 'Looking up that seat…' : 'Pick a seat above to see its wallet.'}
                </p>
              ) : !seat.data.minted ? (
                <p className="seat-desk-panel-note">
                  Seat #{tokenId} has not been minted yet, so it has no wallet.
                </p>
              ) : (
                <>
                  <dl className="seat-desk-kv">
                    <div>
                      <dt>Holds</dt>
                      <dd>
                        {seatWallet.data
                          ? `${Number(formatEther(seatWallet.data.eth)).toFixed(4)} ETH`
                          : '—'}
                      </dd>
                    </div>
                    {seatWallet.data && seatWallet.data.fuel > 0n ? (
                      <div>
                        <dt>and {shortFuel}</dt>
                        <dd>{formatAmount(seatWallet.data.fuel)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Address</dt>
                      <dd>
                        {seatWallet.data ? (
                          <a
                            href={`${PONS_EXPLORER_URL}/address/${seatWallet.data.account}`}
                            target="_blank"
                            rel="noreferrer"
                            className="link"
                          >
                            {shortAddress(seatWallet.data.account, 6)}
                          </a>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="seat-desk-actions">
                    {seatWallet.data && !seatWallet.data.deployed ? (
                      <button
                        type="button"
                        className={
                          seatWallet.data.eth > 0n
                            ? 'pv-btn pv-btn-primary'
                            : 'pv-btn pv-btn-secondary'
                        }
                        disabled={canTrade}
                        onClick={() =>
                          run(`Deploying the wallet for #${tokenId}…`, async () =>
                            walletClient!.writeContract({
                              address: series.collection as Address,
                              abi: PONS_SEAT_COLLECTION_ABI,
                              functionName: 'createAccount',
                              args: [id],
                            }) as Promise<Hex>,
                          )
                        }
                      >
                        Deploy wallet
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="pv-btn pv-btn-primary"
                          disabled={canTrade || !ownsSeat || !seatWallet.data?.eth}
                          onClick={() =>
                            run(`Withdrawing from #${tokenId}…`, async () =>
                              walletClient!.writeContract({
                                address: seatWallet.data!.account,
                                abi: PONS_SEAT_ACCOUNT_ABI,
                                functionName: 'execute',
                                args: [address as Address, seatWallet.data!.eth, '0x'],
                              }) as Promise<Hex>,
                            )
                          }
                        >
                          Withdraw{' '}
                          {seatWallet.data?.eth
                            ? `${Number(formatEther(seatWallet.data.eth)).toFixed(4)} ETH`
                            : 'ETH'}
                        </button>
                        {seatWallet.data && seatWallet.data.fuel > 0n ? (
                          <button
                            type="button"
                            className="pv-btn pv-btn-secondary"
                            disabled={canTrade || !ownsSeat}
                            onClick={() =>
                              run(`Withdrawing ${shortFuel} from #${tokenId}…`, async () =>
                                walletClient!.writeContract({
                                  address: seatWallet.data!.account,
                                  abi: PONS_SEAT_ACCOUNT_ABI,
                                  functionName: 'execute',
                                  args: [
                                    series.token as Address,
                                    0n,
                                    encodeFunctionData({
                                      abi: erc20Abi,
                                      functionName: 'transfer',
                                      args: [address as Address, seatWallet.data!.fuel],
                                    }),
                                  ],
                                }) as Promise<Hex>,
                              )
                            }
                          >
                            Withdraw {shortFuel}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>

                  {seatWallet.data && !seatWallet.data.deployed ? (
                    <p className="seat-desk-panel-note">
                      The wallet has an address but no code yet. Deploying it costs one transaction
                      and anyone can pay for it; after that the seat&apos;s owner can move what is
                      inside.
                    </p>
                  ) : null}
                  {seatWallet.data?.deployed && !ownsSeat ? (
                    <p className="seat-desk-panel-note">
                      Only whoever holds seat #{tokenId} can move what is inside.
                    </p>
                  ) : null}
                </>
              )}
            </section>
          </>
        ) : null}

        {tab === 'activate' ? (
          <section className="seat-desk-panel">
            <header className="seat-desk-panel-head">
              <h2 className="seat-desk-panel-title">Activate</h2>
              <p className="seat-desk-panel-note">
                An activated seat is on the payroll: it draws from every reward round opened after
                it joined. Selling or transferring a seat switches it back off, and the new owner
                has to activate it again.
              </p>
            </header>
            <div className="seat-desk-actions">
              <button
                type="button"
                className="pv-btn pv-btn-primary"
                disabled={canTrade || !ownsSeat}
                onClick={() =>
                  run(`Activating #${tokenId}…`, async () => {
                    await ensureErc20(series.activation as Address, activationFee);
                    return walletClient!.writeContract({
                      address: series.activation as Address,
                      abi: PONS_SEAT_ACTIVATION_ABI,
                      functionName: 'activate',
                      args: [id, 0],
                    }) as Promise<Hex>;
                  })
                }
              >
                Activate #{tokenId || '…'} ({formatAmount(activationFee)} {shortFuel})
              </button>
            </div>
            {!ownsSeat && hasSeatId ? (
              <p className="seat-desk-panel-note">Only the seat&apos;s owner can activate it.</p>
            ) : null}
          </section>
        ) : null}

        {tab === 'distributions' ? (
          <section className="seat-desk-panel">
            <header className="seat-desk-panel-head">
              <h2 className="seat-desk-panel-title">Distributions</h2>
              <p className="seat-desk-panel-note">
                Trade fees pile up in the pot. Once it reaches the threshold anyone can open a
                round, which splits the pot across every activated seat by tier weight. Delivering
                pays one seat its share into that seat&apos;s own wallet.
              </p>
            </header>
            <dl className="seat-desk-kv">
              <div>
                <dt>In the pot</dt>
                <dd>
                  {stats.data
                    ? `${Number(formatEther(stats.data.accrued)).toFixed(4)} of ${formatEther(
                        stats.data.threshold,
                      )} ETH`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Rounds opened</dt>
                <dd>{stats.data ? stats.data.roundCount.toString() : '—'}</dd>
              </div>
            </dl>
            <div className="seat-desk-actions">
              <button
                type="button"
                className={potReady ? 'pv-btn pv-btn-primary' : 'pv-btn pv-btn-secondary'}
                disabled={canTrade}
                onClick={() =>
                  run('Distributing the pot…', async () =>
                    walletClient!.writeContract({
                      address: series.booster as Address,
                      abi: PONS_SEAT_BOOSTER_ABI,
                      functionName: 'crank',
                    }) as Promise<Hex>,
                  )
                }
              >
                Distribute
              </button>

              <button
                type="button"
                className="pv-btn pv-btn-secondary"
                disabled={canTrade || !hasSeatId}
                onClick={() =>
                  run(`Delivering to #${tokenId}…`, async () => {
                    const roundId = stats.data?.roundCount ?? 0n;
                    if (roundId === 0n) throw new Error('No rounds yet — distribute the pot first.');
                    return walletClient!.writeContract({
                      address: series.booster as Address,
                      abi: PONS_SEAT_BOOSTER_ABI,
                      functionName: 'deliver',
                      args: [roundId, id],
                    }) as Promise<Hex>;
                  })
                }
              >
                Deliver to #{tokenId || '…'}
              </button>
            </div>
          </section>
        ) : null}

        {tab === 'loans' ? (
          <section className="seat-desk-panel">
            <header className="seat-desk-panel-head">
              <h2 className="seat-desk-panel-title">Loans</h2>
              <p className="seat-desk-panel-note">
                Lock a seat as collateral for {formatAmount(stats.data?.loanPrincipal ?? 0n)}{' '}
                {shortFuel}, then repay the same amount to get it back. Borrowing costs{' '}
                {formatEther(ethFees.borrow)} ETH upfront. Miss the term and the seat can be
                liquidated.
              </p>
            </header>
            <div className="seat-desk-actions">
              <button
                type="button"
                className="pv-btn pv-btn-primary"
                disabled={canTrade || !ownsSeat}
                onClick={() =>
                  run(`Borrowing against #${tokenId}…`, async () => {
                    await ensureNft(series.loan as Address, id);
                    return walletClient!.writeContract({
                      address: series.loan as Address,
                      abi: PONS_SEAT_LOAN_ABI,
                      functionName: 'borrow',
                      args: [id],
                      value: ethFees.borrow,
                    }) as Promise<Hex>;
                  })
                }
              >
                Borrow against #{tokenId || '…'}
              </button>
              <button
                type="button"
                className="pv-btn pv-btn-secondary"
                disabled={canTrade || !hasSeatId}
                onClick={() =>
                  run(`Repaying #${tokenId}…`, async () => {
                    const principal = stats.data?.loanPrincipal ?? seatPrice;
                    await ensureErc20(series.loan as Address, principal);
                    return walletClient!.writeContract({
                      address: series.loan as Address,
                      abi: PONS_SEAT_LOAN_ABI,
                      functionName: 'repay',
                      args: [id],
                    }) as Promise<Hex>;
                  })
                }
              >
                Repay #{tokenId || '…'}
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {status ? (
        <p className={failed ? 'seat-desk-status is-error' : 'seat-desk-status'}>
          {busy ? <Loader2 className="mr-2 inline h-3 w-3 animate-spin" /> : null}
          {status}
        </p>
      ) : null}

      <section className="seat-desk-panel">
        <header className="seat-desk-panel-head">
          <h2 className="seat-desk-panel-title">Contracts</h2>
        </header>
        <dl className="seat-desk-contracts">
          {contracts.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>
                <a
                  href={`${PONS_EXPLORER_URL}/address/${entry.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link"
                >
                  {shortAddress(entry.address, 6)}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
