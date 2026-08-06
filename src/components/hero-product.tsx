'use client';

import { Flame } from 'lucide-react';

/**
 * Hero product stage — inspired by Linear's full-app mock and Raycast's
 * floating window: the product is the visual, not a caption under it.
 */
const RUNS = [
  { time: '12:04', label: 'Burned', value: '1,284,910', unit: 'PONSV', burn: true },
  { time: '06:02', label: 'Bought', value: '0.039', unit: 'AAPL', burn: false },
  { time: '00:01', label: 'Burned', value: '902,441', unit: 'PONSV', burn: true },
];

export function HeroProduct() {
  return (
    <div className="hero-product">
      <div className="hero-product-shell">
        <aside className="hero-product-side" aria-hidden="true">
          <div className="hero-product-brand">
            <span className="pv-brand-mark">P</span>
            <span>PonsVault</span>
          </div>
          <nav className="hero-product-nav">
            <span className="is-active">Vault</span>
            <span>Launch</span>
            <span>Explore</span>
            <span>Docs</span>
          </nav>
          <div className="hero-product-side-meta">
            <span>Pair</span>
            <strong>AAPL</strong>
          </div>
        </aside>

        <div className="hero-product-main">
          <header className="hero-product-top">
            <div>
              <p className="hero-product-kicker">Buyback &amp; Burn</p>
              <h3>$PONSV</h3>
            </div>
            <span className="pv-badge pv-badge-live">
              <span className="pv-dot pv-pulse-dot" />
              Active
            </span>
          </header>

          <div className="hero-product-stats">
            <div>
              <span>Burn share</span>
              <strong>80%</strong>
            </div>
            <div>
              <span>Treasury</span>
              <strong>20%</strong>
            </div>
            <div>
              <span>Pending</span>
              <strong className="pv-mono">0.041 AAPL</strong>
            </div>
            <div>
              <span>Threshold</span>
              <strong className="pv-mono">0.05 AAPL</strong>
            </div>
          </div>

          <div className="hero-product-runs">
            <div className="hero-product-runs-head">
              <span>Recent runs</span>
              <span className="pv-mono">24h</span>
            </div>
            <ul>
              {RUNS.map((run) => (
                <li key={`${run.time}-${run.label}-${run.value}`}>
                  <span className="pv-mono">{run.time}</span>
                  <span className="hero-product-run-label">
                    {run.burn ? <Flame className="h-3 w-3" strokeWidth={2} /> : null}
                    {run.label}
                  </span>
                  <span className="pv-mono">
                    {run.value} <em>{run.unit}</em>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <footer className="hero-product-foot">
            <span>Callable by anyone · no operator keys</span>
            <span className="pv-btn pv-btn-primary hero-product-cta">Run vault</span>
          </footer>
        </div>
      </div>

      <aside className="hero-product-float" aria-hidden="true">
        <span className="pv-dot pv-pulse-dot" />
        <div>
          <strong>Keeper ran vault</strong>
          <p>Burned 1.28M PONSV from 0.039 AAPL</p>
        </div>
      </aside>
    </div>
  );
}
