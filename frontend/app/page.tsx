'use client';

import Link from 'next/link';
import type { CSSProperties, PointerEvent } from 'react';

type HeroCard = {
  id: string;
  title: string;
  price: string;
  tag: string;
  status: string;
  accent: string;
  rotate: number;
  x: number;
  y: number;
  z: number;
  image: string;
  glow?: 'aurora' | 'sakura' | 'lime' | 'violet';
};

type UiToken = {
  title: string;
  classes: string;
  usage: string;
};

const heroDeck: HeroCard[] = [
  { id: 'prism', title: 'Prism Legends', price: '0.18 SOL', tag: 'Live rip', status: '11-card pack', accent: 'from-aurora/60 to-sakura/20', rotate: -16, x: -160, y: -32, z: 6, image: '/card_back.png', glow: 'aurora' },
  { id: 'arena', title: 'Arena Ticket', price: '0.05 SOL', tag: 'Floor snipe', status: 'Marketplace', accent: 'from-sakura/60 to-white/5', rotate: -8, x: -90, y: 16, z: 5, image: '/card_back.png', glow: 'sakura' },
  { id: 'vault', title: 'Vaulted Hollow', price: '0.24 SOL', tag: 'Vault PDA', status: 'Redeemable', accent: 'from-coin/60 to-aurora/30', rotate: 0, x: 0, y: -18, z: 8, image: '/card_back.png', glow: 'lime' },
  { id: 'neo', title: 'Neo Spark', price: '0.30 SOL', tag: 'Reverse slot', status: 'Pack hit', accent: 'from-aurora/50 to-white/10', rotate: 12, x: 100, y: 28, z: 4, image: '/card_back.png', glow: 'aurora' },
  { id: 'rare', title: 'Rare Core', price: '0.12 SOL', tag: 'Metaplex Core', status: 'Fair RNG', accent: 'from-violet-400/30 to-white/10', rotate: -4, x: 40, y: -48, z: 9, image: '/card_back.png', glow: 'violet' },
  { id: 'sellback', title: 'Buy-back 90%', price: 'Auto quote', tag: 'Safety net', status: 'Instant calc', accent: 'from-white/10 to-aurora/20', rotate: 20, x: 160, y: -8, z: 3, image: '/card_back.png', glow: 'aurora' },
];

const steps = [
  { title: 'Vaulted', desc: 'Graded Pokémon card is sealed in our vault.' },
  { title: 'Core NFT', desc: 'Metaplex Core asset mirrors the real card.' },
  { title: 'Gacha', desc: 'Open 11-card packs; claim or sell back for 90%.' },
  { title: 'Redeem', desc: 'Burn NFT to trigger shipping of the physical card.' }
];

const callouts = [
  { title: 'RWA secured', desc: 'Vault PDA owns Core assets; no off-chain custody risk.', accent: 'from-sakura/60 to-aurora/30' },
  { title: 'Fair pulls', desc: 'Server seed hash + client seed + nonce → reproducible RNG.', accent: 'from-coin/50 to-white/10' },
  { title: 'Redeemable', desc: 'Burn Core to ship the physical card; admin tracks status.', accent: 'from-violet-400/40 to-white/5' },
];

const feed = [
  { user: '0x91..e3', event: 'Pack opened', details: 'Ultra Rare Charizard, Illustration Rare Mew', time: '2m ago' },
  { user: '0x7c..af', event: 'Listing filled', details: 'SIR Pikachu → 12 SOL', time: '5m ago' },
  { user: '0x4a..9b', event: 'Sell-back', details: 'Full pack @ 90% buy-back', time: '8m ago' },
];

const flow = [
  { title: 'Mint Core', desc: 'Admin mints Metaplex Core NFT to vault PDA.' },
  { title: 'Open Pack', desc: 'User pays SOL/USDC, receives 11 Core assets reserved.' },
  { title: 'Claim or 90%', desc: 'Claim NFTs to wallet or sell back entire pack.' },
  { title: 'Redeem', desc: 'Burn Core NFT to ship physical card; update status.' },
];

