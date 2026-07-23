import type { Metadata } from 'next';

import { ExploreGrid } from '@/components/explore-grid';
import { Reveal } from '@/components/ui/reveal';

export const metadata: Metadata = {
  title: 'Explore · PonsVault',
  description: 'Tokens launched with a PonsVault attached on Robinhood Chain.',
};

export default function ExplorePage() {
  return (
    <main className="pv-page">
      <section className="pv-page-hero">
        <div className="pv-shell">
          <Reveal>
            <p className="pv-index">
              <span className="pv-dot pv-pulse-dot pv-index-dot" />
              Live on Robinhood Chain
            </p>
            <h1 className="pv-h1 pv-page-title">Explore launches</h1>
            <p className="pv-body pv-measure pv-page-lead">
              Every token launched through PonsVault, with market data and progress toward
              graduation. Only launches created here appear — this is not the full pons feed.
            </p>
          </Reveal>
        </div>
      </section>

      <div className="pv-rule-shell">
        <hr className="pv-rule" />
      </div>

      <div className="pv-shell pv-page-body">
        <ExploreGrid />
      </div>
    </main>
  );
}
