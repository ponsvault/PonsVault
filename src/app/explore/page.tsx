import type { Metadata } from 'next';

import { ExploreGrid } from '@/components/explore-grid';

export const metadata: Metadata = {
  title: 'Explore · PonsShare',
  description: 'Recent token launches on Robinhood Chain via pons.',
};

export default function ExplorePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <p className="text-sm uppercase tracking-[0.2em] text-lime-300/80">Explore</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">PonsShare launches</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Only tokens created through this app appear here — not the full pons feed.
        </p>
      </div>
      <ExploreGrid />
    </main>
  );
}
