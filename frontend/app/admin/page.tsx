'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function AdminPage() {
  const vaultAuthority = 'FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g';
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [sessions, setSessions] = useState<any[]>([]);
  const [vaultAssets, setVaultAssets] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [galleryAssets, setGalleryAssets] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [clearing, setClearing] = useState(false);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [reserved, setReserved] = useState<any[]>([]);
  const [diagLoading, setDiagLoading] = useState(false);
  const [unreserving, setUnreserving] = useState(false);

  const loadDiagnostics = async () => {
    try {
      setDiagLoading(true);
      const [diagRes, reservedRes] = await Promise.all([
        api.get('/admin/sessions/diagnostic'),
        api.get('/admin/inventory/reserved'),
      ]);
      setDiagnostics(diagRes.data);
      setReserved(reservedRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setDiagLoading(false);
    }
  };

  useEffect(() => {
    api.get('/admin/inventory/rarity').then((res) => setInventory(res.data));
    api.get('/admin/sessions').then((res) => setSessions(res.data));
    api.get('/admin/inventory/assets').then((res) => {
      setAssets(res.data);
      setVaultAssets(res.data.map((a: any) => a.asset_id));
    });
    api.get(`/profile/${vaultAuthority}`).then((res) => setGalleryAssets(res.data.assets || []));
    loadDiagnostics();
  }, []);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      const res = await api.post('/admin/inventory/refresh');
      const assets: string[] = res.data?.updated || [];
      setVaultAssets(assets);
      const inv = await api.get('/admin/inventory/rarity');
      setInventory(inv.data);
      const assetsRes = await api.get('/admin/inventory/assets');
      setAssets(assetsRes.data);
      const sessionsRes = await api.get('/admin/sessions');
      setSessions(sessionsRes.data);
      await loadDiagnostics();
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  const handleForceExpire = async () => {
    try {
      setClearing(true);
      setAdminMessage(null);
      const res = await api.post('/admin/sessions/force_expire');
      const { cleared, signature } = res.data;
      setAdminMessage(
        cleared
          ? `Cleared ${cleared} sessions${signature ? ` • sig ${signature}` : ''}`
          : 'No pending sessions to clear'
      );
      await handleRefresh();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || 'Force expire failed';
      setAdminMessage(detail);
    } finally {
      setClearing(false);
    }
  };

  const handleUnreserve = async () => {
    try {
      setUnreserving(true);
      setAdminMessage(null);
      await api.post('/admin/inventory/unreserve', {});
      await handleRefresh();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || 'Unreserve failed';
      setAdminMessage(detail);
    } finally {
      setUnreserving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Admin dashboard</h1>
        <p className="text-white/60">Vault inventory, active sessions, listings.</p>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <p className="text-xs uppercase text-white/60">Vault inventory</p>
          <p className="text-2xl font-semibold mt-1">
            {Object.values(inventory).reduce((a, b) => a + b, 0) || '—'}
          </p>
          <p className="text-white/60 text-sm">By rarity (live from backend)</p>
        </div>
        <div className="p-4 rounded-2xl bg-aurora/15 border border-white/10">
          <p className="text-xs uppercase text-white/60">Active sessions</p>
          <p className="text-2xl font-semibold mt-1">{sessions.length || '—'}</p>
          <p className="text-white/60 text-sm">Pending decisions</p>
        </div>
        <div className="p-4 rounded-2xl bg-sakura/15 border border-white/10">
          <p className="text-xs uppercase text-white/60">Actions</p>
          <p className="text-white/70 text-sm">Refresh vault / settle sessions</p>
        </div>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/70">Vault assets</p>
            <p className="text-xs text-white/50 break-all">Authority PDA: FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">{assets.length || 0}</p>
            <p className="text-xs text-white/60">NFTs held</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, rarity, or asset id"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
          <button
            type="button"
            onClick={handleRefresh}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm"
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh vault'}
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-2 text-sm max-h-72 overflow-auto">
          {assets
            .filter((a) => {
              const q = search.toLowerCase();
              return (
                !q ||
                a.asset_id.toLowerCase().includes(q) ||
                (a.name || '').toLowerCase().includes(q) ||
                (a.rarity || '').toLowerCase().includes(q)
              );
            })
            .map((a) => (
              <div key={a.asset_id} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <p className="font-semibold break-all">{a.name || 'Unknown'} • {a.rarity || '—'}</p>
                <p className="text-white/60 text-xs break-all">{a.asset_id}</p>
                <p className="text-white/50 text-xs">Template {a.template_id} • Status {a.status}</p>
              </div>
            ))}
          {!assets.length && <p className="text-white/60">Run refresh to load vault assets.</p>}
        </div>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/70">Session diagnostics</p>
            <p className="text-xs text-white/50">Shows whether PackSession PDAs exist and the status of each reserved card.</p>
          </div>
          <button
            type="button"
            onClick={loadDiagnostics}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm"
            disabled={diagLoading}
          >
            {diagLoading ? 'Refreshing…' : 'Refresh diagnostics'}
          </button>
        </div>
        <div className="space-y-3 text-xs text-white/70 max-h-80 overflow-auto">
          {diagnostics.map((diag) => (
            <div key={diag.session_id} className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">{diag.session_id.slice(0, 12)}…</p>
                  <p>User: {diag.user}</p>
                </div>
                <div className="text-right">
                  <p className="text-white/80">{diag.state}</p>
                  <p>PackSession on-chain: {diag.has_pack_session ? 'yes' : 'no'}</p>
                  <p>Expires at {new Date(diag.expires_at * 1000).toLocaleTimeString()}</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-2">
                {diag.asset_statuses.map((asset: any) => (
                  <div
                    key={`${diag.session_id}-${asset.asset_id}`}
                    className={`p-2 rounded-lg border ${
                      asset.status === 'available' ? 'border-white/10' : 'border-sakura/60 bg-sakura/10'
                    }`}
                  >
                    <p className="font-mono text-white/80">{asset.asset_id.slice(0, 8)}…</p>
                    <p>Template {asset.template_id ?? '—'} • {asset.rarity ?? '—'}</p>
                    <p>Status: <span className="font-semibold">{asset.status}</span></p>
                    <p>Owner: {asset.owner || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!diagnostics.length && <p className="text-white/60">No session diagnostics yet.</p>}
        </div>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/70">Reserved assets</p>
            <p className="text-xs text-white/50">MintRecords still marked as reserved/user_owned.</p>
          </div>
          <button
            type="button"
            onClick={loadDiagnostics}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm"
            disabled={diagLoading}
          >
            {diagLoading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-white/60">MintRecords still flagged as reserved/user_owned.</div>
          <button
            type="button"
            onClick={handleUnreserve}
            className="px-4 py-2 rounded-xl bg-sakura/30 border border-sakura/50 text-sm"
            disabled={unreserving}
          >
            {unreserving ? 'Clearing…' : 'Unreserve all'}
          </button>
        </div>
        <div className="text-xs text-white/60 max-h-56 overflow-auto grid md:grid-cols-2 gap-2">
          {reserved.map((asset) => (
            <div key={asset.asset_id} className="p-2 rounded-lg bg-white/5 border border-white/10 space-y-1">
              <p className="font-mono text-white/80">{asset.asset_id}</p>
              <p>Template {asset.template_id ?? '—'} • {asset.rarity ?? '—'}</p>
              <p>Status: <span className="font-semibold">{asset.status}</span></p>
              <p>Owner: {asset.owner || '—'}</p>
            </div>
          ))}
          {!reserved.length && <p className="text-white/60">No reserved assets.</p>}
        </div>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5">
        <h3 className="font-semibold mb-2">Inventory by rarity</h3>
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          {Object.entries(inventory).map(([rarity, count]) => (
            <div key={rarity} className="p-3 rounded-xl bg-white/5 flex justify-between">
              <span>{rarity}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
          {!Object.keys(inventory).length && <p className="text-white/60">No data yet.</p>}
        </div>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Sessions</h3>
          <button
            type="button"
            onClick={handleForceExpire}
            className="px-4 py-2 rounded-xl bg-sakura/30 border border-sakura/50 text-sm"
            disabled={clearing}
          >
            {clearing ? 'Clearing…' : 'Force expire all'}
          </button>
        </div>
        {adminMessage && <p className="text-xs text-white/70 mb-2">{adminMessage}</p>}
        <div className="space-y-2 text-sm">
          {sessions.map((s) => (
            <div key={s.session_id} className="p-3 rounded-xl bg-white/5 flex justify-between">
              <div>
                <p className="font-semibold">{s.user}</p>
                <p className="text-white/60">Rarities: {s.rarities}</p>
              </div>
              <div className="text-right text-white/70">
                <p>{s.state}</p>
                <p className="text-xs">expires at {new Date(s.expires_at * 1000).toLocaleTimeString()}</p>
              </div>
            </div>
          ))}
          {!sessions.length && <p className="text-white/60">No sessions.</p>}
        </div>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/70">Vault assets (Helius)</p>
            <p className="text-xs text-white/50">Refresh pulls current vault PDA holdings via Helius.</p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm"
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh vault'}
          </button>
        </div>
        <div className="text-xs text-white/60">
          Showing latest {vaultAssets.length || 0} asset ids. Full list stored in backend.
        </div>
        <div className="grid md:grid-cols-2 gap-2 text-sm max-h-64 overflow-auto">
          {vaultAssets.map((id) => (
            <div key={id} className="p-3 rounded-xl bg-white/5 border border-white/5 break-all">
              {id}
            </div>
          ))}
          {!vaultAssets.length && <p className="text-white/60">Run refresh to load vault assets.</p>}
        </div>
      </div>

      <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/70">Vault asset gallery</p>
            <p className="text-xs text-white/50">Preview on-chain art pulled via Helius (no local fallback).</p>
          </div>
          <p className="text-xs text-white/60">{galleryAssets.length || 0} items</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {galleryAssets.map((a) => {
            const image = a?.content?.links?.image || a?.content?.metadata?.image || '';
            const name = a?.content?.metadata?.name || 'Core asset';
            return (
              <div key={a.id} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
                <div className="relative aspect-[3/4] rounded-lg overflow-hidden border border-white/10 bg-black/20">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt={name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-xs text-white/50">
                      No image
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                    <p className="text-xs text-white/80">{a.rarity || a.content?.metadata?.attributes?.find?.((attr: any) => attr.trait_type === 'Rarity')?.value || '—'}</p>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-white/70">
                  <p className="font-semibold text-sm text-white">{name}</p>
                  <p className="break-all text-white/60">{a.id}</p>
                </div>
              </div>
            );
          })}
          {!galleryAssets.length && <p className="text-white/60">No assets to display.</p>}
        </div>
      </div>
    </div>
  );
}
