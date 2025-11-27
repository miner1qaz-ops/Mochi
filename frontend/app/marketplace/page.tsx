'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api, cancelListing, fillListing, listCard } from '../../lib/api';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { buildV0Tx } from '../../lib/tx';
import { deriveAta } from '../../lib/ata';
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');

interface Listing {
  core_asset: string;
  price_lamports: number;
  seller?: string;
  status: string;
  currency_mint?: string | null;
}

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');
  const [coreAssetInput, setCoreAssetInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [useUsdc, setUseUsdc] = useState(false);
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

  const fetchListings = () => {
    api
      .get('/marketplace/listings')
      .then((res) => setListings(res.data))
      .catch(console.error);
  };

  useEffect(() => {
    fetchListings();
  }, []);

  const handleList = async () => {
    if (!publicKey) {
      setMessage('Connect wallet to list');
      return;
    }
    if (!coreAssetInput || !priceInput) {
      setMessage('Enter asset and price');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      let userToken: string | undefined;
      let vaultToken: string | undefined;
      let currencyMint: string | undefined;
      if (useUsdc) {
        if (!usdcMint) throw new Error('USDC mint not set');
        const userAta = await deriveAta(publicKey, usdcMint);
        const vaultAta = await deriveAta(vaultAuthority, usdcMint);
        userToken = userAta.toBase58();
        vaultToken = vaultAta.toBase58();
        currencyMint = usdcMint.toBase58();
      }
      const res = await listCard(coreAssetInput, publicKey.toBase58(), Number(priceInput), currencyMint);
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setMessage(`Listed with tx: ${sig}`);
      fetchListings();
    } catch (e: any) {
      setMessage(e?.message || 'List failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFill = async (asset: string) => {
    if (!publicKey) {
      setMessage('Connect wallet to buy');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fillListing(asset, publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setMessage(`Purchased with tx: ${sig}`);
      fetchListings();
    } catch (e: any) {
      setMessage(e?.message || 'Buy failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (asset: string) => {
    if (!publicKey) {
      setMessage('Connect wallet to cancel');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await cancelListing(asset, publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setMessage(`Cancelled with tx: ${sig}`);
      fetchListings();
    } catch (e: any) {
      setMessage(e?.message || 'Cancel failed');
    } finally {
      setLoading(false);
    }
  };

  const filteredListings = listings.filter((l) => {
    const matchesText =
      !filter ||
      l.core_asset.toLowerCase().includes(filter.toLowerCase()) ||
      (l.seller || '').toLowerCase().includes(filter.toLowerCase());
    const matchesRarity = !rarityFilter || (l.status && l.status.toLowerCase().includes(rarityFilter.toLowerCase()));
    return matchesText && matchesRarity;
  });

  const featured = filteredListings[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Marketplace</h1>
          <p className="text-white/60">Core assets listed with 2% platform fee. SOL or USDC supported.</p>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-blur rounded-2xl p-4 border border-white/10 space-y-3">
          <p className="text-sm text-white/70">List a Core asset</p>
          <div className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={useUsdc} onChange={(e) => setUseUsdc(e.target.checked)} />
            <span>List in USDC (pass currency mint)</span>
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              value={coreAssetInput}
              onChange={(e) => setCoreAssetInput(e.target.value)}
              placeholder="Core asset pubkey"
              className="flex-1 px-4 py-2 rounded-xl bg-white/5 border border-white/10"
            />
            <input
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder="Price (lamports)"
              className="w-48 px-4 py-2 rounded-xl bg-white/5 border border-white/10"
            />
            <button
              onClick={handleList}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-sakura text-ink font-semibold disabled:opacity-50"
            >
              {loading ? 'Listing...' : 'List'}
            </button>
          </div>
          {message && <p className="text-xs text-white/60">{message}</p>}
        </div>
        <div className="card-blur rounded-2xl p-4 border border-white/10 space-y-3">
          <p className="text-sm text-white/70">Featured</p>
          {featured ? (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <p className="text-xs text-white/50">Asset</p>
              <p className="font-semibold break-all">{featured.core_asset}</p>
              <div className="flex gap-2 items-center text-sm text-white/70">
                <span className="px-2 py-1 rounded-full bg-white/10 border border-white/10">
                  {featured.currency_mint ? 'USDC' : 'SOL'}
                </span>
                <span className="px-2 py-1 rounded-full bg-aurora/20 border border-white/10">
                  {featured.status}
                </span>
              </div>
              <p className="text-white/60">Price: {featured.price_lamports} lamports</p>
            </div>
          ) : (
            <p className="text-white/60 text-sm">No listings yet.</p>
          )}
          <div className="flex flex-col md:flex-row gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search by asset or seller"
              className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10"
            />
            <input
              value={rarityFilter}
              onChange={(e) => setRarityFilter(e.target.value)}
              placeholder="Filter by status/rarity"
              className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10"
            />
            <button onClick={fetchListings} className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm">
              Refresh
            </button>
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {filteredListings.map((listing) => (
          <motion.div
            key={listing.core_asset}
            className="card-blur rounded-2xl p-4 border border-white/5"
            whileHover={{ rotate: -1, scale: 1.02 }}
          >
            <p className="text-white/60 text-xs">Asset</p>
            <p className="font-semibold break-all">{listing.core_asset}</p>
            <p className="text-sm text-white/60 mt-2">Price: {listing.price_lamports} lamports</p>
            <div className="flex gap-2 mt-2 text-xs">
              <span className="px-2 py-1 rounded-full bg-white/10 border border-white/10">
                {listing.currency_mint ? 'USDC' : 'SOL'}
              </span>
              <span className="px-2 py-1 rounded-full bg-aurora/20 border border-white/10">
                {listing.status}
              </span>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 px-4 py-2 rounded-xl bg-sakura text-ink font-semibold"
                onClick={() => handleFill(listing.core_asset)}
                disabled={loading}
              >
                Buy
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-xl border border-white/10"
                onClick={() => handleCancel(listing.core_asset)}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        ))}
        {!filteredListings.length && <p className="text-white/60">No active listings yet.</p>}
      </div>
    </div>
  );
}
