'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchListings, fetchMarketCards, fetchPricingSets, type Listing, type MarketCardSummary } from '../../lib/api';
import { resolveCardArtSync } from '../../lib/resolveCardArt';

const formatUsd = (v?: number | null) =>
  v || v === 0 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const formatSol = (v?: number | null) => (v ? `${v.toFixed(4)} SOL` : '—');

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
      const packHint = tmplId >= 2000 ? 'phantasmal_flames' : 'meg_web';
      const resolvedImage =
        resolveCardArtSync({
          packType: packHint,
          setCode: packHint,
          templateId: tmplId,
          imageUrl: sample.image_url ?? null,
        }) || undefined;
      return {
        template_id: tmplId,
        name: sample.name || `Card #${tmplId}`,
        set_name: undefined,
        rarity: sample.rarity || undefined,
        image_url: resolvedImage,
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

  const handleTiltMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const rotateX = (0.5 - y) * 10;
    const rotateY = (x - 0.5) * 10;
    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.04)`;
    el.style.zIndex = '50';
  };

  const handleTiltLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
    el.style.zIndex = 'auto';
  };

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

      <div className="grid grid-cols-2 max-[520px]:grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-3">
        {filtered.map((card) => {
          const packHint = card.template_id && card.template_id >= 2000 ? 'phantasmal_flames' : 'meg_web';
          const imageSrc =
            resolveCardArtSync({
              packType: packHint,
              setCode: packHint,
              templateId: card.template_id ?? null,
              imageUrl: card.image_url ?? null,
            }) || '/card_back.png';
          return (
            <div key={`${card.template_id}-${card.name}`} className="h-full">
              <div className={`card-blur h-full rounded-2xl p-3 border border-white/5 space-y-3 flex flex-col relative ${rarityGlowClass(card.rarity)}`}>
              <Link href={`/market/card/${card.template_id}`} className="space-y-2 block">
                <div className="relative aspect-[3/4] rounded-xl overflow-visible">
                  <div
                    className="relative h-full w-full overflow-hidden rounded-xl border border-white/10 bg-black/30 transition-transform duration-200 ease-out will-change-transform"
                    style={{ transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)', transformStyle: 'preserve-3d' }}
                    onMouseMove={handleTiltMove}
                    onMouseLeave={handleTiltLeave}
                  >
                    <img
                      src={imageSrc}
                      alt={card.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute top-2 left-2 flex gap-2 text-[11px] pointer-events-none">
                      <span className="glass-chip glass-chip--tiny bg-white/10 border-white/20">
                        {card.listing_count > 0 ? `${card.listing_count} live` : 'No listing'}
                      </span>
                      {card.is_fake && (
                        <span className="glass-chip glass-chip--tiny bg-rose-500/20 border-rose-400/60 text-rose-100">Unverified</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-base truncate">{card.name}</p>
                    <span className="glass-chip glass-chip--tiny">{card.rarity || '—'}</span>
                  </div>
                  <p className="text-sm font-semibold text-emerald-300">
                    {card.listing_count > 0 ? formatSol(card.lowest_listing ?? undefined) : formatUsd(card.fair_price ?? undefined)}
                  </p>
                  <div className="text-xs text-white/60 flex gap-2 flex-wrap">
                    <span className="glass-chip glass-chip--tiny bg-white/5 border-white/10 truncate">{card.set_name || 'Unknown set'}</span>
                    <span className="glass-chip glass-chip--tiny bg-white/5 border-white/10">
                      {card.listing_count > 0 ? 'Buy' : 'Price only'}
                    </span>
                  </div>
                </div>
              </Link>
                <div className="mt-auto flex items-center gap-2 text-sm">
                  <div className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                    <p className="text-[11px] text-white/60">{card.listing_count > 0 ? 'Lowest listing' : 'Fair price'}</p>
                    <p className="font-semibold text-white">
                      {card.listing_count > 0 ? formatSol(card.lowest_listing ?? undefined) : formatUsd(card.fair_price ?? undefined)}
                    </p>
                  </div>
                  <Link
                    href={`/market/card/${card.template_id}`}
                    className={`px-3 py-2 rounded-xl font-semibold text-center flex-1 ${
                      card.listing_count > 0
                        ? 'bg-aurora text-ink hover:brightness-110'
                        : 'bg-white/10 border border-white/20 text-white hover:border-aurora/50'
                    }`}
                  >
                    {card.listing_count > 0 ? 'Buy' : 'View'}
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
        {!loading && hasSearched && !filtered.length && <div className="text-white/60 text-sm">No cards found.</div>}
      </div>
    </div>
  );
}
