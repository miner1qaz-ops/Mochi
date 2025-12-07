'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, cancelListing, fillListing, listCard } from '../../lib/api';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { buildV0Tx } from '../../lib/tx';
import { deriveAta } from '../../lib/ata';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const POLL_MS = 12_000;

interface Listing {
  core_asset: string;
  price_lamports: number;
  seller?: string;
  status: string;
  currency_mint?: string | null;
  ts?: number;
  template_id?: number | null;
  rarity?: string | null;
  name?: string | null;
  image_url?: string | null;
  is_fake?: boolean;
}

const statusBadges: Record<string, string> = {
  active: 'bg-emerald-400/15 text-emerald-200 border border-emerald-400/30',
  listed: 'bg-emerald-400/15 text-emerald-200 border border-emerald-400/30',
  filled: 'bg-cyan-400/15 text-cyan-100 border border-cyan-400/30',
  cancelled: 'bg-amber-400/15 text-amber-100 border border-amber-400/30',
};

const holoBg =
  'bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(45,212,191,0.28),transparent_30%),radial-gradient(circle_at_30%_80%,rgba(244,114,182,0.25),transparent_40%)]';

const rarityColors: Record<string, string> = {
  common: 'bg-white/10 text-white border-white/10',
  uncommon: 'bg-emerald-400/15 text-emerald-100 border-emerald-400/30',
  rare: 'bg-cyan-400/15 text-cyan-100 border-cyan-400/30',
  doublerare: 'bg-blue-400/15 text-blue-100 border-blue-400/30',
  ultrarare: 'bg-fuchsia-400/15 text-fuchsia-100 border-fuchsia-400/30',
  illustrationrare: 'bg-amber-400/15 text-amber-100 border-amber-400/30',
  specialillustrationrare: 'bg-amber-500/20 text-amber-50 border-amber-400/40',
  megahyperrare: 'bg-purple-500/20 text-purple-50 border-purple-400/40',
  energy: 'bg-slate-400/15 text-slate-100 border-slate-400/30',
};

function formatLamports(value: number) {
  if (!value || Number.isNaN(value)) return '0';
  const sol = value / LAMPORTS_PER_SOL;
  return `${sol.toFixed(6)} SOL`;
}

function statusLabel(status?: string) {
  if (!status) return 'listed';
  return status.toLowerCase();
}

function rarityBadge(rarity?: string) {
  if (!rarity) return 'bg-white/10 text-white border-white/10';
  const key = rarity.toLowerCase().replace(/[^a-z]/g, '');
  return rarityColors[key] || 'bg-white/10 text-white border-white/10';
}

function rarityGlowClass(rarity?: string | null) {
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
}

const normalizeImage = (src?: string | null) => {
  if (!src) return undefined;
  let url = src;
  if (url.startsWith('ipfs://')) {
    url = url.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }
   // Legacy metadata was minted on mochims.fun; rewrite to getmochi.fun where we proxy /nft/.
  url = url.replace('mochims.fun', 'getmochi.fun');
  return url;
};

const displayName = (name?: string | null, templateId?: number | null, fallback?: string) => {
  if (templateId && name && !name.includes('#')) return `${name} #${templateId}`;
  if (name) return name;
  if (templateId) return `Card #${templateId}`;
  return fallback || '';
};

const shortAddr = (v?: string | null) => {
  if (!v) return '';
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
};

