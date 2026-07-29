import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Reveal } from '@/components/ui/reveal';
import { PONSVAULT_GITHUB_URL, PONSVAULT_X_URL } from '@/components/x-social-link';
import { VaultPanel } from '@/components/vault-panel';
import { VaultFlow } from '@/components/vault-flow';

export default function HomePage() {
  return (
    <main className="pv-home">
      <Hero />
      <Rule />
      <Mechanic />
      <Rule />
      <Templates />
      <Rule />
      <Steps />
      <Rule />
      <Guarantees />
      <Rule />
      <FinalCta />
      <Footer />
    </main>
  );
}

function Rule() {
  return (
    <div className="pv-rule-shell">
      <hr className="pv-rule" />
    </div>
  );
}

function Hero() {
  return (
    <section className="pv-hero">
      <div className="pv-backdrop pv-backdrop-grid" />
      <div className="pv-shell pv-hero-inner">
        <Reveal>
          <h1 className="pv-h1 pv-hero-title">
            Launch your token
            <br />
            with a vault attached
          </h1>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="pv-hero-sub">
            <p className="pv-body pv-hero-lead">
              A vault layer for pons launches on Robinhood Chain. Decide what your creator fees do,
              and let the contract enforce it.
            </p>
            <div className="pv-hero-actions">
              <Link href="/launch" className="pv-btn pv-btn-primary pv-btn-lg">
                Pick a vault
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/docs" className="pv-btn pv-btn-secondary pv-btn-lg">
                Documentation
              </Link>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.12} className="pv-hero-visual">
          <VaultPanel />
          <p className="pv-body-sm pv-hero-caption">
            One example — a Buyback &amp; Burn vault. Each template has its own controls and its own
            rule.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const FACTS: [string, string][] = [
  ['Chain', 'Robinhood · 4663'],
  ['Fee asset', 'WETH'],
  ['Trigger', 'Permissionless'],
  ['Operator keys', 'None'],
];

function Mechanic() {
  return (
    <section className="pv-section">
      <div className="pv-shell">
        <Reveal>
          <p className="pv-index">
            <span className="pv-index-num">01</span>
            How a vault works
          </p>
          <h2 className="pv-h2 pv-section-title">
            Your fees stop being a payout.
            <br />
            They start doing a job.
          </h2>
          <p className="pv-body pv-measure pv-section-lead">
            On a normal launch, creator fees leave the moment someone claims them. A vault holds them
            instead and spends them on the rule you picked at launch — on a schedule nobody controls.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="pv-diagram">
            <header className="pv-diagram-head">
              <span className="pv-body-sm">Buyback &amp; Burn</span>
              <span className="pv-badge">Example template</span>
            </header>
            <VaultFlow burnBps={8000} />
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <dl className="pv-facts">
            {FACTS.map(([label, value]) => (
              <div key={label} className="pv-fact">
                <dt className="pv-body-sm">{label}</dt>
                <dd className="pv-fact-value">{value}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

const TEMPLATES = [
  {
    name: 'Buyback & Burn',
    status: 'live' as const,
    body: 'Fees buy your token off the open market and send it to the burn address. Supply falls with volume.',
    params: ['Burn share', 'Treasury split', 'Fees before a buy'],
  },
  {
    name: 'Staking',
    status: 'live' as const,
    body: 'Holders stake your token and earn the fees in WETH, split by share of the pool. Real yield, and supply locked up while it earns.',
    params: ['Lock period', 'Fees before a payout'],
  },
  {
    name: 'Lottery',
    status: 'live' as const,
    body: 'Fees fill a pot. Holders enter while the window is open. A commit–reveal draw pays the whole pot to one wallet.',
    params: ['Entry window', 'Reveal delay', 'Fees before a round'],
  },
  {
    name: 'RWA Dividend',
    status: 'live' as const,
    body: 'Fees buy a tokenized stock — GameStop, NVIDIA or SpaceX — which holders claim in proportion to what they hold. No staking, no opting in.',
    params: ['Stock', 'Fees before a purchase'],
  },
];

function Templates() {
  return (
    <section className="pv-section">
      <div className="pv-shell">
        <Reveal>
          <p className="pv-index">
            <span className="pv-index-num">02</span>
            Templates
          </p>
          <h2 className="pv-h2 pv-section-title">Pick a vault. Ship it with your token.</h2>
          <p className="pv-body pv-measure pv-section-lead">
            Each template is a small contract behind a shared beacon, so your token gets its own
            instance without paying for its own deployment.
          </p>
        </Reveal>

        <div className="pv-tpl-list">
          {TEMPLATES.map((template, index) => (
            <Reveal key={template.name} delay={index * 0.05}>
              <article className="pv-tpl">
                <div className="pv-tpl-main">
                  <div className="pv-tpl-head">
                    <h3 className="pv-h3">{template.name}</h3>
                    {template.status === 'live' ? (
                      <span className="pv-badge pv-badge-live">
                        <span className="pv-dot" />
                        Live
                      </span>
                    ) : (
                      <span className="pv-badge">In development</span>
                    )}
                  </div>
                  <p className="pv-body pv-tpl-body">{template.body}</p>
                </div>
                <ul className="pv-tpl-params">
                  {template.params.map((param) => (
                    <li key={param} className="pv-mono">
                      {param}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'Connect on Robinhood Chain',
    body: 'Your wallet stays yours. Every transaction is signed by you, from your own address.',
  },
  {
    title: 'Choose your vault',
    body: 'Pick a template and set it up — shares, destinations, how much has to build up before it acts, how much price movement it tolerates. Written once, then fixed.',
  },
  {
    title: 'Launch through pons',
    body: 'The token deploys through the pons factory and its creator fees are routed to the vault at creation.',
  },
  {
    title: 'Let it run',
    body: 'As trades accrue fees, anyone can trigger a run — you, a holder, or a bot. The vault does the rest.',
  },
];

function Steps() {
  return (
    <section className="pv-section">
      <div className="pv-shell">
        <Reveal>
          <p className="pv-index">
            <span className="pv-index-num">03</span>
            Launching
          </p>
          <h2 className="pv-h2 pv-section-title">Four steps, one signature each.</h2>
        </Reveal>

        <ol className="pv-steps">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} as="li" delay={index * 0.05}>
              <span className="pv-mono pv-step-num">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="pv-h3">{step.title}</h3>
              <p className="pv-body-sm pv-step-body">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

const GUARANTEES = [
  {
    title: 'Nobody controls the trigger',
    body: 'Running a vault is open to every address, so it cannot be quietly switched off or timed to benefit an insider.',
  },
  {
    title: 'Settings are permanent',
    body: 'Shares, destinations and thresholds are written when the vault is created. Nothing can change them afterwards — not the creator, not us.',
  },
  {
    title: 'Fees never touch a wallet',
    body: 'Collected fees move from the pons locker into the vault. No intermediary address can intercept them.',
  },
  {
    title: 'One vault per token',
    body: 'Each launch gets its own contract holding only that token\u2019s fees. Nothing is pooled, so one token\u2019s activity cannot touch another\u2019s.',
  },
  {
    title: 'Outcomes are verifiable',
    body: 'Burns, prizes and splits are ordinary transfers. Whatever your template does, anyone can audit it from chain data alone.',
  },
  {
    title: 'Runs without you',
    body: 'Our bot triggers each vault once the fees are worth the gas. It has no special permission — if it stopped, any holder could run it instead.',
  },
];

function Guarantees() {
  return (
    <section className="pv-section">
      <div className="pv-shell">
        <Reveal>
          <p className="pv-index">
            <span className="pv-index-num">04</span>
            Guarantees
          </p>
          <h2 className="pv-h2 pv-section-title">What the contract enforces.</h2>
        </Reveal>

        <div className="pv-guarantees">
          {GUARANTEES.map((item, index) => (
            <Reveal key={item.title} delay={(index % 3) * 0.05}>
              <div className="pv-guarantee">
                <h3 className="pv-h3">{item.title}</h3>
                <p className="pv-body-sm pv-guarantee-body">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="pv-cta">
      <div className="pv-shell">
        <Reveal>
          <div className="pv-cta-inner">
            <div>
              <h2 className="pv-h2">Give your token a reason to hold.</h2>
              <p className="pv-body pv-cta-body">
                Connect, choose a vault, and launch. It starts working with your first trade.
              </p>
            </div>
            <Link href="/launch" className="pv-btn pv-btn-primary pv-btn-lg">
              Launch a token
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FOOTER_LINKS: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Launch', href: '/launch' },
      { label: 'Explore', href: '/explore' },
      { label: 'Templates', href: '/docs#templates' },
    ],
  },
  {
    heading: 'Docs',
    links: [
      { label: 'How vaults work', href: '/docs#vaults' },
      { label: 'Parameters', href: '/docs#parameters' },
      { label: 'Contracts', href: '/docs#contracts' },
      { label: 'Security model', href: '/docs#security' },
    ],
  },
  {
    heading: 'PonsVault',
    links: [
      { label: 'X', href: PONSVAULT_X_URL, external: true },
      { label: 'GitHub', href: PONSVAULT_GITHUB_URL, external: true },
    ],
  },
  {
    heading: 'Ecosystem',
    links: [
      { label: 'pons', href: 'https://ponsfamily.com', external: true },
      { label: 'Robinhood Chain', href: 'https://robinhood.com', external: true },
    ],
  },
];

function Footer() {
  return (
    <footer className="pv-footer">
      <div className="pv-shell">
        <div className="pv-footer-top">
          <div className="pv-footer-brand">
            <span className="pv-brand-mark">P</span>
            <p className="pv-body-sm pv-footer-tagline">
              A vault layer for pons launches. Independent of pons and Robinhood.
            </p>
          </div>
          <div className="pv-footer-cols">
            {FOOTER_LINKS.map((column) => (
              <div key={column.heading}>
                <h3 className="pv-footer-heading">{column.heading}</h3>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a href={link.href} target="_blank" rel="noreferrer" className="pv-link">
                          {link.label}
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ) : (
                        <Link href={link.href} className="pv-link">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="pv-footer-bottom">
          <span className="pv-body-sm">PonsVault</span>
          <span className="pv-body-sm">
            Unaudited software. Launching a token risks total loss.
          </span>
        </div>
      </div>
    </footer>
  );
}
