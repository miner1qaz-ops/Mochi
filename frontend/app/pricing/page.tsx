'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  fetchPricingBySet,
  fetchPricingCard,
  fetchPricingHistory,
  fetchPricingSets,
  searchPrices,
  fetchPricingStats,
  type PricingCardDetail,
  type PricingHistoryPoint,
  type PricingSearchResult,
  type PricingStats,
} from '../../lib/api';

const formatUsd = (v?: number | null) => (v || v === 0 ? `$${v.toFixed(2)}` : '—');
const formatDate = (ts?: number | null) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString();
};
const formatRelative = (ts?: number | null) => {
  if (!ts) return '—';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};
const formatChange = (pct?: number | null) => {
  if (pct === undefined || pct === null) return '—';
  const rounded = pct.toFixed(2);
  return `${pct >= 0 ? '+' : ''}${rounded}%`;
};

type Tab = { key: string; label: string; setName?: string };

export default function PricingPage() {
  const { publicKey } = useWallet();
  const wallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PricingSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('set');
  const [setOptions, setSetOptions] = useState<string[]>([]);
  const [selectedSet, setSelectedSet] = useState<string>('Mega Evolution');
  const [rarityFilter, setRarityFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'mid_desc' | 'mid_asc' | 'name'>('mid_desc');
  const [detailCard, setDetailCard] = useState<PricingCardDetail | null>(null);
  const [detailHistory, setDetailHistory] = useState<PricingHistoryPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailMeta, setDetailMeta] = useState<{ name?: string; set_name?: string; rarity?: string } | null>(null);
  const [stats, setStats] = useState<PricingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [hoveredCardId, setHoveredCardId] = useState<number | null>(null);

  const FEATURED_TABS: Tab[] = [
    { key: 'set', label: 'Set view', setName: selectedSet },
    { key: 'search', label: 'Search' },
  ];

  const runSearch = async (q: string) => {
    const data = await searchPrices(q, 30);
    setResults(data);
  };

  const runSetQuery = async (setName: string) => {
    const data = await fetchPricingBySet(setName, 200);
    setResults(data);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setError('Type at least 2 characters to search.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await runSearch(q);
      setActiveTab('search');
    } catch (err) {
      console.error(err);
      setError('Failed to fetch prices. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // load available sets then default to Mega Evolution if present
    setLoading(true);
    fetchPricingSets()
      .then((names) => {
        setSetOptions(names);
        const preferred = names.includes('Mega Evolution') ? 'Mega Evolution' : names[0];
        if (preferred) {
          setSelectedSet(preferred);
          return runSetQuery(preferred);
        }
        return Promise.resolve();
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to fetch available sets.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!wallet) {
      setStats(null);
      return;
    }
    setStatsLoading(true);
    setStatsError(null);
    fetchPricingStats(wallet)
      .then((data) => setStats(data))
      .catch((err) => {
        console.error(err);
        setStatsError('Unable to load portfolio stats.');
      })
      .finally(() => setStatsLoading(false));
  }, [wallet]);

  const emptyState = useMemo(
    () => !loading && !results.length && !error,
    [loading, results.length, error],
  );

  const filtered = useMemo(() => {
    let arr = results;
    if (rarityFilter !== 'all') {
      arr = arr.filter((r) => (r.rarity || '').toLowerCase() === rarityFilter);
    }
    const price = (r: PricingSearchResult) => r.display_price ?? r.mid_price ?? 0;
    if (sortBy === 'mid_desc') {
      arr = [...arr].sort((a, b) => price(b) - price(a));
    } else if (sortBy === 'mid_asc') {
      arr = [...arr].sort((a, b) => price(a) - price(b));
    } else if (sortBy === 'name') {
      arr = [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return arr;
  }, [results, rarityFilter, sortBy]);

  const openDetail = async (item: PricingSearchResult) => {
    setDetailError(null);
    setDetailLoading(true);
    setDetailMeta({ name: item.name, set_name: item.set_name ?? undefined, rarity: item.rarity ?? undefined });
    try {
      const [card, history] = await Promise.all([
        fetchPricingCard(item.template_id),
        fetchPricingHistory(item.template_id),
      ]);
      setDetailCard(card);
      setDetailHistory(history);
    } catch (err) {
      console.error(err);
      setDetailError('Failed to load price details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailCard(null);
    setDetailHistory([]);
    setDetailError(null);
    setDetailMeta(null);
  };

  const renderConfidence = (conf?: string | null) => {
    const c = (conf || '').toLowerCase();
    const styles =
      c === 'high'
        ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40'
        : c === 'medium'
        ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
        : !c
        ? 'bg-white/10 text-white/70 border-white/20'
        : 'bg-red-500/20 text-red-200 border-red-400/40';
    return (
      <span className={`px-2 py-1 rounded-full text-xs border ${styles}`}>
        {c ? `${c} confidence` : '—'}
      </span>
    );
  };

  const renderSparkline = (points: PricingHistoryPoint[]) => {
    if (!points.length) return <div className="text-xs text-white/60">No history</div>;
    const sorted = [...points].sort((a, b) => a.collected_at - b.collected_at);
    const values = sorted.map((p) => p.fair_value ?? p.mid_price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const isUp = values.length > 1 ? values[values.length - 1] >= values[0] : true;
    const strokeColor = isUp ? '#34d399' : '#f87171';
    const width = 200;
    const height = 60;
    const range = max - min || 1;
    const coords = sorted.map((p, idx) => {
      const x = (idx / Math.max(1, sorted.length - 1)) * width;
      const value = values[idx];
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    });
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16">
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          points={coords.join(' ')}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Mochi Pricing 2.0</h1>
        <p className="text-sm text-white/70 max-w-2xl">
          Live fair-value marks with time-series confidence. Every card gets a sparkline pulse and a hoverable market card that shows when it was last updated.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-[#0b1222] to-[#121826] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/60">Investment dashboard</div>
            <div className="text-xl font-semibold">Your collection at a glance</div>
            {!wallet && <div className="text-sm text-white/60">Connect your wallet to see portfolio value.</div>}
          </div>
          {wallet && (
            <div className="flex gap-4 flex-wrap items-center">
              <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 min-w-[170px]">
                <div className="text-xs text-white/60">Portfolio total</div>
                <div className="text-2xl font-semibold">{stats ? formatUsd(stats.portfolio_total) : '—'}</div>
                <div className="text-[11px] text-white/50">Last update {formatRelative(stats?.last_valuation_at)}</div>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 min-w-[170px]">
                <div className="text-xs text-white/60">24h change</div>
                <div
                  className={`text-2xl font-semibold ${
                    (stats?.change_24h ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {stats ? formatChange(stats.change_24h) : '—'}
                </div>
                {statsError && <div className="text-[11px] text-rose-300">{statsError}</div>}
                {statsLoading && <div className="text-[11px] text-white/60">Refreshing…</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FEATURED_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              setError(null);
              if (tab.key === 'set' && selectedSet) {
                setLoading(true);
                runSetQuery(selectedSet)
                  .catch((err) => {
                    console.error(err);
                    setError('Failed to fetch set prices.');
                  })
                  .finally(() => setLoading(false));
              }
            }}
            className={`px-4 py-2 rounded-full text-sm border ${activeTab === tab.key ? 'bg-white/10 border-white/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'set' && (
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm text-white/70">Set:</label>
          <select
            value={selectedSet}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedSet(next);
              setLoading(true);
              runSetQuery(next)
                .catch((err) => {
                  console.error(err);
                  setError('Failed to fetch set prices.');
                })
                .finally(() => setLoading(false));
            }}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            {setOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <label className="text-sm text-white/70 ml-4">Rarity:</label>
          <select
            value={rarityFilter}
            onChange={(e) => setRarityFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="doublerare">DoubleRare</option>
            <option value="ultrarare">UltraRare</option>
            <option value="illustrationrare">IllustrationRare</option>
            <option value="specialillustrationrare">SpecialIllustrationRare</option>
          </select>

          <label className="text-sm text-white/70 ml-4">Sort:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            <option value="mid_desc">Price: High → Low</option>
            <option value="mid_asc">Price: Low → High</option>
            <option value="name">Name</option>
          </select>
        </div>
      )}

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by card name (e.g. Charizard, Mewtwo)"
          className="w-full sm:w-96 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sakura"
        />
        <button
          type="submit"
          disabled={loading}
          className="cta-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div className="text-sm text-red-400">{error}</div>}
      {emptyState && <div className="text-sm text-white/60">No results yet. Try searching for a card.</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <div key={item.template_id} className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3 shadow-[0_0_30px_rgba(0,0,0,0.25)]">
            {(() => {
              const confidence = (item.confidence_score || item.price_confidence || '').toLowerCase();
              const fairValue = item.fair_value ?? item.display_price ?? item.mid_price ?? 0;
              const spark = item.sparkline || [];
              const firstPoint = spark.length ? spark[spark.length - 1].fair_value ?? spark[spark.length - 1].mid_price : 0;
              const lastPoint = spark.length ? spark[0].fair_value ?? spark[0].mid_price : 0;
              const trend = firstPoint > 0 ? ((lastPoint - firstPoint) / firstPoint) * 100 : 0;
              const trendLabel = spark.length > 1 ? `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}% last 30` : '—';

              return (
                <>
                  <div className="flex items-start gap-3">
                    <div
                      className="relative group"
                      onMouseEnter={() => setHoveredCardId(item.template_id)}
                      onMouseLeave={() => setHoveredCardId(null)}
                    >
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-20 w-16 object-contain rounded-lg bg-black/30 border border-white/10"
                        />
                      ) : (
                        <div className="h-20 w-16 rounded-lg bg-black/30 flex items-center justify-center text-xs text-white/50 border border-white/10">
                          No image
                        </div>
                      )}
                      <div
                        className={`pointer-events-none absolute inset-0 rounded-lg bg-black/80 p-3 flex flex-col gap-2 transition-all duration-200 ${
                          hoveredCardId === item.template_id ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                        }`}
                      >
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Live Market Card</div>
                        <div className="text-2xl font-semibold">{formatUsd(fairValue)}</div>
                        <div className="flex items-center gap-2 text-[11px] text-white/70">
                          {renderConfidence(confidence)}
                          {confidence === 'low' && <span className="flex items-center gap-1 text-amber-200">⚠️ Volatile Market</span>}
                        </div>
                        <div className="text-[11px] text-white/60">Last Updated: {formatRelative(item.collected_at ?? undefined)}</div>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold">{item.name}</div>
                          <div className="text-xs text-white/60">{item.set_name || 'Unknown set'}</div>
                          <div className="text-xs text-white/60">{item.rarity || '—'} · ID #{item.template_id}</div>
                        </div>
                        {renderConfidence(confidence)}
                      </div>
                      <div className="text-lg font-semibold">{formatUsd(fairValue)}</div>
                      <div className="text-[11px] text-white/60">Updated {formatRelative(item.collected_at ?? undefined)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg bg-black/30 p-2 border border-white/5">
                      <div className="text-xs text-white/60">Low</div>
                      <div className="font-semibold">{formatUsd(item.low_price ?? undefined)}</div>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2 border border-white/5">
                      <div className="text-xs text-white/60">Mid</div>
                      <div className="font-semibold">{formatUsd(item.mid_price ?? undefined)}</div>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2 border border-white/5">
                      <div className="text-xs text-white/60">High</div>
                      <div className="font-semibold">{formatUsd(item.high_price ?? undefined)}</div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-black/25 border border-white/5 p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs text-white/60">
                      <span>30-point sparkline</span>
                      <span className={`${trend >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{trendLabel}</span>
                    </div>
                    {renderSparkline(spark)}
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span className="flex items-center gap-1">
                      Last mark: {formatDate(item.collected_at ?? undefined)} · {formatRelative(item.collected_at ?? undefined)}
                    </span>
                    <button
                      type="button"
                      className="text-aurora-200 hover:text-aurora-100"
                      onClick={() => openDetail(item)}
                    >
                      View details
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        ))}
      </div>

      {detailCard && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0d0f1a] border border-white/10 rounded-2xl p-6 w-full max-w-3xl space-y-4 relative">
            <button
              type="button"
              className="absolute top-3 right-3 text-white/60 hover:text-white"
              onClick={closeDetail}
            >
              ✕
            </button>
            <div className="flex flex-wrap justify-between gap-3 items-start">
              <div className="space-y-1">
                <div className="text-lg font-semibold">{detailMeta?.name || `Card #${detailCard.template_id}`}</div>
                <div className="text-sm text-white/60">
                  {detailMeta?.set_name || 'Unknown set'} · {detailMeta?.rarity || '—'} · ID #{detailCard.template_id}
                </div>
                <div className="text-sm text-white/60">Fair value: {formatUsd(detailCard.fair_value)}</div>
                <div className="text-xs text-white/60">
                  Updated {formatRelative(detailCard.collected_at)} ({formatDate(detailCard.collected_at)})
                </div>
                {(detailCard.confidence_score || detailCard.price_confidence || '').toLowerCase() === 'low' && (
                  <div className="text-amber-200 text-xs flex items-center gap-2">⚠️ Volatile Market</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="text-3xl font-semibold">{formatUsd(detailCard.display_price)}</div>
                {renderConfidence(detailCard.confidence_score || detailCard.price_confidence)}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-black/30 p-3">
                <div className="text-xs text-white/60">Low</div>
                <div className="font-semibold">{formatUsd(detailCard.low_price)}</div>
              </div>
              <div className="rounded-lg bg-black/30 p-3">
                <div className="text-xs text-white/60">Mid</div>
                <div className="font-semibold">{formatUsd(detailCard.mid_price)}</div>
              </div>
              <div className="rounded-lg bg-black/30 p-3">
                <div className="text-xs text-white/60">High</div>
                <div className="font-semibold">{formatUsd(detailCard.high_price)}</div>
              </div>
              <div className="rounded-lg bg-black/30 p-3">
                <div className="text-xs text-white/60">7d / 30d avg</div>
                <div className="font-semibold">
                  {formatUsd(detailCard.avg_7d)} · {formatUsd(detailCard.avg_30d)}
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs text-white/60 mb-1">Price history (last 30 marks)</div>
              {detailLoading ? <div className="text-sm text-white/70">Loading…</div> : renderSparkline(detailHistory)}
              {detailError && <div className="text-sm text-red-400 mt-1">{detailError}</div>}
            </div>
            <div className="text-xs text-white/60">
              Spread: {detailCard.spread_ratio ? `${detailCard.spread_ratio.toFixed(2)}x` : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
