'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchPriceAnalytics, PriceAnalyticsRow } from '../../lib/api';

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const formatUsd = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return usdFormatter.format(value);
};
const GOOD_HIT_THRESHOLD = 5;
const PSA10_MULTIPLIER = 2.5;
const PSA9_MULTIPLIER = 1.7;
const estimateGrades = (price?: number | null) => {
  if (price === null || price === undefined || price <= 0) return null;
  return {
    psa10: price * PSA10_MULTIPLIER,
    psa9: price * PSA9_MULTIPLIER,
  };
};

const formatChange = (value?: number | null) => {
  if (value === null || value === undefined) return '—';
  const rounded = value.toFixed(2);
  if (value > 0) return `+${rounded}%`;
  if (value < 0) return `${rounded}%`;
  return '0.00%';
};

const computeSparklineBars = (points?: number[]) => {
  if (!points || points.length === 0) return [];
  const cleaned = points.filter((p) => Number.isFinite(p) && p > 0);
  if (!cleaned.length) return [];
  const max = Math.max(...cleaned);
  return cleaned.map((p, idx) => ({
    key: `${idx}-${p}`,
    height: Math.max(6, (p / max) * 32),
  }));
};

export default function AnalyticsPage() {
  const [rows, setRows] = useState<PriceAnalyticsRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPriceAnalytics();
        setRows(data);
      } catch (e) {
        setError('Could not load price analytics. Please retry.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const enriched = useMemo(() => {
    return rows.map((row) => {
      const grade = estimateGrades(row.current_price ?? null);
      const sparkBars = computeSparklineBars(row.sparkline);
      const trend = (() => {
        if (!row.sparkline || row.sparkline.length < 2) return null;
        const first = row.sparkline[0];
        const last = row.sparkline[row.sparkline.length - 1];
        if (!first || !last) return null;
        const pct = ((last - first) / first) * 100;
        return pct;
      })();
      const priceVal = row.current_price ?? 0;
      return {
        ...row,
        grade,
        sparkBars,
        trend,
        goodHit: priceVal >= GOOD_HIT_THRESHOLD,
      };
    });
  }, [rows]);

  const totalValue = useMemo(() => enriched.reduce((sum, row) => sum + (row.current_price || 0), 0), [enriched]);

  return (
    <div className="space-y-6">
      <div className="card-blur rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase text-white/60 tracking-[0.2em]">Price oracle</p>
          <p className="text-2xl font-semibold text-white">Analytics dashboard</p>
          <p className="text-sm text-white/60">Live market pulls from PokemonPriceTracker with heuristic PSA grades.</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase text-white/60">Portfolio value (all templates)</p>
          <p className="text-xl font-semibold text-white">{formatUsd(totalValue) || '$0.00'}</p>
          <p className="text-xs text-white/60">Cards tracked: {enriched.length}</p>
        </div>
      </div>

      <div className="card-blur rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="grid grid-cols-[80px,1fr,120px,120px,160px] max-md:hidden text-[11px] uppercase text-white/60 gap-3 px-2">
          <span>Card</span>
          <span>Details</span>
          <span>Current</span>
          <span>24h</span>
          <span>Trend</span>
        </div>
        {loading && <div className="text-white/70 text-sm px-2">Loading analytics…</div>}
        {error && <div className="text-amber-300 text-sm px-2">{error}</div>}
        {!loading && !error && (
          <div className="space-y-3">
            {enriched.map((row) => {
              const priceLabel = formatUsd(row.current_price ?? null) || '—';
              const changeLabel = formatChange(row.change_24h ?? row.trend ?? null);
              return (
                <div
                  key={row.template_id}
                  className="grid max-md:grid-cols-1 grid-cols-[80px,1fr,120px,120px,160px] gap-3 items-center rounded-xl border border-white/10 bg-white/5 p-3"
                >
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={row.image_url || '/card_back.png'}
                      alt={row.name}
                      className="h-16 w-12 rounded-lg object-contain bg-black/30 border border-white/10"
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate">{row.name}</p>
                      {row.goodHit && <span className="text-[10px] px-2 py-1 rounded-full bg-aurora/30 text-white whitespace-nowrap">Good hit</span>}
                    </div>
                    <p className="text-xs text-white/60 truncate">{row.set_name || 'Unknown set'} · {row.rarity || '—'}</p>
                    {row.grade && row.current_price ? (
                      <p className="text-xs text-white/60">
                        PSA9 ~{formatUsd(row.grade.psa9)} · PSA10 ~{formatUsd(row.grade.psa10)}
                      </p>
                    ) : (
                      <p className="text-xs text-white/50">PSA estimates available once a price is set.</p>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-white">{priceLabel}</div>
                  <div className={`text-sm font-semibold ${row.change_24h && row.change_24h > 0 ? 'text-aurora' : row.change_24h && row.change_24h < 0 ? 'text-red-300' : 'text-white/80'}`}>
                    {changeLabel}
                  </div>
                  <div className="flex items-end gap-1 h-12">
                    {row.sparkBars && row.sparkBars.length > 0 ? (
                      row.sparkBars.map((bar) => (
                        <span
                          key={bar.key}
                          className="flex-1 bg-gradient-to-t from-white/20 to-aurora/60 rounded-full"
                          style={{ height: `${bar.height}px` }}
                        />
                      ))
                    ) : (
                      <span className="text-xs text-white/50">No trend yet</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
