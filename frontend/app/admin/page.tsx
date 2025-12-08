'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { api, fetchSeedSaleState, SeedSaleState } from '../../lib/api';
import { fetchPricesMock } from '../../lib/api';

type Session = {
  session_id: string;
  user: string;
  rarities: string;
  state: string;
  expires_at: number;
};

type Listing = {
  core_asset: string;
  price_lamports: number;
  status: string;
  currency_mint?: string | null;
  rarity?: string | null;
  template_id?: number | null;
};

const programIdEnv = process.env.NEXT_PUBLIC_PROGRAM_ID;
if (!programIdEnv) {
  throw new Error('NEXT_PUBLIC_PROGRAM_ID must be set for the admin dashboard.');
}

const vaultAuthorityEnv = process.env.NEXT_PUBLIC_VAULT_AUTHORITY;
if (!vaultAuthorityEnv) {
  throw new Error('NEXT_PUBLIC_VAULT_AUTHORITY must be set for the admin dashboard.');
}

const seedSaleProgramId = process.env.NEXT_PUBLIC_SEED_SALE_PROGRAM_ID;
const seedVaultTokenAccount = process.env.NEXT_PUBLIC_SEED_VAULT_TOKEN_ACCOUNT;

const programId: string = programIdEnv;
const VAULT_AUTH: string = vaultAuthorityEnv;
const LOW_STOCK_THRESHOLD = 3;
type KnownWallet = { label: string; address: string };

