import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { SeatsGrid } from '@/components/seats-grid';
import { Reveal } from '@/components/ui/reveal';

export const metadata: Metadata = {
  title: 'Vault Seats · PonsVault',
  description:
    'Buy seat NFTs with a series $TOKEN, activate for rewards, or launch your own NFT + $TOKEN series.',
};

/** Buyer loop — same shape as a collection “how it works” strip: Get → Trade → wallet → Activate → payout. */
const BUYER_STEPS = [
  {
    title: 'Get $TOKEN',
    body: 'Every series runs on a fuel token — an ERC-20 you need to buy a seat NFT and to activate it for rewards. Most series launch their fuel on a pons curve, so you can buy it there with ETH (or whatever asset that series priced it in). If a series minted its fuel to the creator instead, they have to send you some.',
  },
  {
    title: 'Trade for a seat',
    body: 'On the series page: Buy next takes the next NFT in line, or type a number and Snipe that exact # if nobody owns it yet. Same $TOKEN price either way; snipe pays a higher ETH fee. Your seat NFT is minted when you buy it, so you pay the gas for your own.',
  },
  {
    title: 'Wait for the reveal',
    body: 'A series on the house art pack sells sealed: every seat shows the same card until the art appears, so nobody can pick out the rare ones in advance — the creator cannot either. It reveals when the series sells out, or seven days after it launched, whichever comes first. The pack is locked in by a hash before the first sale, so the reveal can only produce the hand that was already dealt.',
  },
  {
    title: 'Seat wallet',
    body: 'Every seat NFT has a built-in wallet. Rewards land there and travel with the NFT if you sell it.',
  },
  {
    title: 'Activate for rewards',
    body: 'Pay a tiered $TOKEN fee to put your seat on the reward list. Selling or transferring the NFT clears activation — the new owner must activate again.',
  },
  {
    title: 'Distribute the pot',
    body: 'Trade fees fill an ETH bar. When it is full, any wallet can hit Distribute and pay gas: activated seats share the pot by tier, pushed into each seat wallet (or claim with Deliver).',
  },
];

const DESK_FEATURES = [
  {
    name: 'Buy',
    body: 'Swap $TOKEN for the next seat NFT in the shop at the series’ fixed price + ETH trade fee.',
  },
  {
    name: 'Snipe',
    body: 'Swap $TOKEN for one specific seat #, whether it was sold back or has never been minted. Same $TOKEN price, higher ETH fee than Buy.',
  },
  {
    name: 'Sell',
    body: 'Send your seat NFT back to the shop and receive $TOKEN (minus the trade fee).',
  },
  {
    name: 'Activate',
    body: 'Pay $TOKEN to join the reward payroll (tier weighted). Clears on transfer.',
  },
  {
    name: 'Distribute',
    body: 'When the ETH pot is full, anyone can start a payout. Activated NFTs share it by tier.',
  },
  {
    name: 'Borrow',
    body: 'Lock a seat NFT and borrow $TOKEN principal against it. Repay to unlock, or risk liquidation after due.',
  },
];

export default function SeatsPage() {
  return (
    <main className="pv-page">
      <section className="pv-page-hero">
        <div className="pv-shell">
          <Reveal>
            <p className="pv-index">
              <span className="pv-badge pv-badge-live">Live</span>
              Vault Seats
            </p>
            <h1 className="pv-h1 pv-page-title">Own a seat. Earn the pot.</h1>
            <p className="pv-body pv-measure pv-page-lead">
              Each series is an NFT collection plus its own fuel $TOKEN. Buy or snipe a seat NFT,
              activate for rewards, and earn when anyone Distributes the trade-fee pot into seat
              wallets.{' '}
              <Link href="/docs#vault-seats" className="link">
                Docs
              </Link>
            </p>
            <p className="pv-body-sm" style={{ marginTop: 12, color: 'var(--text-muted)' }}>
              Get $TOKEN · Trade · Activate · Distribute
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
              <Link href="/seats/create" className="pv-btn pv-btn-primary">
                Create a series
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <a href="#for-buyers" className="pv-btn pv-btn-secondary">
                For buyers
              </a>
              <a href="#for-developers" className="pv-btn pv-btn-secondary">
                For developers
              </a>
              <a href="#series" className="pv-btn pv-btn-secondary">
                Live series
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <section id="for-buyers" className="pv-section pv-how">
        <div className="pv-shell">
          <Reveal>
            <p className="pv-eyebrow">For buyers</p>
            <h2 className="pv-h2 pv-section-title">How a series works</h2>
            <p className="pv-body pv-measure" style={{ marginTop: 12 }}>
              <strong>Seat = NFT.</strong> <strong>Fuel = that series’ $TOKEN.</strong> Open any live
              series page and use the desk buttons — same labels as below.
            </p>
          </Reveal>
          <ol className="pv-how-grid" style={{ marginTop: 32 }}>
            {BUYER_STEPS.map((step, index) => (
              <Reveal key={step.title} delay={0.03 * index}>
                <li>
                  <span className="pv-how-num">{String(index + 1).padStart(2, '0')}</span>
                  <h3 className="pv-h3">{step.title}</h3>
                  <p className="pv-body-sm">{step.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>

          <Reveal delay={0.08}>
            <p className="pv-eyebrow" style={{ marginTop: 48 }}>
              Series desk
            </p>
            <h3 className="pv-h2" style={{ marginTop: 8, fontSize: '1.5rem' }}>
              What you can do
            </h3>
            <p className="pv-body pv-measure" style={{ marginTop: 12 }}>
              Live on every series page. Buy vs Snipe: next in line, or one exact # you pick.
            </p>
          </Reveal>
          <div className="pv-tpl-grid" style={{ marginTop: 24 }}>
            {DESK_FEATURES.map((feature) => (
              <Reveal key={feature.name}>
                <article className="pv-tpl">
                  <div className="pv-tpl-head">
                    <h3 className="pv-h3">{feature.name}</h3>
                    <span className="pv-badge pv-badge-live">
                      <span className="pv-dot" />
                      Live
                    </span>
                  </div>
                  <p className="pv-body-sm pv-tpl-body">{feature.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <section id="for-developers" className="pv-section pv-how">
        <div className="pv-shell">
          <Reveal>
            <p className="pv-eyebrow">For developers</p>
            <h2 className="pv-h2 pv-section-title">Launch an NFT + $TOKEN series</h2>
            <p className="pv-body pv-measure" style={{ marginTop: 12 }}>
              Pick your art — the Originals pack in one click, or upload your own image and choose
              your own supply — then set the $TOKEN price per seat. One wallet confirmation creates
              the NFT collection, shop, activation, fee pot and loans, and launches the fuel $TOKEN on
              a pons curve so buyers can actually get hold of it. Addresses and stack detail in{' '}
              <Link href="/docs#vault-seats" className="link">
                Docs → Vault Seats
              </Link>
              .
            </p>
            <Link href="/seats/create" className="pv-btn pv-btn-primary" style={{ marginTop: 20 }}>
              Create a series
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <div id="series" className="pv-shell pv-page-body">
        <Reveal delay={0.06}>
          <div className="pv-section-head" style={{ marginBottom: 24 }}>
            <div>
              <p className="pv-eyebrow">Browse</p>
              <h2 className="pv-h2 pv-section-title">Live series</h2>
              <p className="pv-body pv-measure" style={{ marginTop: 8 }}>
                Open one to trade, activate, distribute, or borrow.
              </p>
            </div>
          </div>
          <SeatsGrid />
        </Reveal>
      </div>
    </main>
  );
}
