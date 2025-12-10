import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Mochi – Whitepaper (Draft)',
};

export default function WhitepaperPlaceholder() {
  return (
    <section className="glass-surface rounded-3xl border border-white/5 p-8 space-y-4">
      <div className="flex items-center gap-3">
        <span className="glass-chip glass-chip--tiny bg-white/10 text-white/80">Draft</span>
        <h1 className="text-2xl font-semibold">Whitepaper (coming soon)</h1>
      </div>
      <p className="text-sm text-white/70">
        Whitepaper v2.x draft is in progress. The full tokenomics, vesting schedules, and sale parameters will be published here once legal review is complete.
      </p>
      <p className="text-sm text-white/60">
        In the meantime, you can read the high-level tokenomics on the homepage or reach out if you need more detail for integrations.
      </p>
      <div>
        <Link href="/#tokenomics" className="cta-ghost" data-tone="aurora">
          Back to tokenomics overview
        </Link>
      </div>
    </section>
  );
}
