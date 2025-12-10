import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mochi – Terms & Conditions (Draft)',
};

export default function TermsPage() {
  return (
    <section className="glass-surface rounded-3xl border border-white/5 p-8 space-y-4">
      <div className="flex items-center gap-3">
        <span className="glass-chip glass-chip--tiny bg-white/10 text-white/80">Draft</span>
        <h1 className="text-2xl font-semibold">Terms &amp; Conditions</h1>
      </div>
      <p className="text-sm text-white/70">
        This Terms &amp; Conditions page is a draft placeholder for the Mochi platform. It does not yet represent final legal terms.
        The final version will be reviewed by legal counsel and published before any regulated features or token sale are launched.
        Until then, use Mochi at your own risk and only if it is legal to do so in your jurisdiction.
      </p>
      <div className="rounded-xl border border-dashed border-white/15 bg-black/30 p-4 text-xs text-white/60">
        Draft copy only — do not rely on this page as legal advice or a binding agreement.
      </div>
    </section>
  );
}