export default function AdminPage() {
  const tabs = ['overview', 'vault', 'sessions', 'market', 'seed', 'wallets'] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('overview');
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize] = useState(10);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [assets, setAssets] = useState<any[]>([]);
  const [reserved, setReserved] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [seedState, setSeedState] = useState<SeedSaleState | null>(null);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [unreserving, setUnreserving] = useState(false);
  const [forceCloseWallet, setForceCloseWallet] = useState('');
  const [forceClosing, setForceClosing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [pricingMessage, setPricingMessage] = useState<string | null>(null);
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});

  const lowStock = useMemo(
    () =>
      Object.entries(inventory)
        .filter(([_, count]) => Number(count) <= LOW_STOCK_THRESHOLD)
        .map(([rarity, count]) => ({ rarity, count })),
    [inventory],
  );

  const stuckSessions = useMemo(() => {
    const now = Date.now() / 1000;
    return diagnostics.filter((d: any) => d.state === 'pending' && d.expires_at < now);
  }, [diagnostics]);

  const activeListings = useMemo(
    () => listings.filter((l) => (l.status || '').toLowerCase() === 'active'),
    [listings],
  );

  const fetchSessions = useCallback(
    async (targetPage = 1) => {
      try {
        setSessionsLoading(true);
        const res = await api.get('/admin/sessions', { params: { page: targetPage, page_size: sessionPageSize } });
        if (Array.isArray(res.data)) {
          setSessions(res.data);
          setSessionTotal(res.data.length);
          setSessionPage(1);
        } else {
          setSessions(res.data.items || []);
          setSessionTotal(res.data.total || 0);
          setSessionPage(res.data.page || targetPage);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setSessionsLoading(false);
      }
    },
    [sessionPageSize],
  );

  const loadDiagnostics = useCallback(async () => {
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
  }, []);

  const loadSeedState = useCallback(async () => {
    try {
      const res = await fetchSeedSaleState();
      setSeedState(res);
    } catch (err) {
      console.warn('seed state load failed', err);
      setSeedState(null);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    const [invRes, assetsRes, listRes] = await Promise.all([
      api.get('/admin/inventory/rarity'),
      api.get('/admin/inventory/assets'),
      api.get('/marketplace/listings'),
    ]);
    setInventory(invRes.data || {});
    setAssets(assetsRes.data || []);
    setListings(listRes.data || []);
  }, []);

  useEffect(() => {
    bootstrap();
    fetchSessions(1);
    loadDiagnostics();
    loadSeedState();
  }, [bootstrap, fetchSessions, loadDiagnostics, loadSeedState]);

  useEffect(() => {
    const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed');
    async function loadBalances() {
      try {
        const addrs = knownWallets.map((w) => w.address).filter(Boolean) as string[];
        const pubkeys = addrs.map((a) => new PublicKey(a));
        const res = await conn.getMultipleAccountsInfo(pubkeys);
        const map: Record<string, number> = {};
        res.forEach((info, idx) => {
          if (info) {
            map[addrs[idx]] = info.lamports || 0;
          }
        });
        setWalletBalances(map);
      } catch (err) {
        console.error('Failed to load balances', err);
      }
    }
    loadBalances();
  }, []); // run once; knownWallets is static

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await api.post('/admin/inventory/refresh');
      await bootstrap();
      await fetchSessions(sessionPage);
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
        cleared ? `Cleared ${cleared} sessions${signature ? ` • sig ${signature}` : ''}` : 'No pending sessions to clear',
      );
      await fetchSessions(1);
      await loadDiagnostics();
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

  const handleForceClose = async () => {
    if (!forceCloseWallet) {
      setAdminMessage('Enter a wallet address to force-close.');
      return;
    }
    try {
      setForceClosing(true);
      setAdminMessage(null);
      const res = await api.post('/admin/sessions/force_close', { wallet: forceCloseWallet });
      const sig = res.data?.signature;
      setAdminMessage(`Force-closed session for ${forceCloseWallet}${sig ? ` • sig ${sig}` : ''}`);
      await fetchSessions(1);
      await loadDiagnostics();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || 'Force-close failed';
      setAdminMessage(detail);
    } finally {
      setForceClosing(false);
    }
  };

  const totalPages = sessionPageSize ? Math.max(1, Math.ceil((sessionTotal || 0) / sessionPageSize)) : 1;

  const filteredAssets = useMemo(() => {
    const q = search.toLowerCase();
    return assets.filter((a) => {
      if (!q) return true;
      return (
        a.asset_id?.toLowerCase().includes(q) ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.rarity || '').toLowerCase().includes(q)
      );
    });
  }, [assets, search]);

  const activeSessions = sessions.filter((s) => s.state === 'pending');
  const inventoryTotal = Object.values(inventory).reduce((a, b) => a + b, 0) || 0;
  const reservedCount = reserved.length;
  const stuckCount = stuckSessions.length;
  const knownWallets = useMemo(() => {
    const list: KnownWallet[] = [
      { label: 'Treasury / Admin', address: 'CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs' },
      { label: 'Vault authority PDA', address: VAULT_AUTH },
      { label: 'Program (vault)', address: programId },
    ];
    if (seedSaleProgramId) {
      list.push({ label: 'Seed sale PDA', address: seedSaleProgramId });
    }
    if (seedVaultTokenAccount) {
      list.push({ label: 'Seed vault token account', address: seedVaultTokenAccount });
    }
    return list;
  }, [programId, seedSaleProgramId, seedVaultTokenAccount]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div>
          <h1 className="text-3xl font-semibold">Admin dashboard</h1>
          <p className="text-white/60 text-sm">Quick health of vault, sessions, marketplace, seed sale.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-sm"
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh all'}
          </button>
          <button
            type="button"
            onClick={handleForceExpire}
            className="px-3 py-2 rounded-xl bg-sakura/30 border border-sakura/50 text-sm"
            disabled={clearing}
          >
            {clearing ? 'Expiring…' : 'Expire pending'}
          </button>
          <button
            type="button"
            onClick={handleUnreserve}
            className="px-3 py-2 rounded-xl bg-aurora/20 border border-aurora/50 text-sm"
            disabled={unreserving}
          >
            {unreserving ? 'Clearing…' : 'Unreserve all'}
          </button>
          <button
            type="button"
            onClick={async () => {
              setPricingMessage(null);
              try {
                const res = await fetchPricesMock();
                setPricingMessage(`Fetched ${res.snapshots} price snapshots (source: ${res.source}).`);
              } catch (err: any) {
                setPricingMessage(err?.message || 'Price fetch failed.');
              }
            }}
            className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-sm"
            disabled={refreshing}
          >
            Fetch prices (mock)
          </button>
        </div>
      </div>
      {pricingMessage && <p className="text-xs text-white/70">{pricingMessage}</p>}

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className={`px-3 py-2 rounded-xl border text-sm ${
              activeTab === t ? 'bg-aurora/30 border-aurora/60 text-white' : 'bg-white/5 border-white/10 text-white/70'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Vault cards" value={inventoryTotal || '—'} hint="By rarity" />
        <SummaryCard label="Pending sessions" value={activeSessions.length || '—'} hint="Need decision" />
        <SummaryCard label="Stuck sessions" value={stuckCount || '0'} hint="Expired but pending" tone={stuckCount > 0 ? 'warn' : undefined} />
        <SummaryCard label="Active listings" value={activeListings.length || '—'} hint={`Total ${listings.length || 0}`} />
      </div>

      {lowStock.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-semibold mb-1">Low vault stock</div>
          <div className="flex flex-wrap gap-3">
            {lowStock.map((l) => (
              <span key={l.rarity} className="glass-chip glass-chip--tiny">
                {l.rarity}: {l.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'vault') && (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 card-blur rounded-2xl p-4 border border-white/5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm text-white/70">Vault assets</p>
              <p className="text-xs text-white/50 break-all">Authority PDA: {VAULT_AUTH}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold">{assets.length || 0}</p>
              <p className="text-xs text-white/60">NFTs held</p>
            </div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, rarity, or asset id"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
          <div className="grid md:grid-cols-2 gap-2 text-sm max-h-72 overflow-auto">
            {filteredAssets.map((a) => (
              <div key={a.asset_id} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <p className="font-semibold break-all">{a.name || 'Unknown'} • {a.rarity || '—'}</p>
                <p className="text-white/60 text-xs break-all">{a.asset_id}</p>
                <p className="text-white/50 text-xs">Template {a.template_id} • Status {a.status}</p>
              </div>
            ))}
            {!filteredAssets.length && <p className="text-white/60">No assets match your search.</p>}
          </div>
        </div>
        <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/70">Controls</p>
              <p className="text-xs text-white/50">Use with caution.</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <label className="text-xs text-white/60">Force-close wallet</label>
            <div className="flex gap-2">
              <input
                value={forceCloseWallet}
                onChange={(e) => setForceCloseWallet(e.target.value)}
                placeholder="Wallet to force-close session"
                className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={handleForceClose}
                className="px-4 py-2 rounded-xl bg-sakura/20 border border-sakura/50 text-sm"
                disabled={forceClosing}
              >
                {forceClosing ? 'Closing…' : 'Force close'}
              </button>
            </div>
            {adminMessage && <p className="text-xs text-white/60">{adminMessage}</p>}
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-white/60">Reserved/user_owned MintRecords</span>
              <button
                type="button"
                onClick={handleUnreserve}
                className="px-3 py-2 rounded-lg bg-aurora/20 border border-aurora/40 text-xs"
                disabled={unreserving}
              >
                {unreserving ? 'Clearing…' : 'Unreserve all'}
              </button>
            </div>
            <div className="text-xs text-white/60 max-h-32 overflow-auto grid gap-1">
              {reserved.map((asset) => (
                <div key={asset.asset_id} className="p-2 rounded-lg bg-white/5 border border-white/10 space-y-1">
                  <p className="font-mono text-white/80">{asset.asset_id}</p>
                  <p>Template {asset.template_id ?? '—'} • {asset.rarity ?? '—'} • {asset.status}</p>
                </div>
              ))}
              {!reserved.length && <p className="text-white/60">No reserved assets.</p>}
            </div>
          </div>
        </div>
      </div>
      )}

      {(activeTab === 'overview' || activeTab === 'sessions') && (
      <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Sessions</h3>
          <button
            type="button"
            onClick={handleForceExpire}
            className="px-4 py-2 rounded-xl bg-sakura/30 border border-sakura/50 text-sm"
            disabled={clearing}
          >
            {clearing ? 'Clearing…' : 'Force expire pending'}
          </button>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-white/60 mb-2">
          <span>Pending: {activeSessions.length}</span>
          <span>Stuck: {stuckSessions.length}</span>
          <span>Total: {sessionTotal}</span>
        </div>
        <div className="space-y-2 text-sm">
          {sessionsLoading && <p className="text-white/60">Loading sessions…</p>}
          {sessions.map((s) => (
            <div key={s.session_id} className="p-3 rounded-xl bg-white/5 flex justify-between">
              <div>
                <p className="font-semibold">{s.user}</p>
                <p className="text-white/60 break-all text-xs">{s.session_id}</p>
                <p className="text-white/60">Rarities: {s.rarities}</p>
              </div>
              <div className="text-right text-white/70">
                <p className="capitalize">{s.state}</p>
                <p className="text-xs">expires {new Date(s.expires_at * 1000).toLocaleTimeString()}</p>
              </div>
            </div>
          ))}
          {!sessionsLoading && !sessions.length && <p className="text-white/60">No sessions.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between text-xs text-white/70 mt-3 gap-2">
          <span>
            Page {sessionPage} / {totalPages} • {sessionTotal} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fetchSessions(Math.max(1, sessionPage - 1))}
              className="px-3 py-1 rounded-lg border border-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={sessionPage <= 1 || sessionsLoading}
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => fetchSessions(Math.min(totalPages, sessionPage + 1))}
              className="px-3 py-1 rounded-lg border border-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={sessionPage >= totalPages || sessionsLoading}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
      )}

      {(activeTab === 'overview' || activeTab === 'sessions') && (
      <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/70">Session diagnostics</p>
            <p className="text-xs text-white/50">On-chain PackSession + CardRecord states.</p>
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
      )}

      {(activeTab === 'overview' || activeTab === 'market' || activeTab === 'seed') && (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Marketplace</h3>
            <span className="text-xs text-white/60">{activeListings.length} active</span>
          </div>
          <div className="grid gap-2 text-sm max-h-64 overflow-auto">
            {activeListings.slice(0, 8).map((l) => (
              <div key={l.core_asset} className="p-2 rounded-lg bg-white/5 border border-white/10 flex justify-between">
                <div>
                  <p className="font-semibold text-white/90">{l.rarity || '—'} • {l.template_id ?? '—'}</p>
                  <p className="text-xs text-white/60 break-all">{l.core_asset}</p>
                </div>
                <div className="text-right text-xs text-white/70">
                  <p>{(l.price_lamports / 1_000_000_000).toFixed(2)} SOL</p>
                  <p>{l.status}</p>
                </div>
              </div>
            ))}
            {!activeListings.length && <p className="text-white/60 text-sm">No active listings.</p>}
          </div>
        </div>
        <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Seed sale</h3>
            <button
              type="button"
              onClick={loadSeedState}
              className="px-3 py-1 rounded-lg bg-white/10 border border-white/10 text-xs"
            >
              Refresh
            </button>
          </div>
          {seedState ? (
            <div className="text-sm text-white/80 space-y-1">
              <p>Raised: {(seedState.raised_lamports / 1_000_000_000).toFixed(2)} SOL</p>
              <p>
                Sold: {(seedState.sold_tokens / 10 ** (seedState.token_decimals || 0)).toFixed(2)} /{' '}
                {seedState.token_cap / 10 ** (seedState.token_decimals || 0)}
              </p>
              <p>Contributors: {seedState.contributor_count ?? '—'}</p>
              <p>Ends: {new Date(seedState.end_ts * 1000).toLocaleString()}</p>
            </div>
          ) : (
            <p className="text-white/60 text-sm">Seed sale state unavailable.</p>
          )}
        </div>
      </div>
      )}

      {activeTab === 'wallets' && (
        <div className="card-blur rounded-2xl p-4 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Key wallets (SOL balances)</h3>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1 rounded-lg bg-white/10 border border-white/10 text-xs"
            >
              Refresh
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-2 text-sm">
            {knownWallets.map((w) => (
              <div key={w.address} className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1">
                <p className="font-semibold text-white">{w.label}</p>
                <p className="text-xs text-white/60 break-all">{w.address}</p>
                <p className="text-xs text-white/70">
                  {(walletBalances[w.address] ?? 0) / 1_000_000_000} SOL
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'warn' }) {
  const bg = tone === 'warn' ? 'bg-amber-500/10 border-amber-500/40' : 'bg-white/5 border-white/10';
  return (
    <div className={`p-4 rounded-2xl ${bg}`}>
      <p className="text-xs uppercase text-white/60">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {hint && <p className="text-white/60 text-sm">{hint}</p>}
    </div>
  );
}
