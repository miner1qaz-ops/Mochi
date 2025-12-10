'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
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

type HeroSlot = Pick<HeroCard, 'accent' | 'glow'> & { angle: number };

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

type TokenomicsRow = {
  label: string;
  percent: string;
};

type FaqItem = {
  id: string;
  question: string;
  answer: React.ReactNode;
  answerText: string;
};

type FaqCategory = {
  id: string;
  label: string;
  blurb: string;
  items: FaqItem[];
};

type RoadmapPhase = {
  id: string;
  phase: string;
  title: string;
  status: 'done' | 'active' | 'upcoming';
  summary: string;
  points: string[];
};

type FlowStep = {
  id: string;
  title: string;
  desc: string;
  hint: string;
};

const SHOW_DEVNET_SEED_SALE = false;
const MAINNET_LAUNCH_TEXT =
  'Mochi mainnet launch – 12 Dec 2025, 10:00 AM (US time). Current site is on devnet for testing only.';
const MAINNET_LAUNCH_TIME = '12 December 2025, 10:00 AM (US time).';

const HERO_FAN = {
  spread: 40,
  pivotY: '120%',
  centerScale: 1.05,
  edgeScale: 0.9,
  edgeDepth: 90,
  baseLift: -90,
  offsetX: 120,
};

const heroAccentPalette: Pick<HeroCard, 'accent' | 'glow'>[] = [
  { accent: 'from-aurora/70 to-coin/40', glow: 'aurora' },
  { accent: 'from-aurora/60 to-sakura/20', glow: 'aurora' },
  { accent: 'from-sakura/60 to-white/5', glow: 'sakura' },
  { accent: 'from-coin/60 to-aurora/30', glow: 'lime' },
  { accent: 'from-aurora/50 to-white/10', glow: 'aurora' },
  { accent: 'from-violet-400/30 to-white/10', glow: 'violet' },
  { accent: 'from-white/10 to-aurora/20', glow: 'aurora' },
  { accent: 'from-aurora/70 to-violet-400/20', glow: 'aurora' },
];

const heroFanSlots: HeroSlot[] = heroAccentPalette.map((slot, idx) => {
  const total = heroAccentPalette.length;
  const t = total === 1 ? 0.5 : idx / (total - 1);
  const angle = HERO_FAN.spread * (t - 0.5);
  return { angle, ...slot };
});

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

