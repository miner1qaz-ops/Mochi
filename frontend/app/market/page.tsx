'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { fetchListings, fetchMarketCards, fetchPricingSets, type Listing, type MarketCardSummary } from '../../lib/api';

const formatUsd = (v?: number | null) =>
  v || v === 0 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const formatSol = (v?: number | null) => (v ? `${v.toFixed(4)} SOL` : '—');

function Sparkline({ points }: { points: MarketCardSummary['sparkline'] }) {
  if (!points?.length) return <div className="text-[11px] text-white/50">No data</div>;
  const sorted = [...points].sort((a, b) => a.collected_at - b.collected_at);
  const values = sorted.map((p) => p.fair_value ?? p.mid_price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const up = values[values.length - 1] >= values[0];
  const width = 120;
  const height = 40;
  const coords = sorted.map((p, i) => {
    const x = (i / Math.max(1, sorted.length - 1)) * width;
    const val = values[i];
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-10">
      <polyline
        fill="none"
        stroke={up ? '#34d399' : '#f87171'}
        strokeWidth="2"
        points={coords.join(' ')}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

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

function TiltCard({ children }: { children: ReactNode }) {
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
    const ry = ((x - midX) / midX) * 5;
    const rx = -((y - midY) / midY) * 5;
    setTilt({ rx, ry });
  };

  const reset = () => setTilt({ rx: 0, ry: 0 });

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ '--rx': `${tilt.rx}deg`, '--ry': `${tilt.ry}deg` } as CSSProperties}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 via-white/5 to-white/0 shadow-[0_25px_40px_-30px_rgba(0,0,0,0.8)] transition duration-300 [transform:perspective(900px)_rotateX(var(--rx))_rotateY(var(--ry))] hover:border-white/20 hover:shadow-[0_25px_40px_-25px_rgba(67,217,173,0.35)]"
    >
      <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-70 transition duration-300 bg-[radial-gradient(circle_at_20%_20%,rgba(52,211,153,0.2),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(244,114,182,0.15),transparent_30%)]" />
      <div className="relative">{children}</div>
    </div>
  );
}

