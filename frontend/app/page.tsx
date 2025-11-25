import Link from 'next/link';

const steps = [
  { title: 'Graded Card', desc: 'Physical Pokémon card is graded and locked in vault.' },
  { title: 'Core NFT', desc: 'Metaplex Core asset mirrors the card with vault custody.' },
  { title: 'Gacha & Trade', desc: 'Rip packs, list assets on-chain, swap with other collectors.' },
  { title: 'Redeem', desc: 'Burn NFT to trigger shipping of the physical card.' }
];

export default function HomePage() {
  return (
    <div className="space-y-12">
      <section className="grid md:grid-cols-2 gap-10 items-center">
        <div className="space-y-6">
          <p className="text-sm uppercase tracking-[0.3em] text-white/60">Mochi v2 • Solana devnet</p>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight">
            Tokenized graded Pokémon cards with provably-fair gacha and on-chain marketplace.
          </h1>
          <p className="text-white/70 text-lg">
            Every pull maps to a physical card in our vault. Open 11-card packs, claim to your wallet, or sell back
            instantly for 90% during the decision window.
          </p>
          <div className="flex gap-3">
            <Link href="/gacha" className="px-5 py-3 rounded-full bg-sakura text-ink font-semibold shadow-glow">Open packs</Link>
            <Link href="/marketplace" className="px-5 py-3 rounded-full border border-white/10 hover:border-white/30 transition">Marketplace</Link>
          </div>
        </div>
        <div className="card-blur rounded-3xl p-8 border border-white/5">
          <div className="grid grid-cols-2 gap-4">
            {steps.map((step, idx) => (
              <div key={step.title} className="p-4 rounded-2xl bg-white/5">
                <p className="text-xs uppercase text-white/60">{String(idx + 1).padStart(2, '0')}</p>
                <h3 className="font-semibold mt-2">{step.title}</h3>
                <p className="text-white/60 text-sm mt-1">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="card-blur rounded-3xl p-8 border border-white/5">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Live feed</h2>
          <span className="text-white/50 text-sm">Recent pack openings & trades</span>
        </div>
        <div className="grid md:grid-cols-3 gap-4 text-sm text-white/80">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/5">
              <p className="font-semibold">User {i} • Pack opened</p>
              <p className="text-white/60">Rare hits: Ultra Rare Charizard, Illustration Rare Mew</p>
              <p className="text-white/40 text-xs">~2m ago • devnet</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
