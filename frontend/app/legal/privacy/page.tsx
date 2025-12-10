import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mochi – Privacy Policy (Draft)',
};

export default function PrivacyPage() {
  return (
    <section className="glass-surface rounded-3xl border border-white/5 p-8 space-y-4">
      <div className="flex items-center gap-3">
        <span className="glass-chip glass-chip--tiny bg-white/10 text-white/80">Draft</span>
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      </div>
      <p className="text-sm text-white/70">
        This Privacy Policy page is a draft placeholder for the Mochi platform. The final policy will explain how we collect, use, and protect your data,
        and will be reviewed by legal counsel. For now, Mochi aims to collect only the minimum data needed to operate the platform (for example, wallet addresses and basic analytics).
        Do not share sensitive personal information via support channels.
      </p>
      <div className="rounded-xl border border-dashed border-white/15 bg-black/30 p-4 text-xs text-white/60">
        Draft copy only — updated policy will be published before launch.
      </div>
    </section>
  );
}
