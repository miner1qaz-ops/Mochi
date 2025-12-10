'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, VersionedTransaction, VersionedMessage } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  api,
  fetchVirtualCards,
  fetchListings,
  listCard,
  cancelListing,
  VirtualCard,
  Listing,
  fetchPortfolioSummary,
  fetchPortfolioHoldings,
  PortfolioSummary,
  PortfolioHoldings,
} from '../../../lib/api';
import { deriveAta } from '../../../lib/ata';
import { buildV0Tx } from '../../../lib/tx';
import RedeemPhysicalModal, { RedemptionAsset } from './RedeemPhysicalModal';

const PACK_TEMPLATE_OFFSETS: Record<string, number> = {
  meg_web: 0,
  phantasmal_flames: 2000,
};

export default function ProfilePage() {
  const params = useParams();
  const address = params?.address as string;
  const [assets, setAssets] = useState<any[]>([]);
  const [virtualCards, setVirtualCards] = useState<VirtualCard[]>([]);
  const [listedCards, setListedCards] = useState<Listing[]>([]);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [recycleStatus, setRecycleStatus] = useState<string | null>(null);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [listingId, setListingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'rarity' | 'name'>('rarity');
  const [viewTab, setViewTab] = useState<'nft' | 'listed' | 'virtual'>('nft');
  const [searchTerm, setSearchTerm] = useState('');
  const [priceInputs, setPriceInputs] = useState<Record<string, number>>({});
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const mochiMint = useMemo(
    () => new PublicKey(process.env.NEXT_PUBLIC_MOCHI_TOKEN_MINT || 'GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv'),
    []
  );
  const mochiDecimals = useMemo(() => Number(process.env.NEXT_PUBLIC_MOCHI_TOKEN_DECIMALS || 6), []);
  const [mochiBalance, setMochiBalance] = useState<number | null>(null);
  const [assetImages, setAssetImages] = useState<Record<string, string>>({});
  const [portfolioSummary, setPortfolioSummary] = useState<PortfolioSummary | null>(null);
  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHoldings | null>(null);
  const [showHoldings, setShowHoldings] = useState(false);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [templateImages, setTemplateImages] = useState<Record<number, { image: string; name?: string; rarity?: string }>>({});
  const [showRedemptionModal, setShowRedemptionModal] = useState(false);

  const metadataHost = process.env.NEXT_PUBLIC_METADATA_URL || 'https://getmochi.fun';
  const legacyHosts = (process.env.NEXT_PUBLIC_LEGACY_METADATA_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const rewriteLegacyHost = useCallback((url: string) => {
    let out = url;
    const target = metadataHost.replace(/^https?:\/\//, '');
    legacyHosts.forEach((host) => {
      const normalized = host.replace(/^https?:\/\//, '');
      out = out.replace(normalized, target);
    });
    return out;
  }, [legacyHosts, metadataHost]);

  const normalizeImage = useCallback((src?: string | null) => {
    if (!src) return undefined;
    let url = src;
    if (url.startsWith('ipfs://')) {
      url = url.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }
    url = rewriteLegacyHost(url);
    return url;
  }, [rewriteLegacyHost]);

  const formatName = (name?: string | null, templateId?: number | null) => {
    if (!templateId) return name || '';
    if (name && name.includes('#')) return name;
    return name ? `${name} #${templateId}` : `Card #${templateId}`;
  };

  const getTemplateIdFromAsset = (asset: any): number | null => {
    const attrs = asset?.content?.metadata?.attributes || [];
    for (const attr of attrs) {
      const key = (attr.trait_type || attr.traitType || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (key === 'templateid' || key === 'template_id' || key === 'template') {
        const raw = attr.value ?? attr.Value;
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
    if (typeof asset?.template_id === 'number') {
      return asset.template_id;
    }
    const name = asset?.content?.metadata?.name || asset?.content?.metadata?.data?.name || asset?.name;
    const match = typeof name === 'string' ? name.match(/#(\d+)/) : null;
    if (match) {
      const parsed = Number(match[1]);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  const hasInlineImage = (asset: any) =>
    !!(
      asset?.content?.links?.image ||
      asset?.content?.metadata?.image ||
      asset?.content?.files?.[0]?.uri ||
      asset?.content?.metadata?.properties?.files?.[0]?.uri
    );

  useEffect(() => {
    // Fetch metadata for assets missing inline image
    const missing = assets.filter((a) => !hasInlineImage(a));
    if (!missing.length) return;
    missing.forEach(async (a) => {
      const candidates = [
        a.content?.json_uri,
        a.content?.metadata_uri,
        a.content?.uri,
      ]
        .map((u: string | undefined) => normalizeImage(u))
        .filter(Boolean) as string[];
      for (const uri of candidates) {
        try {
          const res = await fetch(uri, { cache: 'no-store' });
          if (!res.ok) continue;
          const meta = await res.json();
          const img =
            normalizeImage(meta?.image) ||
            normalizeImage(meta?.properties?.image) ||
            normalizeImage(meta?.properties?.files?.[0]?.uri);
          if (img) {
            setAssetImages((prev) => (prev[a.id] ? prev : { ...prev, [a.id]: img }));
            break;
          }
        } catch {
          /* ignore and try next candidate */
        }
      }
    });
  }, [assets, normalizeImage]);

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

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const templateMap: Record<number, { image: string; name?: string; rarity?: string }> = {};

        const resMeg = await fetch('/data/meg_web_expanded.csv');
        if (resMeg.ok) {
          const text = await resMeg.text();
          const lines = text.trim().split('\n').slice(1);
          for (const line of lines) {
            const cells = line.split(',');
            const id = Number(cells[0]);
            if (!Number.isFinite(id)) continue;
            const name = cells[1];
            const rarity = cells[2];
            const imageCell = cells[4];
            const normalizedImage =
              imageCell?.startsWith('http') || imageCell?.startsWith('/')
                ? imageCell
                : imageCell
                ? `/img/${imageCell}`
                : undefined;
            templateMap[id] = { name, rarity, image: normalizedImage || '/card_back.png' };
          }
        }

        const resPfl = await fetch('/data/phantasmal_flames.csv');
        if (resPfl.ok) {
          const text = await resPfl.text();
          const lines = text.trim().split('\n').slice(1);
          lines.forEach((raw, idx) => {
            const line = raw.trim();
            if (!line) return;
            const cells = line.split(',');
            const [serial, name, rarity, printType] = cells;
            const baseIdRaw = Number(serial?.split('/')?.[0] ?? idx + 1);
            const baseId = Number.isFinite(baseIdRaw) ? baseIdRaw : idx + 1;
            const templateId = (PACK_TEMPLATE_OFFSETS['phantasmal_flames'] || 0) + baseId;
            const serialSlug = (serial?.split('/')?.[0] || `${baseId}`).padStart(3, '0');
            const nameSlug = (name || `card-${idx + 1}`).replace(/[^A-Za-z0-9]+/g, '_');
            const image = `/img/phantasmal_flames/${serialSlug}-${nameSlug}.jpg`;
            templateMap[templateId] = { name: name || `Card ${templateId}`, rarity: rarity || printType, image };
          });
        }

        setTemplateImages(templateMap);
      } catch (e) {
        console.warn('Failed to load template images', e);
      }
    };
    loadTemplates();
  }, []);

  useEffect(() => {
    if (!address) return;
    api.get(`/profile/${address}`).then((res) => setAssets(res.data.assets || [])).catch(console.error);
    fetchVirtualCards(address).then(setVirtualCards).catch(() => setVirtualCards([]));
    fetchListings()
      .then((items) => setListedCards(items.filter((l) => (l.seller || '').toLowerCase() === address.toLowerCase())))
      .catch(() => setListedCards([]));
    fetchPortfolioSummary(address)
      .then(setPortfolioSummary)
      .catch(() => setPortfolioSummary(null));
  }, [address]);

  useEffect(() => {
    if (!address || !connection) return;
    let cancelled = false;
    const loadMochi = async () => {
      try {
        const owner = new PublicKey(address);
        const ata = await deriveAta(owner, mochiMint);
        const bal = await connection.getTokenAccountBalance(ata);
        if (!cancelled) {
          setMochiBalance(Number(bal?.value?.amount || 0));
        }
      } catch (e) {
        if (!cancelled) setMochiBalance(0);
      }
    };
    loadMochi();
    return () => {
      cancelled = true;
    };
  }, [address, connection, mochiMint]);

  const rarityOrder = useMemo<Record<string, number>>(
    () => ({
      Common: 0,
      Uncommon: 1,
      Rare: 2,
      DoubleRare: 3,
      UltraRare: 4,
      IllustrationRare: 5,
      SpecialIllustrationRare: 6,
      MegaHyperRare: 7,
      Energy: -1,
    }),
    []
  );

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

  const filteredListings = useMemo(() => {
    return (listedCards || []).filter((item) => {
      const name = (item.name || '').toLowerCase();
      const matchesSearch = searchTerm ? name.includes(searchTerm.toLowerCase()) : true;
      return matchesSearch;
    });
  }, [listedCards, searchTerm]);

  const visibleVirtualCards = useMemo(() => virtualCards.filter((vc) => vc.count > 0), [virtualCards]);

  const redemptionAssets = useMemo<RedemptionAsset[]>(() => {
    if (!assets.length) return [];
    return assets.slice(0, 6).map((asset) => {
      const templateId = getTemplateIdFromAsset(asset);
      const templateInfo = templateId ? templateImages[templateId] : undefined;
      const rawImage =
        asset.content?.links?.image ||
        asset.content?.metadata?.image ||
        asset.content?.metadata?.properties?.image ||
        asset.content?.metadata?.data?.image ||
        asset.content?.files?.[0]?.uri ||
        asset.content?.metadata?.properties?.files?.[0]?.uri;
      const fallbackImage = assetImages[asset.id] || normalizeImage(rawImage) || '/card_back.png';
      const rarityVal =
        asset.content?.metadata?.attributes?.find((attr: any) => (attr.trait_type || '').toLowerCase() === 'rarity')
          ?.value || templateInfo?.rarity || '';
      return {
        id: asset.id,
        name: formatName(asset.content?.metadata?.name, templateId) || 'Core asset',
        rarity: rarityVal,
        image: templateInfo?.image || fallbackImage,
      };
    });
  }, [assets, assetImages, templateImages, normalizeImage]);

  const totalVirtual = visibleVirtualCards.reduce((sum, v) => sum + v.count, 0);
  const totalNfts = filteredAssets.length;
  const totalListed = filteredListings.length;
  const topHoldings = portfolioSummary?.top_holdings || [];
  const isOwner = publicKey?.toBase58() === address;

  const loadHoldings = async () => {
    if (!address || holdingsLoading || portfolioHoldings) return;
    setHoldingsLoading(true);
    try {
      const data = await fetchPortfolioHoldings(address);
      setPortfolioHoldings(data);
    } catch {
      setPortfolioHoldings(null);
    } finally {
      setHoldingsLoading(false);
    }
  };

  const recycleItems = Object.entries(selected)
    .filter(([, cnt]) => cnt > 0)
    .map(([templateId, count]) => {
      const vc = visibleVirtualCards.find((v) => v.template_id === Number(templateId));
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
      if (!data.message_b64) {
        throw new Error('Transaction payload missing message');
      }

      const message = VersionedMessage.deserialize(Buffer.from(data.message_b64, 'base64'));
      const tx = new VersionedTransaction(message);

      // Defensive: ensure the payer in the message matches the connected wallet.
      const signerPubkeys = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
      const payerKey = signerPubkeys[0];
      if (!payerKey.equals(publicKey)) {
        throw new Error(`Payer mismatch. Tx expects ${payerKey.toBase58()}, wallet is ${publicKey.toBase58()}.`);
      }

      const signed = await signTransaction(tx);

      // Verify wallet signature is present on its slot.
      const userSignerIndex = signerPubkeys.findIndex((k) => k.equals(publicKey));
      if (
        userSignerIndex === -1 ||
        !signed.signatures[userSignerIndex] ||
        !signed.signatures[userSignerIndex].some((b: number) => b !== 0)
      ) {
        throw new Error('Wallet signature missing; make sure you approved with the connected wallet.');
      }

      const signedTxB64 = Buffer.from(signed.serialize()).toString('base64');
      const submit = await api.post('/profile/recycle/submit', {
        wallet: publicKey.toBase58(),
        signed_tx_b64: signedTxB64,
        items: recycleItems,
      });
      const sig = submit.data?.signature;
      setRecycleStatus(sig ? `Recycled! Tx: ${sig}` : 'Recycled!');
      fetchVirtualCards(publicKey.toBase58()).then(setVirtualCards).catch(() => {});
    } catch (e) {
      console.error('recycle error', e);
      setRecycleStatus(
        `Recycle failed. ${(e as Error)?.message || ''}`.trim() || 'Recycle failed. Check balance and selection.'
      );
    } finally {
      setRecycleLoading(false);
    }
  };

  const refreshProfile = () => {
    if (!address) return;
    api.get(`/profile/${address}`).then((res) => setAssets(res.data.assets || [])).catch(console.error);
    fetchListings()
      .then((items) => setListedCards(items.filter((l) => (l.seller || '').toLowerCase() === address.toLowerCase())))
      .catch(() => setListedCards([]));
    fetchVirtualCards(address).then(setVirtualCards).catch(() => setVirtualCards([]));
    fetchPortfolioSummary(address)
      .then(setPortfolioSummary)
      .catch(() => setPortfolioSummary(null));
  };

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

  const handleList = async (assetId: string) => {
    if (!publicKey) return;
    const priceLamports = priceInputs[assetId];
    if (!priceLamports || priceLamports <= 0) {
      setRecycleStatus('Enter a price greater than 0.');
      return;
    }
    setListingId(assetId);
    setRecycleStatus('Listing…');
    try {
      const res = await listCard(assetId, publicKey.toBase58(), Math.floor(priceLamports * 1_000_000_000));
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setRecycleStatus(`Listed. Tx: ${sig}`);
      await connection.confirmTransaction(sig, 'confirmed');
      refreshProfile();
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      console.error('list error', e);
      setRecycleStatus(`Listing failed. ${(e as Error)?.message || ''}`.trim() || 'Listing failed. Check balance/ownership and try again.');
    }
    setListingId(null);
  };

  const handleCancel = async (assetId: string) => {
    if (!publicKey) return;
    try {
      setCancellingId(assetId);
      setRecycleStatus('Cancelling listing…');
      const res = await cancelListing(assetId, publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      // Pre-flight simulate to surface errors in UI
      try {
        const sim = await connection.simulateTransaction(tx, { sigVerify: false });
        if (sim.value.err) {
          setRecycleStatus(`Cancel failed (sim): ${JSON.stringify(sim.value.err)} logs=${sim.value.logs?.join(' | ')}`);
          setCancellingId(null);
          return;
        }
      } catch (simErr) {
        console.error('simulate cancel error', simErr);
      }
      let sig: string;
      if (sendTransaction) {
        sig = await sendTransaction(tx, connection, { maxRetries: 3, skipPreflight: false });
      } else if (signTransaction) {
        const signed = await signTransaction(tx);
        sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      } else {
        setRecycleStatus('Connect a wallet that can sign transactions.');
        return;
      }
      setRecycleStatus(`Cancelled. Tx: ${sig}`);
      await connection.confirmTransaction(sig, 'confirmed');
      refreshProfile();
      // Hard refresh so the removal is obvious to the user right after a successful cancel.
      setTimeout(() => window.location.reload(), 250);
    } catch (e) {
      console.error('cancel error', e);
      setRecycleStatus(`Cancel failed. ${(e as Error)?.message || ''}`.trim());
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Profile</h1>
        <p className="text-white/60">{address}</p>
      </div>
      {recycleStatus && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
          {recycleStatus}
        </div>
      )}
      <div className="card-blur rounded-2xl border border-white/10 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">Redeem physical asset (burns NFT)</p>
          <p className="text-sm text-white/70">
            Submit a vault pull request if you truly need the physical card. Shipping/insurance is roughly $20–$30 USD and will be
            invoiced after verification. Redemption removes the NFT from play and the marketplace.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <button
            type="button"
            onClick={() => setShowRedemptionModal(true)}
            disabled={!isOwner}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              isOwner
                ? 'border-white/20 bg-white/10 text-white/80 hover:border-aurora/50 hover:text-white'
                : 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
            }`}
          >
            {isOwner ? 'Request redemption' : 'Connect wallet to request'}
          </button>
        </div>
      </div>
      <div className="card-blur rounded-2xl border border-white/5 p-4 space-y-3">
        <div className="grid grid-cols-2 max-[520px]:grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 text-sm text-white">
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <p className="text-xs text-white/60">Owned NFTs</p>
            <p className="text-lg font-semibold">{totalNfts}</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <p className="text-xs text-white/60">Listed</p>
            <p className="text-lg font-semibold">{totalListed}</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <p className="text-xs text-white/60">Virtual cards</p>
            <p className="text-lg font-semibold">{totalVirtual}</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <p className="text-xs text-white/60">MOCHI balance</p>
            <p className="text-lg font-semibold">
              {mochiBalance === null ? '—' : (mochiBalance / 10 ** mochiDecimals).toLocaleString(undefined, { maximumFractionDigits: mochiDecimals })}
            </p>
            <div className="text-[11px] text-white/60 break-all">Mint: {mochiMint.toBase58()}</div>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <p className="text-xs text-white/60">Portfolio value</p>
            <p className="text-lg font-semibold">
              {portfolioSummary ? `$${portfolioSummary.total_value_usd.toFixed(2)}` : '—'}
            </p>
            <div className="text-[11px] text-white/60">NFTs: {portfolioSummary?.total_nfts ?? '—'} · Virtual: {portfolioSummary?.total_virtual ?? '—'}</div>
            {portfolioSummary?.sparkline?.length ? (
              <svg viewBox={`0 0 120 40`} className="w-full h-10 mt-1">
                {(() => {
                  const vals = portfolioSummary.sparkline;
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  const range = max - min || 1;
                  const coords = vals.map((v, i) => {
                    const x = (i / Math.max(1, vals.length - 1)) * 120;
                    const y = 40 - ((v - min) / range) * 40;
                    return `${x},${y}`;
                  });
                  return <polyline fill="none" stroke="#34d399" strokeWidth="2" points={coords.join(' ')} strokeLinejoin="round" strokeLinecap="round" />;
                })()}
              </svg>
            ) : (
              <div className="text-[11px] text-white/50 mt-1">No price history</div>
            )}
          </div>
        </div>
        <div className="flex gap-2 text-sm flex-wrap">
          <button
            type="button"
            className={viewTab === 'nft' ? 'cta-primary' : 'cta-ghost'}
            data-tone={viewTab === 'nft' ? 'sakura' : undefined}
            onClick={() => setViewTab('nft')}
          >
            Owned NFTs
          </button>
          <button
            type="button"
            className={viewTab === 'listed' ? 'cta-primary' : 'cta-ghost'}
            data-tone={viewTab === 'listed' ? 'aurora' : undefined}
            onClick={() => setViewTab('listed')}
          >
            Listed NFTs
          </button>
          <button
            type="button"
            className={viewTab === 'virtual' ? 'cta-primary' : 'cta-ghost'}
            data-tone={viewTab === 'virtual' ? 'lime' : undefined}
            onClick={() => setViewTab('virtual')}
          >
            Virtual cards
          </button>
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
        </div>
      </div>

      {viewTab === 'nft' && (
        <div className="space-y-4">
          {portfolioSummary && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Top holdings</div>
                <div className="text-xs text-white/60">Snapshot · tap a card to view in Market</div>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                {topHoldings.length === 0 && <div className="text-xs text-white/60">No holdings yet.</div>}
                {topHoldings.slice(0, 5).map((h) => (
                  <a
                    key={h.template_id}
                    href={`/market/card/${h.template_id}`}
                    className="rounded-xl border border-white/5 bg-black/20 p-2 flex gap-2 items-center hover:bg-white/10"
                  >
                    {h.image_url ? (
                      <img src={h.image_url} alt={h.name || ''} className="h-12 w-9 object-contain rounded-lg bg-black/30 border border-white/10" />
                    ) : (
                      <div className="h-12 w-9 rounded-lg bg-black/30 border border-white/10 flex items-center justify-center text-[10px] text-white/50">No art</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{h.name || `Card #${h.template_id}`}</div>
                      <div className="text-[11px] text-white/60">Qty {h.count} · Fair ${h.fair_value.toFixed(2)}</div>
                      <div className="text-sm font-semibold">${h.total_value_usd.toFixed(2)}</div>
                    </div>
                  </a>
                ))}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm"
                  onClick={() => {
                    if (!showHoldings) loadHoldings();
                    setShowHoldings((prev) => !prev);
                  }}
                >
                  {showHoldings ? 'Hide full breakdown' : 'View full breakdown'}
                </button>
              </div>
              {showHoldings && (
                <div className="mt-2 text-sm space-y-2">
                  {holdingsLoading && <div className="text-white/70 text-xs">Loading breakdown…</div>}
                  {!holdingsLoading && portfolioHoldings && portfolioHoldings.breakdown.length === 0 && (
                    <div className="text-xs text-white/60">No holdings yet.</div>
                  )}
                  {!holdingsLoading &&
                    portfolioHoldings?.breakdown.map((b) => (
                      <a
                        key={b.template_id}
                        href={`/market/card/${b.template_id}`}
                        className="flex items-center justify-between rounded-lg bg-black/20 border border-white/5 px-3 py-2 hover:bg-white/10"
                      >
                        <div className="truncate flex items-center gap-2">
                          {b.image_url ? (
                            <img src={b.image_url} alt={b.name || ''} className="h-10 w-8 object-contain rounded bg-black/30 border border-white/10" />
                          ) : null}
                          <span>{b.name || `Card #${b.template_id}`} × {b.count}</span>
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <span className="text-white/70 text-xs">Fair: ${b.fair_value.toFixed(2)}</span>
                          <span className="font-semibold">${b.total_value_usd.toFixed(2)}</span>
                        </div>
                      </a>
                    ))}
                </div>
              )}
            </div>
          )}
          <div className="grid sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filteredAssets.map((asset) => {
            const name = asset.content?.metadata?.name || 'Core asset';
            const rawImage =
              asset.content?.links?.image ||
              asset.content?.metadata?.image ||
              asset.content?.metadata?.properties?.image ||
              asset.content?.metadata?.data?.image ||
              asset.content?.files?.[0]?.uri ||
              asset.content?.metadata?.properties?.files?.[0]?.uri;
            const rarityVal =
              asset.content?.metadata?.attributes?.find((attr: any) => (attr.trait_type || '').toLowerCase() === 'rarity')
                ?.value || '';
            const templateId = getTemplateIdFromAsset(asset);
            const templateInfo = templateId ? templateImages[templateId] : undefined;
            const localImage = templateInfo?.image;
            const fallbackImage = assetImages[asset.id] || normalizeImage(rawImage) || '/card_back.png';
            const image = localImage || fallbackImage;
            const cardDetails = (
              <>
                <div className="relative aspect-[3/4] rounded-xl overflow-visible">
                  <div
                    className="relative h-full w-full overflow-hidden rounded-xl border border-white/5 bg-black/20 transition-transform duration-200 ease-out will-change-transform"
                    style={{ transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)', transformStyle: 'preserve-3d' }}
                    onMouseMove={handleTiltMove}
                    onMouseLeave={handleTiltLeave}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image}
                      alt={name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        if (localImage && el.dataset.fallback !== '1') {
                          el.dataset.fallback = '1';
                          el.src = fallbackImage || '/card_back.png';
                        } else {
                          el.src = '/card_back.png';
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold truncate">{name}</p>
                    <span className="glass-chip glass-chip--tiny">{rarityVal || '—'}</span>
                  </div>
                  <p className="text-xs text-white/60 break-all">{asset.id}</p>
                </div>
              </>
            );
            return (
              <div
                key={asset.id}
                className={`card-blur rounded-2xl p-3 border border-white/5 space-y-3 relative ${rarityGlowClass(rarityVal)}`}
              >
                {templateId ? (
                  <Link
                    href={`/market/card/${templateId}`}
                    className="block space-y-3 focus:outline-none focus:ring-2 focus:ring-aurora/60 rounded-xl"
                  >
                    {cardDetails}
                  </Link>
                ) : (
                  <div className="space-y-3">
                    {cardDetails}
                  </div>
                )}
                {publicKey?.toBase58() === address && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={priceInputs[asset.id] ?? ''}
                      disabled={!!listingId}
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
                      className={`px-2 py-1 rounded-lg bg-aurora text-ink text-xs font-semibold transition ${
                        listingId ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'
                      }`}
                      disabled={!!listingId}
                      onClick={() => handleList(asset.id)}
                    >
                      {listingId === asset.id ? 'Listing…' : 'List'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {!assets.length && <p className="text-white/60">No assets found.</p>}
          </div>
        </div>
      )}

      {viewTab === 'listed' && (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredListings.map((item) => {
            const isClickable = !!item.template_id;
            return (
              <div
                key={item.core_asset}
                className={`card-blur rounded-2xl p-3 border border-white/5 space-y-3 relative ${rarityGlowClass(item.rarity)} ${
                  isClickable ? 'hover:border-aurora/60' : ''
                }`}
              >
                {isClickable ? (
                  <Link
                    href={`/market/card/${item.template_id}`}
                    className="block space-y-3 focus:outline-none focus:ring-2 focus:ring-aurora/60 rounded-xl"
                  >
                    <div className="relative aspect-[3/4] rounded-xl overflow-visible">
                      <div
                        className="relative h-full w-full overflow-hidden rounded-xl border border-white/5 bg-black/20 transition-transform duration-200 ease-out will-change-transform"
                        style={{ transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)', transformStyle: 'preserve-3d' }}
                        onMouseMove={handleTiltMove}
                        onMouseLeave={handleTiltLeave}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizeImage(item.image_url) || '/card_back.png'}
                          alt={item.name || item.core_asset}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/card_back.png';
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold">
                        {formatName(item.name, item.template_id) || 'Listed NFT'}
                      </p>
                      <p className="text-xs text-white/60 break-all">{item.core_asset}</p>
                      <p className="text-xs text-aurora font-semibold">
                        {item.price_lamports / 1_000_000_000} {item.currency_mint ? 'Token' : 'SOL'}
                      </p>
                      <p className="text-xs text-white/60">Status: {item.status}</p>
                    </div>
                  </Link>
                ) : (
                  <div className="space-y-3">
                    <div className="relative aspect-[3/4] rounded-xl overflow-visible">
                      <div
                        className="relative h-full w-full overflow-hidden rounded-xl border border-white/5 bg-black/20 transition-transform duration-200 ease-out will-change-transform"
                        style={{ transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)', transformStyle: 'preserve-3d' }}
                        onMouseMove={handleTiltMove}
                        onMouseLeave={handleTiltLeave}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizeImage(item.image_url) || '/card_back.png'}
                          alt={item.name || item.core_asset}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/card_back.png';
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold">
                        {formatName(item.name, item.template_id) || 'Listed NFT'}
                      </p>
                      <p className="text-xs text-white/60 break-all">{item.core_asset}</p>
                      <p className="text-xs text-aurora font-semibold">
                        {item.price_lamports / 1_000_000_000} {item.currency_mint ? 'Token' : 'SOL'}
                      </p>
                      <p className="text-xs text-white/60">Status: {item.status}</p>
                    </div>
                  </div>
                )}
                {publicKey?.toBase58() === address && (
                  <button
                    type="button"
                    onClick={() => handleCancel(item.core_asset)}
                    disabled={!!cancellingId}
                    className={`mt-2 w-full rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold transition ${
                      cancellingId
                        ? 'bg-white/5 text-white/40 cursor-not-allowed'
                        : 'bg-white/5 hover:border-amber-400/60 hover:text-amber-200'
                    }`}
                  >
                    {cancellingId === item.core_asset ? 'Cancelling…' : 'Cancel listing'}
                  </button>
                )}
              </div>
            );
          })}
          {!filteredListings.length && <p className="text-white/60">No listed NFTs for this wallet.</p>}
        </div>
      )}

      {viewTab === 'virtual' && (
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
          {visibleVirtualCards.map((vc) => (
            <div key={`${vc.template_id}-${vc.rarity}`} className={`rounded-xl border border-white/10 bg-black/30 p-3 space-y-2 ${rarityGlowClass(vc.rarity)}`}>
              <div className="flex items-start gap-3">
                <div className="w-16 h-20 rounded-lg overflow-hidden border border-white/10 bg-black/50 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={normalizeImage(vc.image_url) || '/card_back.png'}
                    alt={vc.name || `Card ${vc.template_id}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/card_back.png';
                    }}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between text-sm text-white/80">
                    <span className="font-semibold">{vc.name || `Card #${vc.template_id}`}</span>
                    <span className="font-semibold">x{vc.count}</span>
                  </div>
                  <p className="text-xs text-white/60">{vc.rarity}{vc.is_energy ? ' · Energy' : ''}</p>
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
              </div>
            </div>
          ))}
          {!visibleVirtualCards.length && <p className="text-white/60 text-sm">No virtual cards yet.</p>}
        </div>
        <p className="text-xs text-white/50">10 virtual cards → 1 Mochi token (devnet)</p>
      </div>
      )}
      <RedeemPhysicalModal
        open={showRedemptionModal}
        onClose={() => setShowRedemptionModal(false)}
        assets={redemptionAssets}
        walletAddress={address}
      />
    </div>
  );
}
