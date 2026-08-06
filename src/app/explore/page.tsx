import type { Metadata } from 'next';

import { ExploreGrid } from '@/components/explore-grid';
import { Reveal } from '@/components/ui/reveal';

export const metadata: Metadata = {
  title: 'Explore · PonsVault V2',
  description: 'Tokens launched through PonsVault V2 on the open pons v2 factory.',
};

export default function ExplorePage() {
  return (
    <main className="pv-page">
      <section className="pv-page-hero">
        <div className="pv-shell">
          <Reveal>
            <p className="pv-index">
              <span className="pv-badge pv-badge-live">V2</span>
              Live on Robinhood Chain
            </p>
            <h1 className="pv-h1 pv-page-title">Explore launches</h1>
            <p className="pv-body pv-measure pv-page-lead">
              Every token launched through PonsVault V2, with market data and progress toward
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
