'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { api, fetchVirtualCards, listCard, VirtualCard } from '../../../lib/api';
import { deriveAta } from '../../../lib/ata';
import { buildV0Tx } from '../../../lib/tx';

export default function ProfilePage() {
  const params = useParams();
  const address = params?.address as string;
  const [assets, setAssets] = useState<any[]>([]);
  const [virtualCards, setVirtualCards] = useState<VirtualCard[]>([]);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [recycleStatus, setRecycleStatus] = useState<string | null>(null);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'rarity' | 'name'>('rarity');
  const [filterVirtual, setFilterVirtual] = useState<'all' | 'nft' | 'virtual'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [priceInputs, setPriceInputs] = useState<Record<string, number>>({});
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const mochiMint = useMemo(
    () => new PublicKey(process.env.NEXT_PUBLIC_MOCHI_TOKEN_MINT || '3gqKrJoVx3gUXLHCsNQfpyZAuVagLHQFGtYgbtY3VEsn'),
    []
  );

  useEffect(() => {
    if (!address) return;
    api.get(`/profile/${address}`).then((res) => setAssets(res.data.assets || [])).catch(console.error);
    fetchVirtualCards(address).then(setVirtualCards).catch(() => setVirtualCards([]));
  }, [address]);

  const rarityOrder: Record<string, number> = {
    Common: 0,
    Uncommon: 1,
    Rare: 2,
    DoubleRare: 3,
    UltraRare: 4,
    IllustrationRare: 5,
    SpecialIllustrationRare: 6,
    MegaHyperRare: 7,
    Energy: -1,
  };

  const sortedAssets = useMemo(() => {
    const list = [...assets];
    if (sortKey === 'rarity') {
      list.sort((a, b) => {
        const ra = a.content?.metadata?.attributes?.find((attr: any) => attr.trait_type === 'rarity')?.value || '';
        const rb = b.content?.metadata?.attributes?.find((attr: any) => attr.trait_type === 'rarity')?.value || '';
        return (rarityOrder[ra] ?? 999) - (rarityOrder[rb] ?? 999);
      });
    } else {
      list.sort((a, b) => {
        const na = a.content?.metadata?.name || '';
        const nb = b.content?.metadata?.name || '';
        return na.localeCompare(nb);
      });
    }
    return list;
  }, [assets, sortKey, rarityOrder]);

  const filteredAssets = useMemo(() => {
    return sortedAssets.filter((asset) => {
      const name = (asset.content?.metadata?.name || '').toLowerCase();
      const matchesSearch = searchTerm ? name.includes(searchTerm.toLowerCase()) : true;
      return matchesSearch;
    });
  }, [sortedAssets, searchTerm]);

  const totalVirtual = virtualCards.reduce((sum, v) => sum + v.count, 0);

  const recycleItems = Object.entries(selected)
    .filter(([, cnt]) => cnt > 0)
    .map(([templateId, count]) => {
      const vc = virtualCards.find((v) => v.template_id === Number(templateId));
      return vc ? { template_id: vc.template_id, rarity: vc.rarity, count } : null;
    })
    .filter(Boolean) as { template_id: number; rarity: string; count: number }[];

  const handleRecycle = async () => {
    if (!publicKey || !signTransaction) {
      setRecycleStatus('Connect wallet to recycle.');
      return;
    }
    if (!recycleItems.length) {
      setRecycleStatus('Select at least one virtual card to recycle.');
      return;
    }
    setRecycleLoading(true);
    setRecycleStatus(null);
    try {
      const userAta = await deriveAta(publicKey, mochiMint);
      const { data } = await api.post('/profile/recycle/build', {
        wallet: publicKey.toBase58(),
        items: recycleItems,
        user_token_account: userAta.toBase58(),
      });
      const tx = buildV0Tx(publicKey, data.recent_blockhash, data.instructions);
      const signed = await signTransaction(tx);
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setRecycleStatus(`Recycled! Tx: ${sig}`);
      fetchVirtualCards(publicKey.toBase58()).then(setVirtualCards).catch(() => {});
    } catch (e) {
      console.error('recycle error', e);
      setRecycleStatus('Recycle failed. Check balance and selection.');
    } finally {
      setRecycleLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Profile</h1>
        <p className="text-white/60">{address}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
        <div className="flex items-center gap-2">
          <span>Sort by:</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as any)}
            className="bg-black/40 border border-white/10 rounded-lg px-2 py-1"
          >
            <option value="rarity">Rarity</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span>Search:</span>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-white"
            placeholder="Pokémon name"
          />
        </div>
        <div className="flex items-center gap-2">
          <span>Total virtual:</span>
          <span className="font-semibold text-white">{totalVirtual}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Total NFTs:</span>
          <span className="font-semibold text-white">{filteredAssets.length}</span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filteredAssets.map((asset) => {
          const name = asset.content?.metadata?.name || 'Core asset';
          const image = asset.content?.links?.image || asset.content?.metadata?.image || '';
          return (
            <div key={asset.id} className="card-blur rounded-2xl p-3 border border-white/5 space-y-3">
              <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-white/10 bg-black/20">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt={name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-xs text-white/50">
                    No image
                  </div>
                )}
              </div>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{name}</p>
                <p className="text-xs text-white/60 break-all">{asset.id}</p>
                {publicKey?.toBase58() === address && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={priceInputs[asset.id] ?? ''}
                      onChange={(e) =>
                        setPriceInputs((prev) => ({
                          ...prev,
                          [asset.id]: parseFloat(e.target.value || '0'),
                        }))
                      }
                      className="w-24 px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-xs"
                      placeholder="Price SOL"
                    />
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg bg-aurora text-ink text-xs font-semibold"
                      onClick={async () => {
                        const price = priceInputs[asset.id];
                        if (!price || price <= 0) return;
                        const lamports = Math.floor(price * 1_000_000_000);
                        try {
                          const { data } = await api.post('/marketplace/list/build', {
                            core_asset: asset.id,
                            wallet: address,
                            price_lamports: lamports,
                          });
                          const tx = buildV0Tx(new PublicKey(address), data.recent_blockhash, data.instructions);
                          const signed = signTransaction ? await signTransaction(tx) : tx;
                          const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
                          setRecycleStatus(`Listed ${name} at ${price} SOL. Tx: ${sig}`);
                        } catch (err) {
                          console.error('list error', err);
                          setRecycleStatus('Listing failed. Ensure you own the NFT and try again.');
                        }
                      }}
                    >
                      List
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!assets.length && <p className="text-white/60">No assets found.</p>}
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-white">Virtual cards</p>
            <p className="text-white/60 text-sm">Common/Uncommon/Energy stored off-chain</p>
          </div>
          <button
            type="button"
            onClick={handleRecycle}
            disabled={recycleLoading || !recycleItems.length}
            className="px-4 py-2 rounded-xl bg-aurora text-ink text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recycleLoading ? 'Recycling…' : 'Recycle selected'}
          </button>
        </div>
        {recycleStatus && <p className="text-sm text-white/70">{recycleStatus}</p>}
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {virtualCards.map((vc) => (
            <div key={`${vc.template_id}-${vc.rarity}`} className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm text-white/80">
                <span>{vc.rarity} #{vc.template_id}</span>
                <span className="font-semibold">x{vc.count}</span>
              </div>
              {publicKey?.toBase58() === address && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={vc.count}
                    value={selected[vc.template_id] ?? 0}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        [vc.template_id]: Math.max(0, Math.min(vc.count, parseInt(e.target.value || '0', 10))),
                      }))
                    }
                    className="w-20 px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-sm"
                  />
                  <span className="text-xs text-white/60">to recycle</span>
                </div>
              )}
            </div>
          ))}
          {!virtualCards.length && <p className="text-white/60 text-sm">No virtual cards yet.</p>}
        </div>
        <p className="text-xs text-white/50">10 virtual cards → 1 Mochi token (devnet)</p>
      </div>
    </div>
  );
}