function TiltCard({
  children,
  accent = 'from-cyan-400/40 via-fuchsia-500/30 to-amber-400/30',
}: {
  children: ReactNode;
  accent?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = ref.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const midX = rect.width / 2;
    const midY = rect.height / 2;
    const ry = ((x - midX) / midX) * 6;
    const rx = -((y - midY) / midY) * 6;
    setTilt({ rx, ry });
  };

  const reset = () => setTilt({ rx: 0, ry: 0 });

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      className="relative group"
      style={{ '--rx': `${tilt.rx}deg`, '--ry': `${tilt.ry}deg` } as CSSProperties}
    >
      <div className="absolute inset-0 rounded-3xl bg-white/5 blur-xl group-hover:opacity-80 opacity-0 transition duration-500" />
      <div
        className={`relative overflow-hidden rounded-3xl border border-white/10 ${holoBg} transform-gpu transition duration-300 [transform:perspective(1200px)_rotateX(var(--rx))_rotateY(var(--ry))]`}
      >
        <div className={`absolute inset-0 opacity-60 bg-gradient-to-r ${accent}`} />
        <div className="absolute inset-0 mix-blend-screen bg-[linear-gradient(120deg,rgba(255,255,255,0.25)_0%,rgba(255,255,255,0)_40%)] animate-pulse" />
        <div className="relative">{children}</div>
      </div>
    </motion.div>
  );
}

function ParticleBurst({ trigger }: { trigger: number | null }) {
  if (!trigger) return null;
  const particles = Array.from({ length: 14 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((_, i) => (
        <motion.span
          key={`${trigger}-${i}`}
          className="absolute w-1.5 h-1.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(255,255,255,0.7)]"
          initial={{ opacity: 1, x: 0, y: 0, scale: 0.7 }}
          animate={{
            opacity: 0,
            x: (Math.random() - 0.5) * 320,
            y: (Math.random() - 0.5) * 320,
            scale: 1.4,
          }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{ top: '50%', left: '50%' }}
        />
      ))}
    </div>
  );
}

