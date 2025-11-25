'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api } from '../../lib/api';

export default function AdminPage() {
  const { publicKey } = useWallet();
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [sessions, setSessions] = useState<any[]>([]);
  const adminAddress = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;

  useEffect(() => {
    if (!publicKey || publicKey.toBase58() !== adminAddress) return;
    api.get('/admin/inventory/rarity').then((res) => setInventory(res.data));
    api.get('/admin/sessions').then((res) => setSessions(res.data));
  }, [publicKey, adminAddress]);

  if (!publicKey || publicKey.toBase58() !== adminAddress) {
    return <p className="text-white/60">Admin only.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Admin dashboard</h1>
        <p className="text-white/60">Vault inventory, active sessions, listings.</p>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5">
        <h3 className="font-semibold mb-2">Inventory</h3>
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          {Object.entries(inventory).map(([rarity, count]) => (
            <div key={rarity} className="p-3 rounded-xl bg-white/5 flex justify-between">
              <span>{rarity}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card-blur rounded-2xl p-4 border border-white/5">
        <h3 className="font-semibold mb-2">Sessions</h3>
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
    </div>
  );
}
