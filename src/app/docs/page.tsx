import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Info, Lightbulb } from 'lucide-react';

import { Reveal } from '@/components/ui/reveal';

export const metadata: Metadata = {
  title: 'Docs · PonsVault',
  description:
    'How PonsVault turns pons creator fees into an on-chain rule — the vault mechanic, the templates, the parameters, and the security model.',
};

const TOC = [
  { href: '#overview', label: 'Overview' },
  { href: '#vaults', label: 'How a vault earns' },
  { href: '#authority', label: 'Who can trigger it' },
  { href: '#templates', label: 'Templates' },
  { href: '#parameters', label: 'Parameters' },
  { href: '#security', label: 'Security model' },
  { href: '#limits', label: 'Limits & caveats' },
];

export default function DocsPage() {
  return (
    <main className="pv-docs">
      <section className="pv-docs-hero">
        <div className="pv-shell">
          <Reveal>
            <p className="pv-index">Documentation</p>
            <h1 className="pv-h1 pv-docs-title">Vaults that put your trading fees to work.</h1>
            <p className="pv-body pv-docs-lead">
              PonsVault is an independent layer on top of{' '}
              <a href="https://ponsfamily.com" target="_blank" rel="noreferrer">
                pons
              </a>{' '}
              on Robinhood Chain. It does not change how your token launches or trades — it changes
              where the creator fees go, and what happens to them once they arrive.
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
            <div id="overview" />
            <h2>What problem this solves</h2>
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
            <div id="vaults" />
            <h2>How a vault earns</h2>
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
              Buyback &amp; Burn, the template available today, runs this cycle:
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
            <div id="authority" />
            <h2>Who can trigger it</h2>
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
            <div id="templates" />
            <h2>Templates</h2>
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

            <h3>Lottery — in development</h3>
            <p>
              Accumulates fees into a prize pool and pays a holder chosen at random each round. Still
              being designed — picking a winner fairly on-chain is harder than it sounds when anyone
              can trigger the draw.
            </p>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <div id="parameters" />
            <h2>Parameters: Buyback &amp; Burn</h2>
            <p>
              Every template exposes its own parameters — a lottery is configured by round length and
              prize share, not by a burn share. The table below covers Buyback &amp; Burn, since that
              is the template you can launch today.
            </p>
            <p>
              These are set once, when the vault is created. None of them has a setter, so none of
              them can be changed later — not by you, and not by us.
            </p>
            <table className="pv-spec-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>What it controls</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>burnBps</code>
                  </td>
                  <td>
                    Share of harvested WETH spent on the buyback, in basis points. 10000 means
                    everything is burned and nothing goes to a treasury.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>treasury</code>
                  </td>
                  <td>
                    Where the remainder is sent. Required unless the burn share is 100%.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>cooldown</code>
                  </td>
                  <td>
                    Minimum seconds between runs, so the vault batches fees instead of burning dust
                    and wasting gas.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>minHarvestWei</code>
                  </td>
                  <td>Minimum accrued WETH before a run is allowed to proceed.</td>
                </tr>
                <tr>
                  <td>
                    <code>twapWindow</code>
                  </td>
                  <td>Length of the time-weighted average price window used as a fairness check.</td>
                </tr>
                <tr>
                  <td>
                    <code>maxTickDeviation</code>
                  </td>
                  <td>
                    How far the pool&apos;s spot price may sit from that average before the vault
                    refuses to trade.
                  </td>
                </tr>
              </tbody>
            </table>
          </Reveal>

          <Reveal as="section" className="pv-docs-section">
            <div id="security" />
            <h2>Security model</h2>
            <p>
              Making the trigger public is what makes a vault credible, and it is also what makes it
              attackable. Any template that trades on demand is an invitation to move the pool first
              and sell into it. Using Buyback &amp; Burn as the worked example, three things address
              that.
            </p>
            <ul className="pv-docs-list">
              <li>
                <strong>A price sanity check.</strong> Before swapping, the vault reads the pool&apos;s
                time-weighted average price and compares it to the current spot price. If they
                diverge beyond your configured tolerance, the run reverts.
              </li>
              <li>
                <strong>A caller-supplied floor.</strong> Whoever triggers the run can pass their own
                minimum output. When the pool&apos;s oracle has no usable history yet, supplying that
                floor becomes mandatory rather than optional.
              </li>
              <li>
                <strong>A bounded prize.</strong> A run can only ever spend fees that have actually
                accrued, so the most an attacker can contest is one batch of fees — not the treasury,
                and never the liquidity.
              </li>
            </ul>
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
            <div id="limits" />
            <h2>Limits &amp; caveats</h2>
            <p>
              Things worth knowing before you launch, including a few sharp edges we found while
              testing against the live chain.
            </p>
            <ul className="pv-docs-list">
              <li>
                <strong>The oracle needs warming up.</strong> New pons pools start with room for a
                single price observation, which is not enough for a time-weighted average. Until the
                pool has accumulated history, whoever triggers a run has to supply their own minimum
                output. Priming the pool is a public, one-off call.
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
                demand, and neither does a prize pool. Whichever template you pick, it is funded by
                trading — if nothing trades, no fees accrue and the vault does nothing.
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
