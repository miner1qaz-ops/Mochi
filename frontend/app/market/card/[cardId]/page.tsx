'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  fetchMarketCard,
  type MarketCardDetail,
  type MarketCardListing,
  listCard,
  fillListing,
} from '../../../../lib/api';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { buildV0Tx } from '../../../../lib/tx';
import { resolveCardArtSync } from '../../../../lib/resolveCardArt';

const formatUsd = (v?: number | null) =>
  v || v === 0 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const formatSolFromLamports = (lamports?: number) =>
  lamports || lamports === 0 ? `${(lamports / 1_000_000_000).toFixed(4)} SOL` : '—';
const formatChange = (v?: number | null) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const formatDate = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleDateString() : '—');

function StatPill({ label, value, subtle }: { label: string; value: string; subtle?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wide text-white/60">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${subtle ? 'text-white/80' : ''}`}>{value}</div>
    </div>
  );
}

function HistoryChart({ history }: { history: MarketCardDetail['history'] }) {
  if (!history?.length) return <div className="text-sm text-white/60">No history</div>;
  const sorted = [...history].sort((a, b) => a.collected_at - b.collected_at);
  const values = sorted.map((p) => p.fair_value ?? p.mid_price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = values[values.length - 1];
  const range = max - min || 1;
  const width = 660;
  const height = 260;
  const paddingLeft = 60;
  const paddingTop = 10;
  const paddingBottom = 24;
  const plotWidth = width - paddingLeft - 10;
  const plotHeight = height - paddingTop - paddingBottom;
  const coords = sorted.map((p, i) => {
    const x = paddingLeft + (i / Math.max(1, sorted.length - 1)) * plotWidth;
    const val = values[i];
    const y = paddingTop + plotHeight - ((val - min) / range) * plotHeight;
    return `${x},${y}`;
  });
  const rising = values[values.length - 1] - values[0] >= 0;
  const stroke = rising ? '#34d399' : '#f87171';
  const fillPoints = [
    `${paddingLeft},${paddingTop + plotHeight}`,
    ...coords,
    `${paddingLeft + plotWidth},${paddingTop + plotHeight}`,
  ].join(' ');
  const startDate = new Date(sorted[0].collected_at * 1000).toLocaleDateString();
  const endDate = new Date(sorted[sorted.length - 1].collected_at * 1000).toLocaleDateString();
  const ticks = [max, (min + max) / 2, min];

  return (
    <div className="w-full space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64">
        {/* Y-axis labels and grid */}
        {ticks.map((v, idx) => {
          const y = paddingTop + plotHeight - ((v - min) / range) * plotHeight;
          return (
            <g key={idx}>
              <line x1={paddingLeft} x2={paddingLeft + plotWidth} y1={y} y2={y} stroke="rgba(255,255,255,0.1)" />
              <text x={paddingLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill="rgba(255,255,255,0.6)">
                ${v.toFixed(2)}
              </text>
            </g>
          );
        })}
        {/* Area + line */}
        <polyline fill={`${stroke}22`} stroke="none" points={fillPoints} />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          points={coords.join(' ')}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Last price label */}
        <text x={paddingLeft + plotWidth} y={paddingTop + 12} textAnchor="end" fontSize="11" fill="rgba(255,255,255,0.8)">
          Last: ${last.toFixed(2)}
        </text>
      </svg>
      <div className="flex justify-between text-[11px] text-white/60 px-1">
        <span>{startDate}</span>
        <span>{endDate}</span>
      </div>
    </div>
  );
}

export default function CardMarketPage() {
  const params = useParams();
  const templateId = Number(params?.cardId);
  const [card, setCard] = useState<MarketCardDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [listPrice, setListPrice] = useState<number | ''>('');
  const [busyListing, setBusyListing] = useState(false);
  const [busyBuying, setBusyBuying] = useState<string | null>(null);
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [rangeDays, setRangeDays] = useState<30 | 90 | 180 | 'max'>(180);

  const loadCard = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMarketCard(templateId, { wallet: publicKey?.toBase58() });
      setCard(data);
      if (data.fair_price && !listPrice) {
        setListPrice(Number(data.fair_price.toFixed(2)));
      }
    } catch (e) {
      console.error(e);
      setError('Failed to load card.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!Number.isFinite(templateId)) return;
    loadCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, publicKey]);

  const canList = !!(publicKey && card?.my_assets?.length);
  const primaryAsset = card?.my_assets?.[0];
  const historyFiltered = useMemo(() => {
    if (!card?.history?.length) return [];
    const sorted = [...card.history].sort((a, b) => a.collected_at - b.collected_at);
    if (rangeDays === 'max') return sorted;
    const lastTs = sorted[sorted.length - 1]?.collected_at || 0;
    const cutoff = lastTs - rangeDays * 24 * 60 * 60;
    return sorted.filter((p) => p.collected_at >= cutoff);
  }, [card?.history, rangeDays]);
  const lastUpdated = card?.history?.[card.history.length - 1]?.collected_at;

  const handleBuy = async (listing: MarketCardListing) => {
    if (!publicKey) {
      setError('Connect wallet to buy.');
      return;
    }
    try {
      setSuccess(null);
      setBusyBuying(listing.core_asset);
      const res = await fillListing(listing.core_asset, publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(sig, 'confirmed');
      setBusyBuying(null);
      setSuccess('Purchase successful! The NFT is now in your wallet.');
      loadCard();
    } catch (e) {
      console.error(e);
      setError('Buy failed.');
      setBusyBuying(null);
    }
  };

  const handleList = async () => {
    if (!publicKey || !primaryAsset || !listPrice || listPrice <= 0) {
      setError('Connect wallet and enter a price.');
      return;
    }
    try {
      setBusyListing(true);
      const lamports = Math.floor(Number(listPrice) * 1_000_000_000);
      const res = await listCard(primaryAsset, publicKey.toBase58(), lamports);
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(sig, 'confirmed');
      setBusyListing(false);
      loadCard();
    } catch (e) {
      console.error(e);
      setError('Listing failed.');
      setBusyListing(false);
    }
  };

  if (loading && !card) return <p className="text-white/70">Loading…</p>;
  if (error && !card) return <p className="text-red-400 text-sm">{error}</p>;
  if (!card) return null;

  const hasListings = card.listings?.length > 0;
  const hasHistory = historyFiltered.length > 0;
  const showListForm = canList;
  const hasLeftColumn = hasListings || showListForm;
  const packHint = card.template_id && card.template_id >= 2000 ? 'phantasmal_flames' : 'meg_web';
  const imageSrc =
    resolveCardArtSync({
      packType: packHint,
      setCode: packHint,
      templateId: card.template_id ?? null,
      imageUrl: card.image_url ?? null,
    }) || '/card_back.png';

  return (
    <div className="space-y-8">
      {success && <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{success}</div>}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-black/50 via-black/40 to-slate-900/40 p-6 space-y-6">
        <div className="grid lg:grid-cols-[320px,1fr] gap-6">
          <div className="rounded-2xl bg-black/30 border border-white/10 p-3 flex flex-col items-center">
            <img
              src={imageSrc}
              alt={card.name}
              className="w-full max-w-[280px] rounded-xl border border-white/10 bg-white/5 object-contain"
            />
            <div className="mt-3 w-full text-sm text-white/60 flex items-center justify-between">
              <span>{card.set_name || 'Unknown set'}</span>
              <span>{card.rarity || '—'}</span>
            </div>
          </div>

          <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/60">Card</p>
                <h1 className="text-3xl font-semibold">{card.name}</h1>
                <p className="text-sm text-white/60">ID: {card.template_id} · {card.set_name || 'Unknown set'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  {card.listing_count > 0 ? `${card.listing_count} listing${card.listing_count === 1 ? '' : 's'}` : 'No listings'}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  Confidence: {card.confidence || '—'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatPill label="Mochi fair price" value={formatUsd(card.fair_price ?? undefined)} />
              <StatPill
                label="Lowest listing"
                value={card.lowest_listing ? formatSolFromLamports(card.lowest_listing) : 'No listing'}
              />
              <StatPill label="Listings" value={card.listing_count.toString()} subtle />
              <StatPill label="Last updated" value={formatDate(lastUpdated)} subtle />
            </div>
            <div className="text-xs text-white/60">
              Price source: PokemonPriceTracker (TCGplayer market, Near Mint)
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatPill label="24h change" value={formatChange(card.change_24h)} subtle />
              <StatPill label="7d change" value={formatChange(card.change_7d)} subtle />
              <StatPill label="30d change" value={formatChange(card.change_30d)} subtle />
            </div>

            {hasHistory && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-semibold">Price history</div>
                    <div className="text-xs text-white/60">Sparkline powered by Mochi price oracle</div>
                  </div>
                  <div className="flex gap-2">
                    {[30, 90, 180, 'max'].map((r) => (
                      <button
                        key={r}
                        onClick={() => setRangeDays(r as typeof rangeDays)}
                        className={`px-3 py-1.5 rounded-lg text-xs border ${
                          rangeDays === r ? 'border-sakura bg-sakura/20 text-white' : 'border-white/10 bg-black/20 text-white/70'
                        }`}
                      >
                        {r === 'max' ? 'Max' : `${r}D`}
                      </button>
                    ))}
                  </div>
                </div>
                <HistoryChart history={historyFiltered} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={hasLeftColumn ? 'grid lg:grid-cols-[1.2fr,0.8fr] gap-6' : 'grid gap-6'}>
        {hasLeftColumn && (
          <div className="space-y-4">
            {hasListings && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Listings on Mochi</h2>
                  <span className="text-sm text-white/60">{card.listing_count} active</span>
                </div>
                <div className="space-y-2">
              {card.listings.map((l) => (
                <div key={l.core_asset} className="rounded-xl border border-white/10 bg-gradient-to-r from-white/5 to-black/10 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{formatSolFromLamports(l.price_lamports)}</div>
                    <div className="text-xs text-white/60 flex items-center gap-2">
                      <span>Seller: {l.seller || 'unknown'}</span>
                      {l.is_fake && (
                        <span className="px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-400/50 text-rose-100 text-[10px] uppercase tracking-wide">
                          Unverified
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    disabled={busyBuying === l.core_asset || !publicKey}
                    onClick={() => handleBuy(l)}
                    className="px-4 py-2 rounded-lg bg-sakura text-ink text-sm disabled:opacity-50"
                      >
                        {busyBuying === l.core_asset ? 'Buying…' : 'Buy'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showListForm && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">List your card</div>
                    <div className="text-xs text-white/60">Suggested: {formatUsd(card.fair_price ?? undefined)}</div>
                  </div>
                  <span className="text-[11px] px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-white/70">Owner tools</span>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    step="0.01"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-32 rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm"
                    placeholder="Price in SOL"
                  />
                  <button
                    onClick={handleList}
                    disabled={busyListing}
                    className="px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-sm"
                  >
                    {busyListing ? 'Listing…' : 'List'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Price insights</h2>
              <div className="text-sm text-white/60">Last mark {formatDate(lastUpdated)}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatPill label="Fair value" value={formatUsd(card.fair_price ?? undefined)} />
              <StatPill
                label="Lowest listing"
                value={card.lowest_listing ? formatSolFromLamports(card.lowest_listing) : 'No listing'}
                subtle
              />
              <StatPill label="Confidence" value={card.confidence || '—'} subtle />
              <StatPill label="Listings" value={card.listing_count.toString()} subtle />
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 p-3 space-y-2">
              <div className="text-xs text-white/60">Change</div>
              <div className="flex gap-3 text-sm">
                <span>24h: {formatChange(card.change_24h)}</span>
                <span>7d: {formatChange(card.change_7d)}</span>
                <span>30d: {formatChange(card.change_30d)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}
    </div>
  );
}