const rarityTone = (rarity?: string | null) => {
  if (!rarity) return 'text-white/70';
  const key = rarity.toLowerCase().replace(/[^a-z]/g, '');
  const map: Record<string, string> = {
    ultrarare: 'text-orange-200',
    doublerare: 'text-purple-200',
    rare: 'text-emerald-200',
    illustrationrare: 'text-yellow-200',
    specialillustrationrare: 'text-pink-200',
    megahyperrare: 'text-fuchsia-200',
  };
  return map[key] || 'text-white/80';
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

const ecosystemFlowSteps: FlowStep[] = [
  {
    id: 'mint',
    title: 'Mint',
    hint: 'Vault to chain',
    desc: 'Vault partners verify cards, categorize condition, and mint 1:1 Core NFTs (with images) or record low-value virtual cards so supply matches storage.',
  },
  {
    id: 'gacha',
    title: 'Gacha',
    hint: 'Packs & reveals',
    desc: 'Buy packs with SOL, USDC, or MOCHI; provably-fair openings reserve hits on-chain while commons become virtual cards you can later recycle for MOCHI.',
  },
  {
    id: 'market',
    title: 'Market',
    hint: 'Trade & play',
    desc: 'List and fill Core assets on-chain, price with snapshots, and use inventory in upcoming PvP modes; MOCHI-based fees and burns come online over time.',
  },
  {
    id: 'redeem',
    title: 'Redeem',
    hint: 'Back to reality',
    desc: 'Burn or mark NFTs to ship the physical card from the vault with handling/shipping fees (MOCHI-enabled) and clear status updates.',
  },
];

const roadmapPhases: RoadmapPhase[] = [
  {
    id: 'phase0',
    phase: 'Phase 0',
    title: 'Concept & Prototype',
    status: 'done',
    summary: 'Core idea, tokenomics drafts, brand, and early vault/mint tests.',
    points: [
      'Tokenomics v2.3 draft and Web3 + RWA architecture defined.',
      'Initial community building, brand direction, and prototype UI.',
      'Early vaulting, imaging, and on-chain minting tests for real cards.',
    ],
  },
  {
    id: 'phase1',
    phase: 'Phase 1',
    title: 'Core Launch',
    status: 'active',
    summary: 'Deliver the buy → open → trade → redeem loop with the First Launch Token Sale.',
    points: [
      'Pack Store with initial inventory plus on-chain vaulting + Core NFT minting.',
      'Basic marketplace listings/trades, and physical redemption with fees.',
      'MOCHI token + core Solana programs live; First Launch Token Sale window.',
      'Ship a simple AI/bot mini-game while PvP is in progress.',
    ],
  },
  {
    id: 'phase2',
    phase: 'Phase 2',
    title: 'Product Expansion & PvP Alpha',
    status: 'upcoming',
    summary: 'Upgrade UX and bring the first real PvP mode online.',
    points: [
      'Better market discovery, analytics, and pack drop UX.',
      'First PvP game mode where players stake MOCHI or NFTs head-to-head.',
      'More MOCHI-only drops and broadened product range (JP, CN, other TCGs).',
      'Virtual card tracking and initial recycling flow for bulk cards.',
    ],
  },
  {
    id: 'phase3',
    phase: 'Phase 3',
    title: 'Ecosystem & Infrastructure Growth',
    status: 'upcoming',
    summary: 'Scale inventory, fees, and transparency as usage grows.',
    points: [
      'Deeper inventory across regions with MOCHI-only packs and tournaments.',
      'Introduce small marketplace/game fees in MOCHI with partial burns.',
      'Transparency around recycling/emissions plus public dashboard v1.',
      'Explore local vault auditors and regional logistics partners.',
    ],
  },
  {
    id: 'phase4',
    phase: 'Phase 4',
    title: 'Locking & Community Expansion',
    status: 'upcoming',
    summary: 'Long-term alignment, governance signals, and global reach.',
    points: [
      'MOCHI locking for influence and non-binding community polls on vault direction.',
      'Continued UX/liquidity improvements and seasonal event cadence.',
      'Multi-chain exploration and strategic partnerships where they add user value.',
      'Mature ecosystem with buyback/burn programs and broader vault coverage.',
    ],
  },
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

const tokenomicsDistribution: TokenomicsRow[] = [
  { label: 'Founders & Team', percent: '30%' },
  { label: 'Community & Ecosystem', percent: '40%' },
  { label: 'Treasury Reserve', percent: '10%' },
  { label: 'First Launch Token Sale', percent: '10%' },
  { label: 'Strategic & Liquidity', percent: '10%' },
];

const faqCategories: FaqCategory[] = [
  {
    id: 'general',
    label: 'General',
    blurb: 'Platform basics, how packs flow, and where we operate.',
    items: [
      {
        id: 'what-is-mochi',
        question: 'What is Mochi?',
        answerText:
          'Mochi is a Web3 platform on Solana that connects real-world trading cards to on-chain ownership with packs, marketplace, and redemption.',
        answer: (
          <div className="space-y-2">
            <p>
              Mochi is a Web3 platform that connects <strong className="text-white">real-world trading cards</strong> (starting with Pokémon-style TCG products) to{' '}
              <strong className="text-white">on-chain ownership</strong> on Solana. Buy digital packs, open them online, and receive NFTs that mirror vault-held cards, plus virtual cards tracked in-app.
            </p>
            <p className="text-white/70">
              It is an independent project and is not affiliated with The Pokémon Company, Nintendo, or other IP holders. References are descriptive only.
            </p>
          </div>
        ),
      },
      {
        id: 'pack-flow',
        question: 'How does pack opening work?',
        answerText:
          'You buy a pack, open it online with provably-fair RNG, hits mint as NFTs, bulk becomes virtual cards that you can recycle later.',
        answer: (
          <div className="space-y-2">
            <ul className="list-disc space-y-1 pl-5">
              <li>Buy a digital pack in the <Link href="/gacha" className="underline hover:text-white">Pack Store</Link>.</li>
              <li>Open it online; hits are reserved on-chain while lower-value cards become virtual inventory.</li>
              <li>Claim NFTs to your wallet, list them on the <Link href="/market" className="underline hover:text-white">market</Link>, or sell the pack back if supported.</li>
              <li>Redeem eligible NFTs for the physical card by paying vault + shipping fees; status stays synced.</li>
            </ul>
          </div>
        ),
      },
      {
        id: 'chain',
        question: 'Which blockchain and wallets does Mochi use?',
        answerText: 'Mochi runs on Solana with popular wallets like Phantom supported via the wallet adapter.',
        answer: (
          <div className="space-y-2">
            <p>Mochi runs on Solana. Connect with popular Solana wallets (e.g. Phantom) via the wallet adapter.</p>
            <p className="text-white/70">Always double-check you are on the official getmochi.fun domain before signing.</p>
          </div>
        ),
      },
    ],
  },
  {
    id: 'tokenomics',
    label: 'Tokenomics',
    blurb: 'Utility, supply, and value alignment for MOCHI.',
    items: [
      {
        id: 'utility',
        question: 'What is the MOCHI token used for?',
        answerText:
          'MOCHI is a fixed-supply Solana utility token for packs, PvP entry, marketplace fees, vault/redemption services, VIP perks, and community signals.',
        answer: (
          <div className="space-y-2">
            <p>MOCHI is the utility token of the ecosystem (SPL on Solana) and is designed for in-app use, not speculation:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Buy certain packs and products (some drops are MOCHI-only).</li>
              <li>Enter PvP modes and tournaments; rewards are largely player-funded.</li>
              <li>Pay marketplace, vault, and redemption fees over time.</li>
              <li>Access VIP perks, early drops, and future community signals.</li>
            </ul>
            <p className="text-white/70">MOCHI is not offered as an investment. Prices are volatile; do your own research.</p>
          </div>
        ),
      },
      {
        id: 'supply',
        question: 'Is MOCHI fixed supply?',
        answerText: 'Yes. MOCHI is fixed supply with no continuous minting; emissions draw from the Community & Ecosystem pool.',
        answer: (
          <div className="space-y-2">
            <p>Yes. MOCHI is fixed supply with no continuous minting.</p>
            <p className="text-white/70">
              Rewards come from the pre-allocated Community & Ecosystem pool (pack rewards, tournaments, recycling, and activity incentives) and are tuned based on demand.
            </p>
          </div>
        ),
      },
      {
        id: 'burns',
        question: 'How do buyback and burn work?',
        answerText:
          'A portion of platform revenue may be used to buy MOCHI on the market and burn it, creating deflationary pressure as usage grows.',
        answer: (
          <div className="space-y-2">
            <p>
              Mochi plans a buyback + burn policy: a portion of platform revenue (packs, marketplace, services) may be used to acquire MOCHI on the open market and send it to an irretrievable burn address.
            </p>
            <p className="text-white/70">Percentages and cadence will be published transparently before activation and can evolve with legal and business guidance.</p>
            <p className="text-white/60 text-sm">See the draft details in the <Link href="/docs/whitepaper" className="underline hover:text-white">whitepaper</Link>.</p>
          </div>
        ),
      },
    ],
  },
  {
    id: 'vaulting',
    label: 'Vaulting & Redemption',
    blurb: 'How physical custody, NFTs, and recycling stay aligned.',
    items: [
      {
        id: 'sync',
        question: 'How do physical cards stay in sync with NFTs?',
        answerText:
          'Cards are authenticated, imaged, and vaulted; hits mint as Core NFTs, bulk tracked as virtual cards, and redemption burns or marks NFTs to keep state aligned.',
        answer: (
          <div className="space-y-2">
            <p>Cards are authenticated, imaged (front/back for vaulted hits), and stored with vault partners.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>High-value cards mint as Core NFTs tied to the vault PDA.</li>
              <li>Lower-value bulk is tracked off-chain as virtual cards.</li>
              <li>Redeeming burns/marks the NFT so on-chain state always matches the shelf.</li>
            </ul>
          </div>
        ),
      },
      {
        id: 'redemption',
        question: 'How do redemptions and fees work?',
        answerText:
          'Redeeming an NFT triggers vault pick/pack/ship with handling, shipping, and insurance fees payable in MOCHI or supported currencies.',
        answer: (
          <div className="space-y-2">
            <p>When you redeem an eligible NFT, Mochi takes the card out of the vault and ships it to you.</p>
            <p className="text-white/70">
              Handling, shipping, and insurance fees apply and may be payable partly or fully in MOCHI. Status stays visible so you know when vault-out is complete.
            </p>
            <p className="text-white/60 text-sm">Future phases may let you submit cards for grading directly from the vault.</p>
          </div>
        ),
      },
      {
        id: 'recycling',
        question: 'What is virtual card recycling?',
        answerText:
          'Commons/uncommons tracked as virtual cards can be recycled in batches for a small MOCHI reward from the Community pool, with limits to avoid farming.',
        answer: (
          <div className="space-y-2">
            <p>Commons and uncommons that are too small to mint on-chain stay as virtual cards.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Recycle them in batches to receive a small MOCHI reward from the Community pool.</li>
              <li>Expected value per pack is intentionally lower than pack cost to discourage farming.</li>
              <li>Daily/user caps and audit trails keep recycling fair and tamper-resistant.</li>
            </ul>
          </div>
        ),
      },
    ],
  },
];

function PortalTooltip({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  if (typeof window === 'undefined') return null;
  return createPortal(
    <div
      className="fixed pointer-events-none z-[400]"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, 0)',
      }}
    >
      {children}
    </div>,
    document.body
  );
}