const uiTokens: UiToken[] = [
  {
    title: 'Card hover',
    classes: 'hero-card + card-face (vars: --rz, --tx-base, --ty-base)',
    usage: 'Fan cards by setting --rz and offsets; pointer events drive --rx/--ry/--tx/--ty for the “hand move” tilt; hover lifts via --lift and neon glow (see globals.css).',
  },
  {
    title: 'CTA glow',
    classes: 'cta-primary / cta-ghost (data-tone optional)',
    usage: 'Primary = neon bloom + subtle scale; add data-tone="aurora|sakura|lime" to swap glow. Ghost = glass outline for secondary actions.',
  },
  {
    title: 'Glass chips',
    classes: 'glass-chip (use glass-chip--tiny for nav pills)',
    usage: 'Matches header glass buttons; keep labels consistent across hero + tabs.',
  },
];

function TiltCard({ card, mode = 'stack' }: { card: HeroCard; mode?: 'stack' | 'rail' }) {
  const style = {
    '--rz': `${card.rotate}deg`,
    '--tx-base': mode === 'stack' ? `${card.x}px` : '0px',
    '--ty-base': mode === 'stack' ? `${card.y}px` : '0px',
    zIndex: card.z,
  } as CSSProperties;

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const rotateX = (0.5 - y) * 12;
    const rotateY = (x - 0.5) * 12;
    const translateX = (x - 0.5) * 16;
    const translateY = (y - 0.5) * 14;

    event.currentTarget.style.setProperty('--rx', `${rotateX}deg`);
    event.currentTarget.style.setProperty('--ry', `${rotateY}deg`);
    event.currentTarget.style.setProperty('--tx', `${translateX}px`);
    event.currentTarget.style.setProperty('--ty', `${translateY}px`);
  };

  const handleLeave = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--rx', '0deg');
    event.currentTarget.style.setProperty('--ry', '0deg');
    event.currentTarget.style.setProperty('--tx', '0px');
    event.currentTarget.style.setProperty('--ty', '0px');
  };

  return (
    <div
      className={`hero-card ${mode === 'stack' ? 'hero-card--stack' : 'hero-card--rail'}`}
      style={style}
      data-glow={card.glow || 'sakura'}
      onPointerMove={handlePointerMove}
      onPointerLeave={handleLeave}
    >
      <div className="card-face group">
        <div className={`absolute inset-0 bg-gradient-to-br opacity-60 blur-2xl ${card.accent}`} />
        <div className="relative flex h-full flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-white/70 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <span className="glass-chip glass-chip--tiny uppercase tracking-wide">{card.tag}</span>
            <span className="text-white/60">{card.price}</span>
          </div>
          <img
            src={card.image}
            alt={card.title}
            className="h-36 w-full object-contain"
            loading="lazy"
          />
          <div className="flex items-center justify-between text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <span className="font-semibold">{card.title}</span>
            <span className="text-white/60">{card.status}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="space-y-12">
      <section className="card-blur relative overflow-hidden rounded-3xl border border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(33,212,253,0.12),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(245,82,185,0.14),transparent_45%),radial-gradient(circle_at_50%_80%,rgba(110,255,196,0.1),transparent_40%)]" />
        <div className="relative flex flex-col items-center gap-10 p-8 sm:p-10">
          <div className="glass-surface glass-surface--muted relative overflow-hidden rounded-2xl border border-white/5 p-4 w-full max-w-5xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_40%_50%,rgba(86,255,200,0.08),transparent_35%),radial-gradient(circle_at_70%_30%,rgba(245,82,185,0.12),transparent_45%)]" />
            <div className="relative flex justify-center">
              <div className="hero-stage hidden h-[460px] w-full md:flex md:items-center md:justify-center">
                {heroDeck.map((card) => (
                  <TiltCard key={card.id} card={card} mode="stack" />
                ))}
              </div>
              <div className="hero-stage md:hidden flex gap-4 overflow-x-auto pb-4 px-4 justify-start w-full scale-90 sm:scale-95 origin-center min-h-[320px] snap-x snap-mandatory">
                {heroDeck.map((card) => (
                  <TiltCard key={card.id} card={card} mode="rail" />
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <Link href="/gacha" className="cta-primary" data-tone="aurora">Open pack</Link>
            <Link href="/marketplace" className="cta-ghost">Browse market</Link>
            <Link href="/profile" className="cta-ghost cta-ghost--muted">Profile</Link>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="glass-surface rounded-3xl border border-white/5 p-7">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Vault + rip path</h2>
              <p className="text-sm text-white/60">Keep the RWA flow crisp and on-chain.</p>
            </div>
            <span className="glass-chip glass-chip--tiny">Metaplex Core</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {steps.map((step, idx) => (
              <div key={step.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-xs uppercase text-white/60">
                  <span>Step {String(idx + 1).padStart(2, '0')}</span>
                  <span className="glass-chip glass-chip--tiny">RWA</span>
                </div>
                <h3 className="font-semibold mt-2">{step.title}</h3>
                <p className="text-white/60 text-sm mt-1 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-surface rounded-3xl border border-white/5 p-7 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Flow + guarantees</h2>
            <span className="glass-chip glass-chip--tiny">Fair RNG</span>
          </div>
          <div className="grid gap-2">
            {flow.map((c) => (
              <div key={c.title} className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center gap-3">
                <span className="glass-chip glass-chip--tiny">{c.title}</span>
                <p className="text-white/70 text-sm">{c.desc}</p>
              </div>
            ))}
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {callouts.map((c) => (
              <div key={c.title} className="rounded-2xl border border-white/10 bg-white/5 p-4 relative overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br blur-2xl opacity-70 ${c.accent}`} />
                <div className="relative space-y-1">
                  <h3 className="font-semibold">{c.title}</h3>
                  <p className="text-white/70 text-sm leading-relaxed">{c.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="glass-surface rounded-3xl border border-white/5 p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">Live feed</h2>
            <span className="text-white/50 text-sm">Hover tilt stays glassy; scroll to peek recent moves.</span>
          </div>
          <Link href="/gacha" className="cta-ghost glass-chip--tiny text-sm">Open a pack</Link>
        </div>
        <div className="grid md:grid-cols-3 gap-4 text-sm text-white/80">
          {feed.map((item, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 transition">
              <p className="font-semibold">{item.user} • {item.event}</p>
              <p className="text-white/60">{item.details}</p>
              <p className="text-white/40 text-xs">{item.time} • devnet</p>
            </div>
          ))}
          {feed.length === 0 && <p className="text-white/60">No events yet.</p>}
        </div>
      </section>

      <section className="glass-surface rounded-3xl border border-white/5 p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Hover + glow style guide</h2>
            <p className="text-sm text-white/60">Use these classes/props when wiring new buttons or card stacks.</p>
          </div>
          <span className="glass-chip glass-chip--tiny">UI kit</span>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <button className="cta-primary" data-tone="sakura" type="button">CTA glow (pink)</button>
              <button className="cta-primary" data-tone="aurora" type="button">CTA glow (teal)</button>
              <button className="cta-ghost" type="button">Glass ghost</button>
            </div>
            <p className="text-xs text-white/60">
              Primary buttons bloom neon on hover and compress on active; ghost buttons keep glass outlines so the hero cards stay loud.
            </p>
          </div>
          <div className="grid gap-3">
            {uiTokens.map((token) => (
              <div key={token.title} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="font-semibold">{token.title}</p>
                <p className="text-white/60 text-sm">{token.classes}</p>
                <p className="text-white/50 text-xs mt-1">{token.usage}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
