'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type PointerEvent } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  buildSeedClaim,
  buildSeedContribute,
  fetchSeedSaleState,
  SeedSaleState,
} from '../lib/api';
import { buildV0Tx } from '../lib/tx';

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

type Listing = {
  core_asset: string;
  price_lamports: number;
  seller?: string | null;
  status?: string | null;
  currency_mint?: string | null;
  template_id?: number | null;
  rarity?: string | null;
  name?: string | null;
  image_url?: string | null;
};

const baseSlots: Pick<HeroCard, 'accent' | 'rotate' | 'x' | 'y' | 'z' | 'glow'>[] = [
  { accent: 'from-aurora/60 to-sakura/20', rotate: -18, x: -360, y: -80, z: 7, glow: 'aurora' },
  { accent: 'from-sakura/60 to-white/5', rotate: -14, x: -250, y: -12, z: 6, glow: 'sakura' },
  { accent: 'from-coin/60 to-aurora/30', rotate: -8, x: -140, y: 32, z: 8, glow: 'lime' },
  { accent: 'from-aurora/50 to-white/10', rotate: -2, x: -70, y: -25, z: 5, glow: 'aurora' },
  { accent: 'from-violet-400/30 to-white/10', rotate: 10, x: 20, y: 32, z: 9, glow: 'violet' },
  { accent: 'from-white/10 to-aurora/20', rotate: -6, x: 110, y: -40, z: 4, glow: 'aurora' },
  { accent: 'from-aurora/70 to-violet-400/20', rotate: 16, x: 210, y: 16, z: 3, glow: 'aurora' },
  { accent: 'from-aurora/60 to-coin/30', rotate: 26, x: 300, y: -14, z: 2, glow: 'lime' },
];

const rarityGlowClass = (rarity?: string | null) => {
  if (!rarity) return 'rarity-glow rarity-glow--common';
  const key = rarity.toLowerCase().replace(/[^a-z]/g, '');
  const map: Record<string, string> = {
    common: 'rarity-glow rarity-glow--common',
    uncommon: 'rarity-glow rarity-glow--uncommon',
    rare: 'rarity-glow rarity-glow--rare',
    doublerare: 'rarity-glow rarity-glow--doublerare',
    ultrarare: 'rarity-glow rarity-glow--ultrarare',
    illustrationrare: 'rarity-glow rarity-glow--illustrationrare',
    specialillustrationrare: 'rarity-glow rarity-glow--specialillustrationrare',
    megahyperrare: 'rarity-glow rarity-glow--megahyperrare',
    energy: 'rarity-glow rarity-glow--energy',
  };
  return map[key] || 'rarity-glow rarity-glow--common';
};