function TiltCard({
  card,
  mode = 'stack',
  index,
  total,
  hoveredId,
  onHover,
}: {
  card: HeroCard;
  mode?: 'stack' | 'rail';
  index: number;
  total: number;
  hoveredId: string | null;
  onHover: (info: { id: string; title: string; price: string; rarity: string; index: number; x: number; y: number } | null) => void;
}) {
  const centerIndex = (total - 1) / 2;
  const distanceFromCenter = total > 1 ? Math.abs(index - centerIndex) / centerIndex : 0;
  const scale =
    HERO_FAN.edgeScale +
    (HERO_FAN.centerScale - HERO_FAN.edgeScale) * (1 - distanceFromCenter);
  const depth = mode === 'stack' ? -HERO_FAN.edgeDepth * distanceFromCenter : 0;
  const lift = mode === 'stack' ? HERO_FAN.baseLift - distanceFromCenter * 10 : 0;
  const offsetX = mode === 'stack' ? (index - centerIndex) * HERO_FAN.offsetX : 0;
  const isHovered = hoveredId === card.id;
  const xOffset = (index - centerIndex) * HERO_FAN.offsetX;
  const rotateZ = (index - centerIndex) * 5;
  const style = {
    '--rz': `${card.rotate}deg`,
    '--tx-base': '0px',
    '--ty-base': mode === 'stack' ? `${lift}px` : '0px',
    '--tz-base': `${depth}px`,
    '--origin-y': mode === 'stack' ? `${HERO_FAN.pivotY}` : '50%',
    '--scale': `${scale}`,
    zIndex: isHovered ? 200 : Math.round(100 - distanceFromCenter * 20),
    x: xOffset,
    y: mode === 'stack' ? lift : 0,
    rotateZ,
  } as CSSProperties;
  const hoverYRef = useRef<number | null>(null);

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

    const stableY = hoverYRef.current ?? rect.top + 220;
    onHover({
      id: card.id,
      title: card.title,
      price: card.price,
      rarity: card.tag,
      index,
      x: rect.left + rect.width / 2,
      y: stableY,
    });
  };

  const handleLeave = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--rx', '0deg');
    event.currentTarget.style.setProperty('--ry', '0deg');
    event.currentTarget.style.setProperty('--tx', '0px');
    event.currentTarget.style.setProperty('--ty', '0px');
    onHover(null);
    hoverYRef.current = null;
  };

  return (
    <motion.div
      className={`hero-card ${mode === 'stack' ? 'hero-card--stack' : 'hero-card--rail'} relative`}
      style={style}
      data-glow={card.glow || 'sakura'}
      onPointerMove={handlePointerMove}
      onPointerLeave={handleLeave}
      onPointerEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        hoverYRef.current = rect.top + 220;
        onHover({
          id: card.id,
          title: card.title,
          price: card.price,
          rarity: card.tag,
          index,
          x: rect.left + rect.width / 2,
          y: hoverYRef.current,
        });
      }}
      whileHover={mode === 'stack' ? { y: -26, scale: 1.04 } : { y: -10, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 220, damping: 20 }}
    >
      <div className="card-face group">
        <div className="relative h-full w-full">
          <img
            src={card.image}
            alt={card.title}
            className={`hero-card-img ${rarityGlowClass(card.tag)}`}
            loading="lazy"
          />
        </div>
      </div>
    </motion.div>
  );
}

