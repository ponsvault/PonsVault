import { ArrowUpRight, Flame } from 'lucide-react';

/**
 * Static mock of a vault's control surface, used as the hero visual.
 *
 * Values are illustrative. It exists to show the shape of the product rather
 * than to decorate the page, so it uses the same hairlines, mono numerals and
 * spacing as the real UI.
 *
 * It shows the Buyback & Burn template specifically, so it is labelled as one
 * example — the product is the vault layer, not this single template.
 */

const CONFIG: [string, string][] = [
  ['Template', 'Buyback & Burn'],
  ['Burn share', '80%'],
  ['Treasury', '20% · 0x2f4a…a91c'],
  ['Cooldown', '6h'],
  ['Price check', '5 min average · ±2%'],
];

const ACTIVITY: { time: string; label: string; value: string; burn?: boolean }[] = [
  { time: '12:04', label: 'Burned', value: '1,284,910 PONSV', burn: true },
  { time: '06:02', label: 'Bought back', value: '0.0391 WETH' },
  { time: '06:02', label: 'Harvested', value: '0.0489 WETH' },
  { time: '00:01', label: 'Burned', value: '902,441 PONSV', burn: true },
  { time: '18:00', label: 'Treasury paid', value: '0.0098 WETH' },
];

export function VaultPanel() {
  return (
    <div className="pv-panel vault-panel">
      <div className="pv-panel-bar">
        <div className="pv-panel-dots">
          <span />
          <span />
          <span />
        </div>
        <span className="pv-panel-bar-label">vault · $PONSV</span>
        <span className="pv-badge">Example</span>
        <span className="pv-badge pv-badge-live vault-panel-live">
          <span className="pv-dot pv-pulse-dot" />
          Active
        </span>
      </div>

      <div className="vault-panel-body">
        <section className="vault-panel-col">
          <header className="vault-panel-col-head">
            <span>Configuration</span>
            <span className="pv-badge">Immutable</span>
          </header>
          <dl className="vault-panel-rows">
            {CONFIG.map(([label, value]) => (
              <div key={label} className="vault-panel-row">
                <dt>{label}</dt>
                <dd className="pv-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="vault-panel-col">
          <header className="vault-panel-col-head">
            <span>Recent runs</span>
            <span className="pv-mono vault-panel-count">24h</span>
          </header>
          <ul className="vault-panel-activity">
            {ACTIVITY.map((item, index) => (
              <li key={index}>
                <span className="pv-mono vault-panel-time">{item.time}</span>
                <span className="vault-panel-label">
                  {item.burn ? <Flame className="h-3 w-3" strokeWidth={2} /> : null}
                  {item.label}
                </span>
                <span className="pv-mono vault-panel-value">{item.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="vault-panel-foot">
        <div className="vault-panel-pending">
          <span className="vault-panel-pending-label">Pending fees</span>
          <span className="pv-mono vault-panel-pending-value">0.0412 WETH</span>
        </div>
        <div className="vault-panel-actions">
          <span className="vault-panel-hint">Callable by anyone</span>
          <span className="pv-btn pv-btn-primary">
            Run vault
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </footer>
    </div>
  );
}
