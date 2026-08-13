import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SeatsSeriesDesk } from '@/components/seats-series-desk';
import { Reveal } from '@/components/ui/reveal';
import { getSeatSeries } from '@/lib/seats/read';

export default async function SeatSeriesPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId: raw } = await params;
  const seriesId = Number(raw);
  if (!Number.isFinite(seriesId)) notFound();

  let series: Awaited<ReturnType<typeof getSeatSeries>>;
  try {
    series = await getSeatSeries(seriesId);
  } catch {
    // The node was unreachable or rate limited. The series is probably fine, so say that instead of
    // pretending it does not exist.
    return (
      <main className="pv-page">
        <section className="pv-page-hero">
          <div className="pv-shell">
            <Link href="/seats" className="pv-index seat-desk-back">
              ← Vault Seats
            </Link>
            <h1 className="pv-h1 pv-page-title">Chain is busy</h1>
            <p className="pv-body pv-measure pv-page-lead">
              Could not reach the Robinhood node to load series #{seriesId}. Reload in a moment — the
              public RPC rate limits bursts of reads.
            </p>
          </div>
        </section>
      </main>
    );
  }
  if (!series) notFound();

  return (
    <main className="pv-page">
      <section className="pv-page-hero">
        <div className="pv-shell">
          <Reveal>
            <Link href="/seats" className="pv-index seat-desk-back">
              ← Vault Seats
            </Link>
            <h1 className="pv-h1 pv-page-title">{series.name}</h1>
            <p className="pv-body pv-measure pv-page-lead">
              ${series.symbol} · {series.maxSupply.toString()} seats · series #{series.seriesId}
            </p>
          </Reveal>
        </div>
      </section>

      <section className="pv-section seat-desk-section">
        <div className="pv-shell">
          <SeatsSeriesDesk series={series} />
        </div>
      </section>
    </main>
  );
}