function RoadmapTimeline() {
  const defaultActive = roadmapPhases.find((phase) => phase.status === 'active')?.id || roadmapPhases[0]?.id;
  const [activeId, setActiveId] = useState<string>(defaultActive || 'phase0');
  const activePhase = roadmapPhases.find((phase) => phase.id === activeId) || roadmapPhases[0];

  return (
    <section
      id="roadmap"
      className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#050914]/90 p-6 sm:p-8"
    >
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="absolute inset-[-30%] bg-[radial-gradient(circle_at_20%_20%,rgba(33,212,253,0.12),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(245,82,185,0.12),transparent_50%),radial-gradient(circle_at_50%_85%,rgba(255,255,255,0.04),transparent_50%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:120px_120px]" />
      </div>
      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.22em] text-white/60">Roadmap • Galaxy Circuit</p>
            <h2 className="text-2xl font-semibold text-white">Phase-based rollout</h2>
            <p className="text-sm text-white/70">
              Hover or tap to see what is inside each phase. Phase 0 is completed / in progress; Phase 1 is the current focus.
            </p>
          </div>
          <span className="glass-chip glass-chip--tiny">Draft v2.3</span>
        </div>

        <div className="relative overflow-x-auto">
          <div className="relative min-w-[980px] px-4 py-10">
            <div className="absolute left-10 right-10 top-1/2 h-[2px] rounded-full bg-white/10" />
            <div className="flow-line absolute left-10 right-10 top-1/2 h-[2px]" aria-hidden />
            <div className="relative flex items-center justify-between gap-6">
              {roadmapPhases.map((phase) => {
                const isActive = activeId === phase.id;
                const dimmed = phase.status === 'upcoming';
                const haloTone =
                  phase.status === 'done'
                    ? 'from-aurora/70 to-aurora/20'
                    : phase.status === 'active'
                      ? 'from-sakura/80 to-aurora/60'
                      : 'from-white/10 to-white/5';
                return (
                  <button
                    key={phase.id}
                    type="button"
                    className="group relative isolate flex flex-col items-center gap-2"
                    onMouseEnter={() => setActiveId(phase.id)}
                    onFocus={() => setActiveId(phase.id)}
                    onClick={() => setActiveId(phase.id)}
                    aria-pressed={isActive}
                  >
                    <div
                      className={`relative h-14 w-14 rounded-full border border-white/15 bg-black/70 shadow-[0_0_32px_rgba(0,0,0,0.45)] transition ${
                        isActive ? 'scale-110 ring-2 ring-aurora/40' : ''
                      }`}
                    >
                      <div
                        className={`absolute inset-[-6px] rounded-full bg-gradient-to-br ${haloTone} ${
                          phase.status === 'active' ? 'animate-[pulse_1.8s_ease-in-out_infinite]' : ''
                        } ${dimmed ? 'opacity-30' : 'opacity-80'} blur-[1px]`}
                        aria-hidden
                      />
                      <span
                        className={`relative z-10 flex h-full w-full items-center justify-center text-sm font-semibold ${
                          dimmed ? 'text-white/50' : 'text-white'
                        }`}
                      >
                        {phase.phase.replace('Phase ', 'P')}
                      </span>
                    </div>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-white/50">{phase.phase}</span>
                    <span
                      className={`text-sm font-semibold text-center leading-tight ${
                        dimmed ? 'text-white/50' : 'text-white'
                      }`}
                    >
                      {phase.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="glass-surface relative rounded-2xl border border-white/10 bg-[#0b1022]/85 p-5 sm:p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.18em] text-white/60">{activePhase.phase}</p>
              <h3 className="text-xl font-semibold text-white">{activePhase.title}</h3>
              <p className="text-sm text-white/70">{activePhase.summary}</p>
            </div>
            <span
              className={`glass-chip glass-chip--tiny ${
                activePhase.status === 'active'
                  ? 'border-aurora/60 text-aurora'
                  : activePhase.status === 'done'
                    ? 'border-white/20 text-white/80'
                    : 'border-white/10 text-white/60'
              }`}
            >
              {activePhase.status === 'done'
                ? 'Completed / In progress'
                : activePhase.status === 'active'
                  ? 'Current focus'
                  : 'Upcoming'}
            </span>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {activePhase.points.map((point) => (
              <li key={point} className="flex items-start gap-2 text-sm text-white/80">
                <span
                  className="mt-[6px] h-2 w-2 rounded-full bg-gradient-to-br from-aurora to-sakura shadow-[0_0_12px_rgba(110,255,196,0.4)]"
                  aria-hidden
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function EcosystemLoop() {
  const [activeStep, setActiveStep] = useState<string>(ecosystemFlowSteps[0]?.id || 'mint');
  const active = ecosystemFlowSteps.find((step) => step.id === activeStep) || ecosystemFlowSteps[0];

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#060a16]/90 p-6 sm:p-8">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-[-30%] bg-[radial-gradient(circle_at_15%_20%,rgba(33,212,253,0.12),transparent_45%),radial-gradient(circle_at_85%_20%,rgba(245,82,185,0.12),transparent_45%),radial-gradient(circle_at_50%_80%,rgba(110,255,196,0.08),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:120px_120px]" />
      </div>
      <div className="relative z-10 grid gap-8 lg:grid-cols-2 lg:items-center">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.22em] text-white/60">Ecosystem Loop</p>
          <h2 className="text-2xl font-semibold text-white">Mint → Gacha → Market → Redeem</h2>
          <p className="text-sm text-white/70 max-w-2xl">
            A circular view of how real cards move through Mochi. Hover or tap a node to see the details from the whitepaper diagram.
          </p>
        </div>
        <div className="relative flex items-center justify-center">
          <div className="relative mx-auto aspect-square w-full max-w-[520px] flex items-center justify-center">
            <div className="absolute inset-6 rounded-full border border-white/10 bg-gradient-to-b from-white/5 to-black/50 shadow-[0_0_40px_rgba(33,212,253,0.25)]" />
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="loopGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(33,212,253,0.8)" />
                  <stop offset="50%" stopColor="rgba(245,82,185,0.9)" />
                  <stop offset="100%" stopColor="rgba(110,255,196,0.8)" />
                </linearGradient>
              </defs>
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="none"
                stroke="url(#loopGradient)"
                strokeWidth="0.8"
                className="opacity-40"
                strokeDasharray="4 4"
              />
              <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" strokeDasharray="2 6" />
            </svg>
            <motion.div
              className="absolute left-1/2 top-1/2 h-[76%] w-[76%] -translate-x-1/2 -translate-y-1/2"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 14, ease: 'linear' }}
              style={{ transformOrigin: 'center' }}
              aria-hidden
            >
              <div className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-gradient-to-br from-aurora to-sakura shadow-[0_0_18px_rgba(110,255,196,0.7)]" />
            </motion.div>
            {ecosystemFlowSteps.map((step, idx) => {
              const angle = (360 / ecosystemFlowSteps.length) * idx - 90;
              const rad = (angle * Math.PI) / 180;
              const radius = 38;
              const x = 50 + radius * Math.cos(rad);
              const y = 50 + radius * Math.sin(rad);
              const isActive = activeStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border bg-black/70 text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(33,212,253,0.28)] ${
                    isActive ? 'border-aurora/50 ring-2 ring-aurora/30' : 'border-white/10'
                  }`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  onMouseEnter={() => setActiveStep(step.id)}
                  onFocus={() => setActiveStep(step.id)}
                  onClick={() => setActiveStep(step.id)}
                  aria-pressed={isActive}
                >
                  <span className="text-[11px] uppercase tracking-[0.12em] text-white/60">{step.hint}</span>
                  <span className="text-sm font-semibold">{step.title}</span>
                </button>
              );
            })}
            <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/5 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-aurora/20 via-sakura/15 to-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/mochi_icon.png" alt="Mochi mascot" className="h-12 w-12 rounded-full shadow-[0_0_20px_rgba(245,82,185,0.35)]" />
              </div>
            </div>
          </div>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_12px_38px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">Active step</p>
                <h3 className="text-lg font-semibold text-white">{active.title}</h3>
              </div>
              <span className="glass-chip glass-chip--tiny">{active.hint}</span>
            </div>
            <p className="mt-3 text-sm text-white/70">{active.desc}</p>
            <div className="mt-4 grid gap-2 text-xs text-white/60 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <p className="font-semibold text-white/80">Loop</p>
                <p>Mint → Gacha → Market → Redeem</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <p className="font-semibold text-white/80">Utility</p>
                <p>MOCHI unlocks packs, PvP entry, fees, and perks.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function KnowledgeVault() {
  const [selectedCategory, setSelectedCategory] = useState<string>(faqCategories[0]?.id || 'general');
  const [searchTerm, setSearchTerm] = useState('');
  const [openItem, setOpenItem] = useState<string | null>(faqCategories[0]?.items[0]?.id || null);
  const [feedback, setFeedback] = useState<Record<string, 'yes' | 'no'>>({});

  const activeCategory = faqCategories.find((cat) => cat.id === selectedCategory) || faqCategories[0];
  const visibleItems =
    activeCategory?.items.filter(
      (item) =>
        item.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.answerText.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

  return (
    <section
      id="faq"
      className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#05070f]/85 p-6 sm:p-8"
    >
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-[-25%] bg-[radial-gradient(circle_at_10%_20%,rgba(33,212,253,0.1),transparent_40%),radial-gradient(circle_at_85%_10%,rgba(245,82,185,0.1),transparent_40%),radial-gradient(circle_at_60%_90%,rgba(255,255,255,0.04),transparent_40%)]" />
      </div>
      <div className="relative z-10 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/60">The Knowledge Vault</p>
            <h2 className="text-2xl font-semibold text-white">FAQ built for scanning</h2>
            <p className="text-sm text-white/70">Search, filter by topic, and tap a card to expand. Answers include direct links to the right pages.</p>
          </div>
          <span className="glass-chip glass-chip--tiny">Support</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
            <p className="text-xs uppercase tracking-[0.18em] text-white/60">Categories</p>
            <div className="mt-3 space-y-2">
              {faqCategories.map((category) => {
                const active = category.id === selectedCategory;
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      active
                        ? 'border-aurora/50 bg-aurora/10 text-white shadow-[0_10px_30px_rgba(33,212,253,0.25)]'
                        : 'border-white/10 bg-black/30 text-white/70 hover:text-white'
                    }`}
                    onClick={() => {
                      setSelectedCategory(category.id);
                      setOpenItem(category.items[0]?.id || null);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{category.label}</span>
                      <span className="text-xs text-white/60">{category.items.length}</span>
                    </div>
                    <p className="text-xs text-white/60">{category.blurb}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-4">
            <div className="relative">
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search the vault (e.g. recycling, redemption, token)"
                className="w-full rounded-xl border border-white/15 bg-black/50 px-4 py-3 text-sm text-white placeholder:text-white/50 shadow-[0_10px_30px_rgba(0,0,0,0.35)] outline-none focus:border-aurora/60"
              />
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path d="M11 4a7 7 0 015.657 11.143l2.6 2.6-1.414 1.414-2.6-2.6A7 7 0 1111 4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="space-y-3">
              {visibleItems.map((item) => {
                const open = openItem === item.id;
                const picked = feedback[item.id];
                return (
                  <div
                    key={item.id}
                    className="overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/5"
                      onClick={() => setOpenItem(open ? null : item.id)}
                      aria-expanded={open}
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">{item.question}</p>
                        <p className="text-xs text-white/50">Tap to expand</p>
                      </div>
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
                          open ? 'border-aurora/60 text-aurora rotate-90' : 'border-white/15 text-white/70'
                        }`}
                        aria-hidden
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="stroke-current">
                          <path
                            d="M6 9l6 6 6-6"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`transition ${open ? 'rotate-180' : ''}`}
                          />
                        </svg>
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-3 border-t border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                        {item.answer}
                        <div className="flex flex-col gap-2 border-t border-white/10 pt-3 text-xs text-white/60 sm:flex-row sm:items-center sm:justify-between">
                          <span>Was this helpful?</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={`rounded-lg border px-3 py-1 font-semibold transition ${
                                picked === 'yes'
                                  ? 'border-aurora/60 bg-aurora/10 text-white'
                                  : 'border-white/15 bg-black/40 text-white/70 hover:text-white'
                              }`}
                              onClick={() => setFeedback((prev) => ({ ...prev, [item.id]: 'yes' }))}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              className={`rounded-lg border px-3 py-1 font-semibold transition ${
                                picked === 'no'
                                  ? 'border-sakura/60 bg-sakura/10 text-white'
                                  : 'border-white/15 bg-black/40 text-white/70 hover:text-white'
                              }`}
                              onClick={() => setFeedback((prev) => ({ ...prev, [item.id]: 'no' }))}
                            >
                              No
                            </button>
                          </div>
                          {picked && <span className="text-[11px] text-white/60">Thanks for the signal.</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {visibleItems.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
                  No entries found. Try “token”, “recycle”, or “redemption”.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<{
    id: string;
    title: string;
    price: string;
    rarity: string;
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

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
          .slice(0, heroFanSlots.length);

        for (let i = active.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [active[i], active[j]] = [active[j], active[i]];
        }

        const deck: HeroCard[] = heroFanSlots.map((slot, idx) => {
          const listing = active[idx];
          if (!listing) {
            return {
              id: `placeholder-${idx}`,
              title: 'Marketplace',
              price: '—',
              tag: 'Listing',
              status: 'Marketplace',
              accent: slot.accent,
              rotate: slot.angle,
              x: 0,
              y: 0,
              z: 0,
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
            rotate: slot.angle,
            x: 0,
            y: 0,
            z: 0,
            image,
            glow: slot.glow,
          };
        });

        setHeroCards(deck);
      } catch {
        if (!mounted) return;
        const deck = heroFanSlots.map((slot, idx) => ({
          id: `placeholder-${idx}`,
          title: 'Marketplace',
          price: '—',
          tag: 'Listing',
          status: 'Marketplace',
          accent: slot.accent,
          rotate: slot.angle,
          x: 0,
          y: 0,
          z: 0,
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
      <section className="relative overflow-visible rounded-3xl">
        <div className="relative flex flex-col items-center gap-10 p-8 sm:p-10">
              <div className="relative overflow-visible w-full max-w-5xl">
                <div className="relative flex justify-center -translate-y-8 md:-translate-y-12">
              <div className="hero-stage hidden h-[520px] w-full md:flex md:items-center md:justify-center overflow-visible pb-2 relative ml-[-40px]">
                {loading && heroCards.length === 0 ? (
                  <div className="text-white/60 text-sm py-10">Loading live listings…</div>
                ) : (
                  heroCards.map((card, idx) => (
                    <TiltCard
                      key={card.id}
                      card={card}
                      mode="stack"
                      index={idx}
                      total={heroCards.length}
                      hoveredId={hoveredId}
                      onHover={(info) => {
                        setHoveredId(info?.id || null);
                        setHoveredInfo(info);
                      }}
                    />
                  ))
                )}
                {hoveredInfo && (
                  <PortalTooltip x={hoveredInfo.x} y={hoveredInfo.y}>
                    <div className="rounded-lg bg-black px-3 py-2 text-xs text-white shadow-[0_10px_30px_rgba(0,0,0,0.5)] border border-white/10 whitespace-nowrap space-y-0.5">
                      <div className="text-[11px] text-white/60">
                        #{String(hoveredInfo.index + 1).padStart(2, '0')} {hoveredInfo.title}
                      </div>
                      <div className={`text-[11px] font-semibold ${rarityTone(hoveredInfo.rarity)}`}>
                        {hoveredInfo.rarity || '—'}
                      </div>
                      <div className="text-sm font-semibold text-white">{hoveredInfo.price}</div>
                    </div>
                  </PortalTooltip>
                )}
              </div>
              <div className="hero-stage md:hidden flex gap-4 overflow-x-auto overflow-y-visible pb-2 px-4 justify-start w-full scale-90 sm:scale-95 origin-center min-h-[360px] snap-x snap-mandatory relative ml-[-24px]">
                {loading && heroCards.length === 0 ? (
                  <div className="text-white/60 text-sm py-6">Loading…</div>
                ) : (
                  heroCards.map((card, idx) => (
                    <TiltCard
                      key={card.id}
                      card={card}
                      mode="rail"
                      index={idx}
                      total={heroCards.length}
                      hoveredId={hoveredId}
                      onHover={(info) => {
                        setHoveredId(info?.id || null);
                        setHoveredInfo(info);
                      }}
                    />
                  ))
                )}
                {hoveredInfo && (
                  <PortalTooltip x={hoveredInfo.x} y={hoveredInfo.y}>
                    <div className="rounded-lg bg-black px-3 py-2 text-xs text-white shadow-[0_10px_30px_rgba(0,0,0,0.5)] border border-white/10 whitespace-nowrap space-y-0.5">
                      <div className="text-[11px] text-white/60">
                        #{String(hoveredInfo.index + 1).padStart(2, '0')} {hoveredInfo.title}
                      </div>
                      <div className={`text-[11px] font-semibold ${rarityTone(hoveredInfo.rarity)}`}>
                        {hoveredInfo.rarity || '—'}
                      </div>
                      <div className="text-sm font-semibold text-white">{hoveredInfo.price}</div>
                    </div>
                  </PortalTooltip>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mt-6 md:mt-[-60px]">
            <Link href="/gacha" className="cta-primary" data-tone="aurora">Open pack</Link>
            <Link href="/marketplace" className="cta-ghost">MarketPlace</Link>
            <Link href="/stadium" className="cta-ghost" data-tone="sakura">Play</Link>
            <Link href="/profile" className="cta-ghost cta-ghost--muted">Profile</Link>
          </div>

          {!bannerDismissed && (
            <div className="mt-4 w-full max-w-4xl">
              <div className="relative overflow-hidden rounded-full border border-white/15 bg-gradient-to-r from-aurora/20 via-sakura/15 to-coin/20 px-4 py-2 shadow-[0_0_24px_rgba(0,0,0,0.35)]">
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-sm"
                  aria-label="Dismiss mainnet launch alert"
                  onClick={() => setBannerDismissed(true)}
                >
                  ×
                </button>
                <div className="overflow-hidden">
                  <motion.div
                    className="flex items-center gap-8 whitespace-nowrap text-sm text-white/80"
                    animate={{ x: ['0%', '-50%'] }}
                    transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
                  >
                    <span>{MAINNET_LAUNCH_TEXT}</span>
                    <span>{MAINNET_LAUNCH_TEXT}</span>
                  </motion.div>
                </div>
              </div>
            </div>
          )}

          <div className="glass-surface glass-surface--muted mt-4 w-full max-w-4xl rounded-2xl border border-white/10 p-4 md:p-5">
            {SHOW_DEVNET_SEED_SALE ? (
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
            ) : (
              <div className="relative overflow-hidden rounded-xl">
                <motion.div
                  className="pointer-events-none absolute inset-0 rounded-xl opacity-50"
                  style={{
                    background:
                      'linear-gradient(120deg, rgba(99, 255, 203, 0.25), rgba(255, 138, 219, 0.15), rgba(255, 196, 86, 0.18))',
                    backgroundSize: '200% 200%',
                  }}
                  animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
                  transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
                />
                <div className="relative space-y-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/70">
                    <span className="glass-chip glass-chip--tiny">Announcement</span>
                    <span className="flex items-center gap-2 text-emerald-200">
                      <span className="relative inline-flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                      <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-100">Online soon</span>
                    </span>
                  </div>
                  <h3 className="text-2xl font-semibold leading-tight">Mochi is going live on Solana mainnet</h3>
                  <p className="text-sm text-white/70">Mainnet launch: {MAINNET_LAUNCH_TIME}</p>
                  <p className="text-xs text-white/60">Devnet site is for testing only until then.</p>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <Link href="/gacha" className="cta-primary" data-tone="aurora">
                      Try demo packs
                    </Link>
                    <Link href="/marketplace" className="cta-ghost cta-ghost--muted">
                      Browse devnet market
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
          {SHOW_DEVNET_SEED_SALE && (
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
          )}
        </div>
      </section>

      <EcosystemLoop />

      <RoadmapTimeline />

      <section
        id="tokenomics"
        className="relative overflow-hidden rounded-3xl border border-white/5 bg-[#070a15]/85"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-[-20%] bg-[radial-gradient(circle_at_20%_20%,rgba(33,212,253,0.12),transparent_40%),radial-gradient(circle_at_80%_15%,rgba(245,82,185,0.12),transparent_45%),radial-gradient(circle_at_50%_85%,rgba(246,211,101,0.08),transparent_40%)]" />
          <div className="absolute inset-0 opacity-5 mix-blend-soft-light bg-[url('/mochi_icon.png')] bg-[length:140px_140px]" />
        </div>
        <div className="relative z-10 space-y-8 p-6 lg:p-8">
          <div
            className="glass-surface rounded-2xl border border-white/10 bg-white/5 p-6 lg:p-8 shadow-[0_0_40px_rgba(0,0,0,0.55)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_10px_50px_rgba(33,212,253,0.25)]"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="glass-chip glass-chip--tiny">Token</span>
              <span className="glass-chip glass-chip--tiny">Draft</span>
              <span className="glass-chip glass-chip--tiny">On Solana</span>
            </div>
            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2 max-w-3xl">
                <h2 className="text-2xl font-semibold">Tokenomics (Draft)</h2>
                <p className="text-sm text-white/70">
                  MOCHI is designed as a fixed-supply utility token for the Mochi ecosystem. The numbers and structure below are part of a working draft and may be updated before launch. Nothing here is financial advice.
                </p>
              </div>
              <span className="glass-chip glass-chip--tiny bg-white/10 text-white/80">Draft only</span>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tokenomicsDistribution.map((row) => (
                <div
                  key={row.label}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 transition duration-200 hover:-translate-y-1 hover:border-aurora/40 hover:shadow-[0_10px_40px_rgba(33,212,253,0.25)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">{row.label}</div>
                    <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.15em] text-white/60">
                      Draft allocation
                    </span>
                  </div>
                  <div className="mt-3 text-3xl font-semibold text-aurora">{row.percent}</div>
                  <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-aurora/80 via-sakura/70 to-coin/70"
                      style={{ width: row.percent }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-black/30 p-4 text-sm text-white/70">
              Full tokenomics, vesting details, and sale parameters will be published in the whitepaper and updated docs. All values are subject to change based on legal review and market conditions.
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/docs/whitepaper"
                className="cta-ghost relative inline-flex items-center gap-2 overflow-hidden border border-aurora/40 bg-aurora/10 text-white transition hover:shadow-[0_0_30px_rgba(33,212,253,0.35)]"
                data-tone="aurora"
              >
                View full whitepaper (coming soon)
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="stroke-current">
                  <path d="M5 12h14M13 6l6 6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_30px_rgba(0,0,0,0.4)]">
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">Docs</p>
              <h3 className="mt-1 text-lg font-semibold text-white">Read the longform</h3>
              <p className="text-sm text-white/70">
                The whitepaper draft v2.3 covers roadmap, token sinks, recycling, and risks in depth. Keep feedback coming.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/docs/whitepaper" className="cta-primary text-xs" data-tone="aurora">
                  Open draft
                </Link>
                <Link href="/docs" className="cta-ghost text-xs">
                  Browse docs
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <KnowledgeVault />

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