export default function MarketplacePage() {
  const [feed, setFeed] = useState<Listing[]>([]);
  const [coreAssetInput, setCoreAssetInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [filter, setFilter] = useState('');
  const [showList, setShowList] = useState(false);
  const [useUsdc, setUseUsdc] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [sort, setSort] = useState<'new' | 'price_asc' | 'price_desc'>('new');
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT ? new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT) : null;

  const vaultAuthority = useMemo(() => {
    const vaultState = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], PROGRAM_ID)[0];
    const vaultAuth = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_authority'), vaultState.toBuffer()],
      PROGRAM_ID
    )[0];
    return vaultAuth;
  }, []);

  const mergeFeed = useCallback((incoming: Listing[]) => {
    const now = Date.now();
    setFeed((prev) => {
      const map = new Map<string, Listing>();
      const prevMap = new Map(prev.map((p) => [p.core_asset, p]));
      incoming.forEach((item, idx) => {
        const ts = prevMap.get(item.core_asset)?.ts ?? now - idx;
        map.set(item.core_asset, { ...item, ts });
      });
      return Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    });
  }, []);

  const fetchListings = useCallback(() => {
    api
      .get('/marketplace/listings')
      .then((res) => mergeFeed(res.data))
      .catch((err) => console.error('fetch listings failed', err));
  }, [mergeFeed]);

  useEffect(() => {
    fetchListings();
    const id = setInterval(fetchListings, POLL_MS);
    return () => clearInterval(id);
  }, [fetchListings]);

  const handleList = async () => {
    if (!publicKey) {
      setStatusMsg('Connect wallet to list');
      return;
    }
    if (!coreAssetInput || !priceInput) {
      setStatusMsg('Enter asset and price');
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      let currencyMint: string | undefined;
      if (useUsdc) {
        if (!usdcMint) throw new Error('USDC mint not set');
        await deriveAta(publicKey, usdcMint); // ensure ATA derivations are possible
        await deriveAta(vaultAuthority, usdcMint);
        currencyMint = usdcMint.toBase58();
      }
      const res = await listCard(coreAssetInput.trim(), publicKey.toBase58(), Number(priceInput), currencyMint);
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setStatusMsg(`Listed! Tx: ${sig}`);
      setBurst(Date.now());
      fetchListings();
      // reload to reflect the new listing consistently
      window.location.reload();
    } catch (e: any) {
      const apiMsg = e?.response?.data?.detail || e?.message;
      setStatusMsg(apiMsg || 'List failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFill = async (asset: string) => {
    if (!publicKey) {
      setStatusMsg('Connect wallet to buy');
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fillListing(asset, publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setStatusMsg(`Bought! Tx: ${sig}`);
      setBurst(Date.now());
      fetchListings();
    } catch (e: any) {
      const apiMsg = e?.response?.data?.detail || e?.message;
      setStatusMsg(apiMsg || 'Buy failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (asset: string) => {
    if (!publicKey) {
      setStatusMsg('Connect wallet to cancel');
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await cancelListing(asset, publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setStatusMsg(`Cancelled. Tx: ${sig}`);
      fetchListings();
    } catch (e: any) {
      const apiMsg = e?.response?.data?.detail || e?.message;
      setStatusMsg(apiMsg || 'Cancel failed');
    } finally {
      setLoading(false);
    }
  };

  const filteredFeed = feed.filter((l) => {
    const query = filter.toLowerCase();
    if (rarityFilter && (l.rarity || '').toLowerCase().replace(/[^a-z]/g, '') !== rarityFilter.toLowerCase()) {
      return false;
    }
    return (
      !query ||
      l.core_asset.toLowerCase().includes(query) ||
      (l.seller || '').toLowerCase().includes(query) ||
      (l.name || '').toLowerCase().includes(query) ||
      (l.rarity || '').toLowerCase().includes(query) ||
      statusLabel(l.status).includes(query)
    );
  });
  const sortedFeed = [...filteredFeed].sort((a, b) => {
    if (sort === 'price_asc') return (a.price_lamports || 0) - (b.price_lamports || 0);
    if (sort === 'price_desc') return (b.price_lamports || 0) - (a.price_lamports || 0);
    return (b.ts || 0) - (a.ts || 0);
  });

  return (
    <div className="relative space-y-6">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(126,34,206,0.18),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(6,182,212,0.2),transparent_30%)]" />
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-semibold">Marketplace</h1>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/70 bg-white/5">
            {statusMsg || 'Ready'}
          </div>
          <button
            onClick={() => setShowList((v) => !v)}
            className="px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-ink text-sm font-semibold shadow-lg shadow-cyan-500/20"
          >
            {showList ? 'Close form' : 'List a card'}
          </button>
        </div>
      </div>

      {showList && (
        <TiltCard accent="from-emerald-400/50 via-cyan-400/30 to-fuchsia-500/30">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/60">List a card</p>
              <div className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={useUsdc}
                  onChange={(e) => setUseUsdc(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span className="text-white/70">USDC</span>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <input
                value={coreAssetInput}
                onChange={(e) => setCoreAssetInput(e.target.value)}
                placeholder="Core asset pubkey"
                className="w-full px-4 py-3 rounded-2xl bg-white/10 border border-white/10 text-sm outline-none focus:border-cyan-400/70"
              />
              <input
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="Price (lamports)"
                className="w-full px-4 py-3 rounded-2xl bg-white/10 border border-white/10 text-sm outline-none focus:border-cyan-400/70"
              />
            </div>
            <button
              onClick={handleList}
              disabled={loading}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-ink font-semibold shadow-lg shadow-cyan-500/20 disabled:opacity-60"
            >
              {loading ? 'Listing...' : 'List it'}
            </button>
            <p className="text-xs text-white/60">
              2% fee to treasury. SOL path live; USDC optional.
            </p>
          </div>
        </TiltCard>
      )}

      <div className="grid gap-3 md:grid-cols-4 md:items-end">
        <div className="md:col-span-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search asset, seller, rarity, status…"
            className="w-full px-4 py-3 rounded-2xl bg-white/10 border border-white/10 text-sm outline-none focus:border-fuchsia-400/70"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={rarityFilter}
            onChange={(e) => setRarityFilter(e.target.value)}
            className="flex-1 px-3 py-3 rounded-2xl bg-white/10 border border-white/10 outline-none focus:border-cyan-400/70 text-sm"
          >
            <option value="">Rarity: All</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="doublerare">DoubleRare</option>
            <option value="ultrarare">UltraRare</option>
            <option value="illustrationrare">IllustrationRare</option>
            <option value="specialillustrationrare">SpecialIllustrationRare</option>
            <option value="megahyperrare">MegaHyperRare</option>
            <option value="energy">Energy</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            className="flex-1 px-3 py-3 rounded-2xl bg-white/10 border border-white/10 outline-none focus:border-cyan-400/70 text-sm"
          >
            <option value="new">Newest</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
          </select>
        </div>
        <div className="flex justify-end">
          <button
            onClick={fetchListings}
            className="px-4 py-3 rounded-2xl bg-white/10 border border-white/10 hover:border-cyan-400/60 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      <ParticleBurst trigger={burst} />

      {sortedFeed.length === 0 ? (
        <p className="text-center text-white/60 py-10">No active listings yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {sortedFeed.map((listing) => {
            const badgeClass = statusBadges[statusLabel(listing.status)] || 'bg-white/10 text-white border border-white/10';
            const rarityClass = rarityBadge(listing.rarity || undefined);
            const isSeller = publicKey && listing.seller && publicKey.toBase58() === listing.seller;
            const isFake = !!listing.is_fake;
            const imgSrc = isFake
              ? normalizeImage(listing.image_url) || '/card_back.png'
              : normalizeImage(listing.image_url) ||
                (listing.template_id ? `https://assets.tcgdex.net/en/me/me01/${listing.template_id}/high.png` : undefined) ||
                '/card_back.png';
            const nameLabel = displayName(listing.name, listing.template_id, listing.core_asset);
            return (
              <TiltCard key={listing.core_asset}>
                <div className={`p-3 space-y-3 ${rarityGlowClass(listing.rarity)}`}>
                  <div className="w-full aspect-[3/4] rounded-xl overflow-hidden bg-white/5 border border-white/5 relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgSrc}
                      alt={nameLabel || 'card'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/card_back.png';
                      }}
                    />
                    {isFake && (
                      <div className="absolute inset-x-2 bottom-2 rounded-lg bg-rose-500/80 text-[11px] text-white px-2 py-1 text-center">
                        Unverified · No physical redemption
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[11px] text-white/60">
                      <span className="px-2 py-1 rounded-full bg-white/10 border border-white/10">{listing.currency_mint ? 'USDC' : 'SOL'}</span>
                      <span className={`px-2 py-1 rounded-full ${badgeClass}`}>{statusLabel(listing.status)}</span>
                      {listing.rarity && (
                        <span className={`px-2 py-1 rounded-full ${rarityClass}`}>{listing.rarity}</span>
                      )}
                      {isFake && (
                        <span className="px-2 py-1 rounded-full bg-rose-500/20 border border-rose-500/60 text-rose-100">
                          Unverified
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-lg break-words">{nameLabel}</p>
                    {listing.template_id && <p className="text-white/60 text-sm">Template #{listing.template_id}</p>}
                    <p className="text-white/70 text-sm">Seller: {shortAddr(listing.seller) || 'unknown'}</p>
                  </div>
                  <div className="rounded-2xl px-3 py-2 bg-white/10 border border-white/10 text-sm flex items-center justify-between">
                    <span className="text-white/60">Price</span>
                    <span className="font-semibold text-white">{formatLamports(listing.price_lamports)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-ink font-semibold shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                      onClick={() => handleFill(listing.core_asset)}
                      disabled={loading || statusLabel(listing.status) !== 'active'}
                    >
                      Buy
                    </button>
                    {isSeller && (
                      <button
                        className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 hover:border-amber-300/60 disabled:opacity-50"
                        onClick={() => handleCancel(listing.core_asset)}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </TiltCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