const shortAddr = (v: string) => `${v.slice(0, 4)}...${v.slice(-4)}`;
const formatLamports = (lamports?: number) =>
  lamports || lamports === 0 ? `${(lamports / 1_000_000_000).toFixed(2)} SOL` : '—';

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL && process.env.NEXT_PUBLIC_BACKEND_URL !== ''
    ? process.env.NEXT_PUBLIC_BACKEND_URL
    : '/api';
  const metadataHost = process.env.NEXT_PUBLIC_METADATA_URL || 'https://getmochi.fun';
  const legacyHosts = (process.env.NEXT_PUBLIC_LEGACY_METADATA_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const rewriteLegacyHost = (url: string) => {
    let out = url;
    const target = metadataHost.replace(/^https?:\/\//, '');
    legacyHosts.forEach((host) => {
      const normalized = host.replace(/^https?:\/\//, '');
      out = out.replace(normalized, target);
    });
    return out;
  };

  const normalizeImage = (src?: string | null) => {
    if (!src) return undefined;
    let url = src;
    if (url.startsWith('ipfs://')) {
      url = url.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }
    url = rewriteLegacyHost(url);
    return url;
  };

const displayName = (name?: string | null, templateId?: number | null, fallback?: string) => {
  if (templateId && name && !name.includes('#')) return `${name} #${templateId}`;
  if (name) return name;
  if (templateId) return `Card #${templateId}`;
  return fallback || '';
};

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
      <div className={`card-face group ${rarityGlowClass(card.tag)}`}>
        <div className={`absolute inset-0 bg-gradient-to-br opacity-60 blur-2xl ${card.accent}`} />
        <div className="relative flex h-full flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-white/70 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <span className="glass-chip glass-chip--tiny uppercase tracking-wide">{card.tag}</span>
            <span className="text-white/60">{card.price}</span>
          </div>
          <img
            src={card.image}
            alt={card.title}
            className="h-44 w-full object-contain"
            loading="lazy"
          />
          <div className="flex items-center justify-between text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <span className="font-semibold hero-text">{card.title}</span>
            <span className="text-white/60 hero-text">{card.status}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const { connection } = useConnection();
  const [heroCards, setHeroCards] = useState<HeroCard[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [sale, setSale] = useState<SeedSaleState | null>(null);
  const [contributorCount, setContributorCount] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const [contribution, setContribution] = useState<SeedSaleState['user_contribution']>(null);
  const [stakeLoading, setStakeLoading] = useState(false);
  const [stakeRefresh, setStakeRefresh] = useState(0);
  const [saleRefresh, setSaleRefresh] = useState(0);
  const [solAmount, setSolAmount] = useState('0.05');
  const [txState, setTxState] = useState<{ status: 'idle' | 'sending' | 'success' | 'error'; message?: string }>({
    status: 'idle',
  });

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function fetchSale() {
      setStakeLoading(true);
      try {
        const state = await fetchSeedSaleState(publicKey ? publicKey.toBase58() : undefined);
        setSale(state);
        setContribution(state.user_contribution ?? null);
        setContributorCount(state.contributor_count ?? null);
      } catch (err: any) {
        setSale(null);
        setContribution(null);
        setContributorCount(null);
        setTxState((prev) => ({ ...prev, status: 'error', message: err?.message || 'Failed to load seed sale' }));
      } finally {
        setStakeLoading(false);
      }
    }
    fetchSale();
  }, [saleRefresh, stakeRefresh, publicKey]);

  const countdown =
    sale && sale.end_ts > 0
      ? (() => {
          const remainingMs = sale.end_ts * 1000 - nowTs;
          if (remainingMs <= 0) return 'Ended';
          const totalSeconds = Math.floor(remainingMs / 1000);
          const days = Math.floor(totalSeconds / 86400);
          const hours = Math.floor((totalSeconds % 86400) / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;
          return `${days}d ${hours}h ${minutes}m ${seconds}s`;
        })()
      : 'Loading…';

  const saleProgress = (() => {
    if (!sale) return 0;
    const tokenCapNum = Number(sale.token_cap);
    const soldNum = Number(sale.sold_tokens);
    if (!tokenCapNum) return 0;
    const pct = (soldNum * 100) / tokenCapNum;
    return Math.min(100, pct);
  })();

  const handleContribute = async () => {
    if (!connected || !publicKey) {
      setWalletModalVisible(true);
      return;
    }
    if (!sale) {
      setTxState({ status: 'error', message: 'Sale not loaded yet' });
      return;
    }
    const lamports = Math.floor(Number(solAmount) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports < 0.01 * LAMPORTS_PER_SOL) {
      setTxState({ status: 'error', message: 'Min contribution is 0.01 SOL' });
      return;
    }
    setTxState({ status: 'sending', message: 'Sending transaction…' });
    try {
      const build = await buildSeedContribute(publicKey.toBase58(), lamports);
      const tx = buildV0Tx(publicKey, build.recent_blockhash, build.instructions);
      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      setTxState({
        status: 'success',
        message: `Contributed ${(lamports / LAMPORTS_PER_SOL).toFixed(3)} SOL → ${
          build.tokens_owed / 10 ** (sale?.token_decimals || 0)
        } tokens (sig ${signature})`,
      });
      setStakeRefresh((v) => v + 1);
      setSaleRefresh((v) => v + 1);
    } catch (e: any) {
      setTxState({ status: 'error', message: e?.message || 'Contribution failed' });
    }
  };

  const claimEnabled =
    sale &&
    contribution &&
    !contribution.claimed &&
    sale.end_ts * 1000 <= nowTs &&
    Number(contribution.tokens_owed) > 0;

  const handleClaim = async () => {
    if (!connected || !publicKey) {
      setWalletModalVisible(true);
      return;
    }
    if (!claimEnabled) return;
    setTxState({ status: 'sending', message: 'Sending claim…' });
    try {
      const build = await buildSeedClaim(publicKey.toBase58());
      const tx = buildV0Tx(publicKey, build.recent_blockhash, build.instructions);
      const sig = await sendTransaction(tx, connection, { skipPreflight: false });
      setTxState({
        status: 'success',
        message: `Claimed ${(build.claimable_tokens / 10 ** (sale?.token_decimals || 0)).toFixed(3)} tokens (sig ${sig})`,
      });
      setStakeRefresh((v) => v + 1);
      setSaleRefresh((v) => v + 1);
    } catch (e: any) {
      setTxState({ status: 'error', message: e?.message || 'Claim failed' });
    }
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/marketplace/listings`, { cache: 'no-store' });
        if (!res.ok) throw new Error('bad response');
        const data: Listing[] = await res.json();
        if (!mounted) return;

        const active = (Array.isArray(data) ? data : [])
          .filter((d) => d.status?.toLowerCase() === 'active')
          .sort((a, b) => (b.price_lamports || 0) - (a.price_lamports || 0))
          .slice(0, 10);

        for (let i = active.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [active[i], active[j]] = [active[j], active[i]];
        }

        const deck: HeroCard[] = baseSlots.map((slot, idx) => {
          const listing = active[idx];
          if (!listing) {
            return {
              id: `placeholder-${idx}`,
              title: 'Marketplace',
              price: '—',
              tag: 'Listing',
              status: 'Marketplace',
              accent: slot.accent,
              rotate: slot.rotate,
              x: slot.x,
              y: slot.y,
              z: slot.z,
              image: '/card_back.png',
              glow: slot.glow,
            };
          }

          const image =
            normalizeImage(
              listing.image_url ||
                (listing.template_id
                  ? `https://assets.tcgdex.net/en/me/me01/${listing.template_id}/high.png`
                  : undefined)
            ) || '/card_back.png';

          return {
            id: listing.core_asset,
            title: displayName(listing.name, listing.template_id, shortAddr(listing.core_asset)),
            price: formatLamports(listing.price_lamports),
            tag: listing.rarity || 'Listing',
            status: 'Marketplace',
            accent: slot.accent,
            rotate: slot.rotate,
            x: slot.x,
            y: slot.y,
            z: slot.z,
            image,
            glow: slot.glow,
          };
        });

        setHeroCards(deck);
      } catch {
        if (!mounted) return;
        const deck = baseSlots.map((slot, idx) => ({
          id: `placeholder-${idx}`,
          title: 'Marketplace',
          price: '—',
          tag: 'Listing',
          status: 'Marketplace',
          accent: slot.accent,
          rotate: slot.rotate,
          x: slot.x,
          y: slot.y,
          z: slot.z,
          image: '/card_back.png',
          glow: slot.glow,
        }));
        setHeroCards(deck);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-12">
      <section className="card-blur relative overflow-hidden rounded-3xl border border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(33,212,253,0.12),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(245,82,185,0.14),transparent_45%),radial-gradient(circle_at_50%_80%,rgba(110,255,196,0.1),transparent_40%)]" />
        <div className="relative flex flex-col items-center gap-10 p-8 sm:p-10">
          <div className="glass-surface glass-surface--muted relative overflow-hidden rounded-2xl border border-white/5 p-4 w-full max-w-5xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_40%_50%,rgba(86,255,200,0.08),transparent_35%),radial-gradient(circle_at_70%_30%,rgba(245,82,185,0.12),transparent_45%)]" />
            <div className="relative flex justify-center">
              <div className="hero-stage hidden h-[460px] w-full md:flex md:items-center md:justify-center">
                {loading && heroCards.length === 0 ? (
                  <div className="text-white/60 text-sm py-10">Loading live listings…</div>
                ) : (
                  heroCards.map((card) => <TiltCard key={card.id} card={card} mode="stack" />)
                )}
              </div>
              <div className="hero-stage md:hidden flex gap-4 overflow-x-auto pb-4 px-4 justify-start w-full scale-90 sm:scale-95 origin-center min-h-[320px] snap-x snap-mandatory">
                {loading && heroCards.length === 0 ? (
                  <div className="text-white/60 text-sm py-6">Loading…</div>
                ) : (
                  heroCards.map((card) => <TiltCard key={card.id} card={card} mode="rail" />)
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <Link href="/gacha" className="cta-primary" data-tone="aurora">Open pack</Link>
            <Link href="/marketplace" className="cta-ghost">MarketPlace</Link>
            <Link href="/stadium" className="cta-ghost" data-tone="sakura">Play</Link>
            <Link href="/profile" className="cta-ghost cta-ghost--muted">Profile</Link>
          </div>

          <div className="glass-surface glass-surface--muted mt-4 w-full max-w-4xl rounded-2xl border border-white/10 p-4 md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                  <span className="glass-chip glass-chip--tiny">New</span>
                  <span>Seed sale (devnet)</span>
                </div>
                <h3 className="text-lg font-semibold">30-day Mochi seed raise is live</h3>
                <p className="text-sm text-white/70">
                  Contribute SOL to claim the devnet Mochi token mint. Treasury + vault are PDAs; rewards distribute after the window ends.
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-white/60">
                  <span className="glass-chip glass-chip--tiny">Program</span>
                  <a
                    href="https://explorer.solana.com/address/2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue?cluster=devnet"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-white"
                  >
                    2mt9…ssiue
                  </a>
                  <span className="glass-chip glass-chip--tiny">Price</span>
                  <span>
                    {sale ? `${sale.price_tokens_per_sol / 10 ** (sale.token_decimals || 0)} tokens / SOL` : 'Loading…'}
                  </span>
                  <span className="glass-chip glass-chip--tiny">Window</span>
                  <span>30 days (devnet sandbox)</span>
                </div>
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
                    <span>Ends in: <span className="font-semibold text-white">{countdown}</span></span>
                    {sale?.end_ts ? (
                      <span>
                        Ends at {new Date(sale.end_ts * 1000).toLocaleString()}
                      </span>
                    ) : (
                      <span>Syncing sale clock…</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-white/70">
                      <span>Progress</span>
                      <span className="font-semibold text-white">{sale ? `${saleProgress.toFixed(2)}%` : '—'}</span>
                    </div>
                    <div className="h-3 rounded-full bg-white/10">
                      <div
                        className="h-3 rounded-full bg-gradient-to-r from-aurora/80 to-sakura/80 transition-all duration-500"
                        style={{ width: `${saleProgress}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-white/70">
                      <span>
                        Raised:{' '}
                        <span className="font-semibold text-white">
                          {sale ? (Number(sale.raised_lamports) / 1_000_000_000).toFixed(2) : '—'} SOL
                        </span>
                      </span>
                      <span>
                        Sold:{' '}
                        <span className="font-semibold text-white">
                          {sale ? Number(sale.sold_tokens) / 10 ** (sale.token_decimals || 0) : '—'}
                        </span>{' '}
                        tokens
                      </span>
                      <span>
                        Contributors:{' '}
                        <span className="font-semibold text-white">{contributorCount ?? '—'}</span>
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 text-xs text-white/70 pt-2">
                    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                      <p className="text-white/60">Your stake</p>
                      {stakeLoading ? (
                        <p className="font-semibold text-white mt-1">Loading…</p>
                      ) : contribution ? (
                        <div className="space-y-1">
                          <p className="font-semibold text-white">
                            {(Number(contribution.contributed_lamports) / 1_000_000_000).toFixed(3)} SOL
                          </p>
                          <p className="text-white/60">
                            Tokens owed:{' '}
                            {sale
                              ? (Number(contribution.tokens_owed) / 10 ** (sale.token_decimals || 0)).toFixed(3)
                              : Number(contribution.tokens_owed)}{' '}
                            (devnet)
                          </p>
                        </div>
                      ) : (
                        <p className="font-semibold text-white mt-1">No active stake</p>
                      )}
                      <button
                        type="button"
                        className={`cta-ghost mt-2 w-full text-center ${
                          claimEnabled ? 'opacity-100' : 'opacity-50 cursor-not-allowed'
                        }`}
                        disabled={!claimEnabled || txState.status === 'sending'}
                        onClick={handleClaim}
                        title={claimEnabled ? 'Claim your tokens' : 'Available after sale ends and if unclaimed'}
                      >
                        {txState.status === 'sending' ? 'Processing…' : claimEnabled ? 'Claim tokens' : 'Claim locked until end'}
                      </button>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 p-2 flex flex-col gap-2">
                      <p className="text-white/60">Participate</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={solAmount}
                          onChange={(e) => setSolAmount(e.target.value)}
                          className="w-24 rounded-lg border border-white/20 bg-black/30 px-2 py-1 text-sm text-white outline-none"
                        />
                        <span className="text-sm text-white/70">SOL</span>
                      </div>
                      <button
                        type="button"
                        className="cta-primary text-sm"
                        data-tone="aurora"
                        onClick={() => {
                          if (connected) {
                            handleContribute();
                          } else {
                            setWalletModalVisible(true);
                          }
                        }}
                        disabled={txState.status === 'sending'}
                      >
                        {txState.status === 'sending'
                          ? 'Sending…'
                          : connected
                            ? 'Contribute (devnet)'
                            : 'Connect wallet to seed'}
                      </button>
                      {txState.status !== 'idle' && (
                        <p
                          className={`text-[11px] ${
                            txState.status === 'error' ? 'text-red-300' : 'text-white/70'
                          }`}
                        >
                          {txState.message}
                        </p>
                      )}
                      <p className="text-white/50 text-[11px]">
                        Uses your Phantom wallet on devnet. Min 0.01 SOL. Seeds treasury PDA; tokens are claimable after the window closes.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2 md:self-start">
              <a
                href="https://explorer.solana.com/tx/5bR86vLzYqN9WHsdnmZukaUAwmgBdYQ3u7wCDGv3nJG2JdX1Sa93FiWArY4fZivzUoDsCJPPNr2dGd5tVXFFFBde?cluster=devnet"
                target="_blank"
                rel="noreferrer"
                className="cta-ghost"
              >
                View init tx
              </a>
              <a
                href="https://explorer.solana.com/address/9pSNuqZjx15rzc9mP4tvFGcZYJrczDtLMm6B19s3trY5?cluster=devnet"
                target="_blank"
                rel="noreferrer"
                className="cta-primary"
                data-tone="sakura"
              >
                See seed vault
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-surface rounded-3xl border border-white/5 p-8 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3 lg:w-1/2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/60">
              <span className="glass-chip glass-chip--tiny">Phygital</span>
              <span>Solana</span>
            </div>
            <h2 className="text-2xl font-semibold">Mochi in one view</h2>
            <p className="text-white/70 leading-relaxed">
              Mochi is a Web3 Real World Asset platform on Solana that bridges physical Pokémon cards with digital NFTs.
              We blend TCG nostalgia with on-chain gacha, a marketplace, and redemption back to the real world.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-white/60 text-xs">Cycle</p>
                <p className="font-semibold text-white">Mint → Gacha → Market → Redeem</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-white/60 text-xs">Security</p>
                <p className="font-semibold text-white">Vault PDA custody • Fair RNG</p>
              </div>
            </div>
          </div>
          <div className="lg:w-1/2 rounded-2xl overflow-hidden border border-white/10 bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/platform-flow.png"
              alt="Mochi platform cycle diagram"
              className="w-full h-auto object-contain mochi-float"
              loading="lazy"
            />
          </div>
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