export default function MarketPage() {
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState<string>('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [sort, setSort] = useState<'value' | 'lowest' | 'highest' | 'name'>('value');
  const [sets, setSets] = useState<string[]>([]);
  const [cards, setCards] = useState<MarketCardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const initialized = useRef(false);

  const mapListingsToCards = (listings: Listing[]): MarketCardSummary[] => {
    const byTemplate: Record<number, { lowest: number; count: number; sample: Listing }> = {};
    listings.forEach((l) => {
      if (!l.template_id) return;
      const priceSol = l.price_lamports ? l.price_lamports / 1_000_000_000 : null;
      const entry = byTemplate[l.template_id];
      if (!entry) {
        byTemplate[l.template_id] = { lowest: priceSol ?? 0, count: 1, sample: l };
      } else {
        entry.count += 1;
        if (priceSol !== null && (entry.lowest === 0 || priceSol < entry.lowest)) {
          entry.lowest = priceSol;
        }
      }
    });
    return Object.entries(byTemplate).map(([tid, info]) => {
      const tmplId = Number(tid);
      const sample = info.sample;
      return {
        template_id: tmplId,
        name: sample.name || `Card #${tmplId}`,
        set_name: undefined,
        rarity: sample.rarity || undefined,
        image_url: sample.image_url || undefined,
        fair_price: null,
        lowest_listing: info.lowest || null,
        listing_count: info.count,
        sparkline: [],
      };
    });
  };

  const loadListingsOnly = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMarketCards({
        set_name: setFilter || undefined,
        rarity: rarityFilter || undefined,
        sort,
        listed_only: true,
      });
      setCards(data);
      setHasSearched(false);
      return;
    } catch (primaryErr) {
      console.error(primaryErr);
      try {
        const fallback = await fetchListings();
        const mapped = mapListingsToCards(fallback);
        setCards(mapped);
        setHasSearched(false);
        if (!mapped.length) {
          setError('No active listings found.');
        }
      } catch (fallbackErr) {
        console.error(fallbackErr);
        setError('Failed to load listings.');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadSearch = async () => {
    if (!query || query.trim().length < 2) {
      setError('Type at least 2 characters to search.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMarketCards({
        q: query,
        set_name: setFilter || undefined,
        rarity: rarityFilter || undefined,
        sort,
        listed_only: false,
      });
      setCards(data);
      setHasSearched(true);
    } catch (e) {
      console.error(e);
      setError('Failed to load market data.');
    } finally {
      setLoading(false);
    }
  };

  const resetToListings = () => {
    setQuery('');
    setHasSearched(false);
    setError(null);
    loadListingsOnly();
  };

  useEffect(() => {
    fetchPricingSets().then(setSets).catch(() => setSets([]));
    loadListingsOnly().finally(() => {
      initialized.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    if (hasSearched) {
      loadSearch();
    } else {
      loadListingsOnly();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, setFilter, rarityFilter]);

  const filtered = useMemo(() => cards, [cards]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Mochi Market</h1>
        <p className="text-sm text-white/70 max-w-3xl">
          Active Mochi listings show below. Use search to look up any card by name, set, or ID — even if there’s no active listing, you’ll still see pricing and history.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <input
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            if (error) {
              setError(null);
            }
            if (hasSearched && next.trim().length === 0) {
              resetToListings();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') loadSearch();
          }}
          placeholder="Search Pokémon, set, or card ID…"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sakura"
        />
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <select
            value={setFilter}
            onChange={(e) => setSetFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={rarityFilter}
            onChange={(e) => setRarityFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            <option value="">All rarities</option>
            <option value="Common">Common</option>
            <option value="Uncommon">Uncommon</option>
            <option value="Rare">Rare</option>
            <option value="DoubleRare">DoubleRare</option>
            <option value="UltraRare">UltraRare</option>
            <option value="IllustrationRare">IllustrationRare</option>
            <option value="SpecialIllustrationRare">SpecialIllustrationRare</option>
            <option value="MegaHyperRare">MegaHyperRare</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            <option value="value">Best value</option>
            <option value="lowest">Lowest price</option>
            <option value="highest">Highest price</option>
            <option value="name">Name</option>
          </select>
          <div className="flex items-center gap-2">
            <button
              onClick={loadSearch}
              className="px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-sm hover:bg-white/20"
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Search'}
            </button>
            {hasSearched && (
              <button
                onClick={resetToListings}
                className="px-3 py-2 rounded-lg border border-white/10 text-sm bg-white/5 hover:bg-white/10"
                disabled={loading}
              >
                Clear
              </button>
            )}
          </div>
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </div>

      {!loading && (
        <div className="text-sm text-white/60">
          {hasSearched
            ? 'Search results show live listings plus price-only cards when nothing is listed.'
            : cards.length
                ? 'Showing active on-chain listings. Use search for price lookups on anything else.'
                : 'No active listings yet.'}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((card) => (
          <Link key={`${card.template_id}-${card.name}`} href={`/market/card/${card.template_id}`} className="block">
            <TiltCard>
              <div className="flex flex-col gap-1 p-2 origin-top">
                <div className={`relative overflow-hidden rounded-xl bg-black/40 border border-white/10 ${rarityGlowClass(card.rarity)}`}>
                  {card.image_url ? (
                    <img
                      src={card.image_url}
                      alt={card.name}
                      className="w-full aspect-[3/4] object-contain transition duration-300 ease-out group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full aspect-[3/4] rounded-xl bg-black/30 border border-white/10 flex items-center justify-center text-xs text-white/50">
                      No art
                    </div>
                  )}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-70 transition duration-300 bg-[radial-gradient(circle_at_20%_20%,rgba(52,211,153,0.25),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(244,114,182,0.22),transparent_35%)]" />
                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />
                </div>

                <div className="flex items-center justify-between text-[11px] text-white/60">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded-full bg-white/10 border border-white/10">
                      {card.listing_count > 0 ? `${card.listing_count} live` : 'No listing'}
                    </span>
                    {card.fair_price ? (
                      <span className="px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-emerald-200">
                        Fair {formatUsd(card.fair_price)}
                      </span>
                    ) : null}
                  </div>
                  <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10">
                    {card.listing_count > 0 ? 'Buy' : 'Price only'}
                  </span>
                </div>

                <div className="space-y-0.5">
                  <div className="text-base font-semibold truncate">{card.name}</div>
                  <div className="text-sm font-semibold text-emerald-300">
                    {card.listing_count > 0 ? formatSol(card.lowest_listing ?? undefined) : formatUsd(card.fair_price ?? undefined)}
                  </div>
                  <div className="text-xs text-white/60 flex gap-2">
                    <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 truncate">{card.set_name || 'Unknown set'}</span>
                    <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10">{card.rarity || '—'}</span>
                    {card.is_fake && (
                      <span className="px-2 py-1 rounded-md bg-rose-500/20 border border-rose-400/60 text-rose-100">
                        Unverified
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex flex-col leading-tight">
                    <span className="text-[11px] text-white/60">{card.listing_count > 0 ? 'Listings live' : 'Price only'}</span>
                    <span className="font-semibold">
                      {card.listing_count > 0 ? formatSol(card.lowest_listing ?? undefined) : formatUsd(card.fair_price ?? undefined)}
                    </span>
                  </div>
                  <span
                    className={`px-4 py-2 rounded-full border text-sm ${
                      card.listing_count > 0
                        ? 'border-emerald-300 text-emerald-100 bg-emerald-400/10'
                        : 'border-white/20 text-white/70 bg-white/5'
                    }`}
                  >
                    {card.listing_count > 0 ? 'Buy' : 'View'}
                  </span>
                </div>
              </div>
            </TiltCard>
          </Link>
        ))}
        {!loading && hasSearched && !filtered.length && <div className="text-white/60 text-sm">No cards found.</div>}
      </div>
    </div>
  );
}
