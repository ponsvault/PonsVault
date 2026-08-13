import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Info, Lightbulb } from 'lucide-react';

import { Reveal } from '@/components/ui/reveal';
import { PONSVAULT_GITHUB_URL } from '@/components/x-social-link';
import type { PonsVaultContract } from '@/lib/pons/deployments';
import {
  PONS_V2_UPSTREAM_CONTRACTS,
  PONSVAULT_V2_CONTRACTS,
} from '@/lib/pons/v2-deployments';
import { explorerAddressUrl, shortAddress } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Docs · PonsVault V2',
  description:
    'How PonsVault V2 turns pons v2 creator fees into an on-chain rule — the vault mechanic, the templates, the parameters, the contracts, and the security model.',
};

const TOC = [
  { href: '#overview', label: 'Overview' },
  { href: '#contracts', label: 'Contracts' },
  { href: '#vaults', label: 'How a vault earns' },
  { href: '#authority', label: 'Who can trigger it' },
  { href: '#templates', label: 'Templates' },
  { href: '#vault-seats', label: 'Vault Seats' },
  { href: '#parameters', label: 'Parameters' },
  { href: '#security', label: 'Security model' },
  { href: '#limits', label: 'Limits & caveats' },
];

function ContractTable({ contracts }: { contracts: PonsVaultContract[] }) {
  return (
    <div className="pv-table-scroll">
      <table className="pv-spec-table pv-contract-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>What it does</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract) => (
            <tr key={contract.name}>
              <td>
                <code>{contract.name}</code>
              </td>
              <td>{contract.role}</td>
              <td>
                {contract.address ? (
                  <a
                    className="pv-mono"
                    href={explorerAddressUrl(contract.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddress(contract.address)}
                  </a>
                ) : (
                  <span className="pv-body-sm">Published after deploy</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="pv-docs">
      <section className="pv-docs-hero">
        <div className="pv-shell">
          <Reveal>
            <p className="pv-index">
              <span className="pv-badge pv-badge-live">V2</span>
              Documentation
            </p>
            <h1 className="pv-h1 pv-docs-title">PonsVault V2</h1>
            <p className="pv-body pv-docs-lead">
              An independent vault layer on the open{' '}
              <a href="https://docs.ponsfamily.com/v2" target="_blank" rel="noreferrer">
                pons v2
              </a>{' '}
              factory on Robinhood Chain. It does not change how your token launches or trades — it
              changes where the creator fees go, and what happens to them once they arrive.
            </p>
          </Reveal>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <div className="pv-shell pv-docs-layout">
        <aside className="pv-docs-aside">
          <p className="pv-docs-toc-title">On this page</p>
          <nav className="pv-docs-toc">
            {TOC.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="pv-docs-main">
          <Reveal as="section" className="pv-docs-section">
            <h2 id="overview">What problem this solves</h2>
            <p>
              When a pons token launches, the trading fees earned by its liquidity position accrue to
              a creator. That is good for the creator and neutral at best for everyone else: the value
              leaves the token the moment it is claimed.
            </p>
            <p>
              A vault changes the destination. Instead of paying a wallet, the fees pay a contract
              with one job — the job you picked when you launched. That might be buying the token back
              and burning it, funding a prize pool, or paying stakers who lock up the token. The
              result is a launch where the rules are enforced by code rather than by the
              founder&apos;s word.
            </p>
            <div className="pv-callout pv-callout-accent">
              <Lightbulb className="pv-callout-icon h-5 w-5" strokeWidth={1.75} />
              <div>
                <p className="pv-callout-title">The short version</p>
                <p>
                  Trades create fees. Fees flow to your vault. The vault does what you told it to,
                  every time. Anyone can press the button, and nobody can stop it.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="contracts">Contracts</h2>
            <p>
              Everything PonsVault V2 does happens in these contracts, on Robinhood Chain (4663).
              They are deployed once and reused by every launch — the only thing created per token
              is a small vault of your chosen template.
            </p>
            <ContractTable contracts={[...PONSVAULT_V2_CONTRACTS]} />
            <p>
              Your own vault&apos;s address is shown on your token&apos;s page, and is also readable
              from the launcher by calling <code>vaultOf</code> with your token address. The source
              for all of them is on{' '}
              <a href={PONSVAULT_GITHUB_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
              .
            </p>

            <h3>What we build on</h3>
            <p>
              These belong to pons and the chain. PonsVault calls them and cannot change them.
            </p>
            <ContractTable contracts={[...PONS_V2_UPSTREAM_CONTRACTS]} />
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="vaults">How a vault earns</h2>
            <p>
              Every pons launch has its liquidity position held by a <strong>locker</strong> contract.
              The locker tracks a per-token <code>feeRedirect</code> address and pays the creator
              share of collected fees there, after deducting the pons protocol share.
            </p>
            <p>
              Attaching a vault means setting that redirect to the vault&apos;s address. From then on,
              collected fees arrive at the vault as <strong>WETH</strong> — an ordinary ERC-20
              transfer, not native ETH. When the pool has also accrued fees on the token side, the
              vault receives some of your token too.
            </p>
            <p>
              That much is the same for every template. What happens next is the part you choose.
              Buyback &amp; Burn, one of the two templates available today, runs this cycle:
            </p>
            <pre className="pv-docs-pre">
              <code>
                <span className="tok-com">
                  {'// Buyback & Burn — one template, when triggered'}
                </span>
                {'\n'}
                <span className="tok-type">1.</span> sweep pending fees out of the pons locker{'\n'}
                <span className="tok-type">2.</span> split the WETH by the configured burn share
                {'\n'}
                <span className="tok-type">3.</span> swap the burn share for your token{'\n'}
                <span className="tok-type">4.</span> send every token it holds to{' '}
                <span className="tok-str">0x…dEaD</span>
                {'\n'}
                <span className="tok-type">5.</span> forward any remainder to the treasury
              </code>
            </pre>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="authority">Who can trigger it</h2>
            <p>
              This is the part worth understanding, because it explains why PonsVault performs your
              launch for you rather than bolting a vault onto it afterwards.
            </p>
            <p>
              Receiving fees and <em>collecting</em> them are two different permissions on the pons
              locker. The payout follows the fee redirect, but the call that sweeps fees out of the
              locker is only accepted from the token&apos;s on-chain <code>deployer</code> or from
              pons&apos;s own protocol fee recipient. A redirect target is not authorised — even
              though it is exactly where the money lands.
            </p>
            <p>
              So a vault can receive fees but can never sweep them by itself. PonsVault closes that
              gap by launching the token through its own launcher contract, which therefore becomes
              the deployer. The launcher exposes an open sweep function, and that is what lets the
              whole cycle run without any privileged operator.
            </p>
            <p>
              In practice you should not have to press anything. PonsVault runs a bot that checks
              every live vault every few minutes and triggers a run once the accrued fees clear your
              minimum and are worth more than the gas. It is a convenience, not a dependency:
              it has no special permission, and if it stopped tomorrow any holder could keep the
              vault running from the button on your token&apos;s page.
            </p>
            <div className="pv-callout">
              <Info className="pv-callout-icon h-5 w-5" strokeWidth={1.75} />
              <div>
                <p className="pv-callout-title">Attaching a vault to an existing token</p>
                <p>
                  Possible, but not fully automatic. The token&apos;s original deployer can point the
                  redirect at a vault, and the vault will still distribute permissionlessly — but the
                  sweep itself will keep needing that deployer&apos;s signature.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="templates">Templates</h2>
            <p>
              A template is a vault contract with one job. You choose one at launch and configure it;
              the configuration is then fixed for the life of the vault.
            </p>

            <h3>Buyback &amp; Burn — available now</h3>
            <p>
              Spends a fixed share of incoming fees on a market buy and burns the result immediately,
              forwarding the remainder to a treasury address you nominate. Set the burn share to 100%
              and there is no treasury at all.
            </p>

            <h3>Staking — available now</h3>
            <p>
              Pays incoming fees out to holders who stake the token, in proportion to how much each
              has staked. Rewards are WETH the pool actually earned, so nothing is minted and no
              supply is burned — and because staked tokens sit in the vault, supply leaves
              circulation for as long as people keep earning on it.
            </p>
            <p>
              Staking is a deliberate deposit rather than an automatic dividend to every holder.
              Paying holders passively would need the token to notify the vault on every transfer,
              and pons tokens are plain ERC-20s whose fees come from the Uniswap pool rather than a
              transfer tax, so no such hook exists. Requiring a deposit is what makes the payout
              computable without one.
            </p>
            <p>
              The creator may set a lock period at launch, counted from each staker&apos;s most
              recent deposit. It applies to principal only: rewards can be claimed at any time, lock
              or no lock. Like every other parameter, it cannot be changed afterwards.
            </p>

            <h3>RWA Dividend</h3>
            <p>
              Converts creator fees (in the pairing asset) into a tokenized stock via Uniswap V3,
              which the vault holds until holders claim it. Holders earn by holding — there is
              nothing to stake and nothing to opt into. The token side of the fees is burned, as
              with Buyback &amp; Burn.
            </p>
            <p>
              Each purchase opens a round. Your share of a round is worked out from what you held at
              the moment it opened, so buying in afterwards does not dilute anyone already there.
              Rounds stay claimable for a fixed window; anything unclaimed after that rolls into the
              next round rather than being stranded.
            </p>
            <p>
              The stock is chosen from a short list — GameStop, NVIDIA and SpaceX — and fixed
              forever at launch. The list is short because most tokenized stocks on this chain are
              barely traded on-chain: their pools exist but hold almost nothing, so converting fees
              into them would lose most of the value to price impact. Only assets with enough
              liquidity to convert a round at a fair price are offered, and each one is re-checked
              against the chain when you launch.
            </p>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="vault-seats">Vault Seats</h2>
            <p>
              Separate from bonding-curve launches on{' '}
              <Link href="/launch" className="link">
                Launch
              </Link>
              . Each <strong>series</strong> is an NFT collection plus its own fuel $TOKEN, with a
              shop, activation, fee pot, and loans. Product UI:{' '}
              <Link href="/seats" className="link">
                /seats
              </Link>
              .
            </p>
            <p>
              <strong>Seat = NFT.</strong> <strong>Fuel = that series’ $TOKEN</strong> (ERC-20).
              Loop: Get $TOKEN · Trade · Activate · Distribute.
            </p>

            <h3>What a series is made of</h3>
            <ul>
              <li>
                <strong>Seat NFT</strong> — numbered collectible; uploaded art is the NFT image.
              </li>
              <li>
                <strong>Seat wallet</strong> — built-in wallet per NFT; rewards land here and move
                with the NFT on sale. Its address is fixed from the moment the series exists and can
                receive rewards straight away; the wallet contract itself is deployed the first time
                the owner spends from it.
              </li>
              <li>
                <strong>Fuel $TOKEN</strong> — ERC-20 for buying seats and paying activation, never
                ETH. Every series launches its own on a pons v2 bonding curve in the same
                transaction that creates the series, so anyone can buy fuel with ETH (or an approved
                ERC-20 such as USDG) and the series has a real market from the first block. An
                ETH-paired curve takes the quote as transaction value, so buying fuel needs no
                approval first. A creator can buy the first fuel in that same transaction, which is the
                only way to hold any before the series is live.
              </li>
              <li>
                <strong>Shop (AMM)</strong> — fixed $TOKEN price per seat, and the only contract that
                can mint one. Buy next, snipe a #, or sell back; seats sold back are resold before
                any new one is minted. Every trade also carries ETH, and all of it goes to the reward
                pot with no protocol cut: 10% of what a seat is worth to buy or sell, 15% to snipe.
                The contract cannot know what a seat is worth, so it enforces those percentages
                against a 0.01 ETH seat as a floor and the desk prices the real thing off the fuel
                curve.
              </li>
            </ul>

            <h3>How to get a seat</h3>
            <ol>
              <li>
                Hold the series fuel $TOKEN. Buy it on the series&apos; own curve, straight from the
                desk — with ETH, or with the ERC-20 the curve is paired against.
              </li>
              <li>
                On the series desk: <strong>Buy next</strong> for the next NFT in line, or type a
                number and <strong>Snipe</strong> that exact # if nobody owns it yet (same $TOKEN
                price, higher ETH fee).
              </li>
              <li>
                Seats are minted as they sell, not up front, so you pay the gas for your own NFT
                (roughly 175k gas) and the creator never pays for seats nobody bought. It also means
                any series size launches for the same cost.
              </li>
              <li>
                <strong>Activate</strong> with $TOKEN (tiered) to join the payroll. Transfer clears
                activation.
              </li>
              <li>
                When the ETH pot bar is full, anyone can <strong>Distribute</strong> (pay gas).
                Activated seats share by tier; use <strong>Deliver</strong> to claim a seat’s share
                into its wallet.
              </li>
            </ol>

            <h3>Desk features</h3>
            <ul>
              <li>
                <strong>Buy / Snipe / Sell</strong> — trade seat NFTs against $TOKEN + ETH fee.
              </li>
              <li>
                <strong>Activate</strong> — stake a seat on the distribution payroll (tier weighted).
              </li>
              <li>
                <strong>Distribute / Deliver</strong> — open a payout when the pot is full; push
                rewards to seat wallets.
              </li>
              <li>
                <strong>Borrow / Repay</strong> — lock a seat NFT, borrow $TOKEN principal against
                it; repay or face liquidation after due. Borrowing carries the same ETH fee as
                buying a seat, split between the reward pot and the protocol.
              </li>
            </ul>

            <h3>Who gets paid, and when</h3>
            <p>
              A payout round freezes its share table the moment it opens. Only seats already
              activated at that point can claim it, so activating after a round opens does not
              dilute anyone who was there first — you are simply in line for the next one. Changing
              your tier re-dates your seat for the same reason, so upgrade between rounds rather
              than during one. A round can never pay out more than the pot it was opened with, and
              whatever nobody claims within seven days rolls into the next pot instead of sitting
              stranded in the contract.
            </p>

            <h3>Borrowing against a seat</h3>
            <p>
              A loan pays out <strong>70% of the seat&apos;s shop price</strong> in $TOKEN and locks
              the NFT in the loan vault for the term. Repay the principal and the seat comes back.
              Miss the deadline and anyone can liquidate it — but a liquidator has to pay the
              principal into the vault to take the seat, so they are buying a seat worth full price
              for 70% of it. That discount is the incentive to liquidate, and it is why defaulting
              costs you the seat rather than paying you.
            </p>

            <h3>PonsVault Originals</h3>
            <p>
              The house art pack, for creators who do not want to make their own art. Twelve animals
              rendered in eight light grades: <em>Golden Hour</em>, <em>Sunrise</em>,{' '}
              <em>Overcast</em> and <em>Dusk</em> stay photographic, while <em>Moonlit</em>,{' '}
              <em>Ash</em>, <em>Aurora</em> and <em>Prism</em> get progressively rarer and more
              stylised. An Originals run is a fixed <strong>1111 seats</strong> — the rarity table
              allocates exact counts for that number, so it is not configurable.
            </p>
            <p>
              Rarity is dealt by exact allocation, not per-seat dice rolls: 333 Golden Hour, 222
              Sunrise, 178 Overcast, 155 Dusk, 111 Moonlit, 56 Ash, 44 Aurora, 11 Prism, and a
              single <strong>1 of 1</strong>, shuffled with a random per-series salt. Every series
              deals a different hand from the same deck. The artwork is pinned once and shared by
              every Originals series, so launching on it needs no upload and no wait; only the
              per-series metadata folder is written at launch.
            </p>
            <p>
              The 1 of 1 sits outside the animal × light grid and is never colour graded, so it has
              no near-misses: exactly one seat in the run holds it. It is also the image the series
              itself leads with.
            </p>

            <h3>Sealed until the sale ends</h3>
            <p>
              An Originals series sells <strong>sealed</strong>. Every seat returns the same
              placeholder card from <code>tokenURI</code> while the sale runs, so no buyer — and not
              the creator either — can tell which number holds the 1 of 1. Without that, a
              pre-revealed pack is public before the first sale and <code>snipe</code> lets anyone
              take the rarest seat on purpose for the price of a 15% fee.
            </p>
            <p>
              The pack is fixed before anything is sold: the collection stores{' '}
              <code>keccak256</code> of the real base URI at creation, and <code>reveal</code> only
              accepts a URI that hashes to it. So the reveal cannot swap the hand for a different
              one, and it does not matter who sends the transaction. It unlocks when the series
              sells out, or seven days after creation, whichever comes first — a series that never
              sells out still gets its art. Marketplaces are told to re-read metadata through an
              ERC-4906 <code>BatchMetadataUpdate</code>.
            </p>
            <p>
              A series using your own single image has nothing to hide, so it commits nothing and is
              revealed from the first sale.
            </p>

            <h3>For developers</h3>
            <p>
              Create from{' '}
              <Link href="/seats/create" className="link">
                /seats/create
              </Link>
              : name, ticker, art (Originals or your own image), supply, $TOKEN seat price, and where
              fuel comes from. <code>createSeries</code> deploys the NFT collection, shop,
              activation, booster pot, and loan vault in one call.
            </p>
            <p>
              A series has to point at fuel that already exists, so creating one is naturally two
              calls. Wallet batching can sign two calls as one confirmation, but only on chains the
              wallet has enabled it for, which is why <code>PonsSeatLauncher</code> does both inside
              a single contract call instead: it launches the fuel, buys the creator&apos;s first
              fuel on the curve it just made, and calls <code>createSeries</code> with the real
              address. One confirmation on every wallet, all of it or none of it, and no
              half-finished launch to recover from. Only an ERC-20 pair adds a second prompt, for
              the approval.
            </p>
            <p>
              Nothing that carries rights is attributed to the launcher: the fuel token&apos;s
              creator fees point at the caller, the first buy is delivered to them, and the series is
              registered in their name through <code>createSeriesFor</code>, which the factory
              accepts from that one address. pons&apos; own <code>deployer</code> field is the
              exception — it is whoever called <code>launchToken</code>, and only pons&apos;
              configured forwarder may name someone else. It carries no rights: the factory records
              it and never checks it, while fees and every creator action are gated on the creator
              fee recipient, which is the creator.{' '}
              <code>npm run seats:check-batch</code> runs it on a fork and asserts each of those.
              Addresses live in <code>src/lib/seats/deployments.ts</code>, updated after{' '}
              <code>DeployPonsSeats</code>. Set <code>PONS_ORIGINALS_ART_CID</code> after{' '}
              <code>npm run originals:pin</code> so Originals launches skip the art upload.
            </p>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="parameters">Parameters</h2>
            <p>
              Every template exposes its own settings, named here as they appear in the launch form.
              They are written once, when the vault is created. None of them has a setter, so none
              of them can be changed later — not by you, and not by us.
            </p>
            <div className="pv-callout">
              <Info className="pv-callout-icon h-5 w-5" strokeWidth={1.75} />
              <div>
                <p className="pv-callout-title">There is no schedule to set</p>
                <p>
                  A vault has no timer. A run spends everything it is holding, so the next one
                  cannot happen until trading has refilled it past your minimum. That single number
                  is what sets the pace — busy tokens act often, quiet ones rarely, and neither
                  needs a clock.
                </p>
              </div>
            </div>

            <h3>Buyback &amp; Burn</h3>
            <table className="pv-spec-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>What it controls</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Burn share</td>
                  <td>
                    How much of each batch of fees is spent buying and burning. At 100% there is no
                    treasury at all.
                  </td>
                </tr>
                <tr>
                  <td>Treasury</td>
                  <td>Where anything not burned is sent. Required unless the burn share is 100%.</td>
                </tr>
                <tr>
                  <td>Minimum fees before a run</td>
                  <td>
                    How much has to build up before a buyback can happen. The only thing pacing the
                    vault: set it higher and it buys less often, in bigger amounts.
                  </td>
                </tr>
              </tbody>
            </table>

            <h3>Staking</h3>
            <table className="pv-spec-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>What it controls</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Lock period</td>
                  <td>
                    How long a stake is held, counted from each staker&apos;s most recent deposit.
                    Zero means people can withdraw whenever they want. Rewards are never locked.
                  </td>
                </tr>
                <tr>
                  <td>Minimum fees before a payout</td>
                  <td>
                    How much has to build up before stakers are paid. Set it higher and payouts come
                    less often, in bigger amounts.
                  </td>
                </tr>
              </tbody>
            </table>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="security">Security model</h2>
            <p>
              Making the trigger public is what makes a vault credible, and it is also what makes it
              attackable. Any template that trades on demand is an invitation to move the pool first
              and sell into it. Using Buyback &amp; Burn as the worked example, here is exactly where
              that leaves you.
            </p>
            <ul className="pv-docs-list">
              <li>
                <strong>The buyback has no price check.</strong> It buys at whatever the pool quotes
                in that block, with no average to compare against and no floor of its own. A buyback
                that lands alongside a large trade — including one placed deliberately to bait it —
                will buy at that price.
              </li>
              <li>
                <strong>A caller-supplied floor, if you want one.</strong> Whoever triggers the run
                may pass a minimum number of tokens the swap must return, which aborts the whole run
                instead of accepting a bad fill. This site and our bot pass none.
              </li>
              <li>
                <strong>A bounded loss.</strong> A run can only ever spend fees that have actually
                accrued, so the most at stake in any single run is one batch of fees — never the
                treasury, and never the liquidity.
              </li>
            </ul>
            <p>
              Your harvest minimum is therefore doing double duty: it sets how much of a target each
              run represents. A larger minimum means fewer, larger buybacks, and a larger prize for
              anyone willing to try for it.
            </p>
            <p>
              Beyond the swap itself, the vault never takes custody of anything it can misdirect. It
              holds no launch funds, cannot touch the liquidity position, and has no function that
              transfers assets to an address you did not configure at creation.
            </p>

            <h3>Upgrades</h3>
            <p>
              Vaults are deployed behind a shared beacon, so a defect can be fixed for every existing
              vault at once without asking anyone to migrate. That is real power, and it is
              deliberately removable: the beacon&apos;s owner can renounce control permanently, after
              which no vault can ever be changed again.
            </p>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2 id="limits">Limits &amp; caveats</h2>
            <p>
              Things worth knowing before you launch, including a few sharp edges we found while
              testing against the live chain.
            </p>
            <ul className="pv-docs-list">
              <li>
                <strong>A buyback moves the price it buys at.</strong> On a thin pool, spending a
                batch of fees in one swap pushes the price up as it fills, so the tokens burned are
                worth less than the WETH spent. Larger, less frequent runs feel efficient but suffer
                this more, not less.
              </li>
              <li>
                <strong>Burning is a two-step move.</strong> In Buyback &amp; Burn, pons tokens reject
                a swap that delivers straight to the burn address, so the vault buys into itself
                first and then transfers out. The end state is identical; it just costs slightly more
                gas.
              </li>
              <li>
                <strong>Fresh launches have trading limits.</strong> pons applies per-transaction and
                per-wallet caps for a window after launch. Very early buybacks can bounce off those
                caps until the window closes.
              </li>
              <li>
                <strong>A vault is not a price guarantee.</strong> Burning supply does not create
                demand. Whichever template you pick, it is funded by trading — if nothing trades, no
                fees accrue and the vault does nothing.
              </li>
              <li>
                <strong>Audit status.</strong> The vault contracts are tested against live chain state
                but have not yet completed a third-party audit. Treat early launches accordingly.
              </li>
            </ul>
            <div className="pv-callout pv-callout-warn">
              <AlertTriangle className="pv-callout-icon h-5 w-5" strokeWidth={1.75} />
              <div>
                <p className="pv-callout-title">Never share your seed phrase</p>
                <p>
                  PonsVault will never ask for it. Launching only ever requires a signature from your
                  own wallet — review the token address and transaction preview before you sign.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <h2>Next steps</h2>
            <div className="pv-docs-links">
              <Link href="/launch" className="pv-docs-linkrow">
                <span>Launch a token with a vault</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/explore" className="pv-docs-linkrow">
                <span>Explore launches</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <p className="pv-docs-footer">
              PonsVault is an independent interface and contract layer built on pons. It is not
              affiliated with or endorsed by Pons Labs. Nothing here is financial advice — review
              every contract address and transaction before signing.
            </p>
          </Reveal>
        </div>
      </div>
    </main>
  );
}
