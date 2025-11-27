'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildPack, claimPack, previewPack, sellbackPack, PackSlot } from '../../lib/api';
import { buildV0Tx } from '../../lib/tx';
import { deriveAta } from '../../lib/ata';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import type { AxiosError } from 'axios';

// vault_authority PDA derives from program id; until we pull it from backend, we reconstruct here
const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const VAULT_STATE_SEED = 'vault_state';

function vaultAuthorityPk() {
  const vaultState = PublicKey.findProgramAddressSync([Buffer.from(VAULT_STATE_SEED)], PROGRAM_ID)[0];
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault_authority'), vaultState.toBuffer()], PROGRAM_ID);
  return pda;
}

type ApiErrorPayload = { detail?: string; message?: string };

const extractErrorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    const axiosErr = err as AxiosError<ApiErrorPayload>;
    const detail = axiosErr?.response?.data?.detail || axiosErr?.response?.data?.message;
    if (detail) return detail;
    if ('message' in err && typeof (err as { message?: string }).message === 'string') {
      return (err as { message?: string }).message as string;
    }
  }
  return 'Request failed – please try again.';
};

const rarityColors: Record<string, string> = {
  Common: 'from-white/10 to-white/5',
  Uncommon: 'from-aurora/40 to-white/5',
  Rare: 'from-coin/50 to-white/5',
  UltraRare: 'from-sakura/70 to-aurora/30',
  DoubleRare: 'from-coin/60 to-sakura/40',
  IllustrationRare: 'from-sakura/80 to-aurora/60',
  SpecialIllustrationRare: 'from-sakura/90 to-aurora/80',
  MegaHyperRare: 'from-red-400 to-purple-500',
  Energy: 'from-white/20 to-aurora/20',
};

const FlipModalCard = ({
  backImage,
  frontImage,
  onAdvance,
  faceBack,
}: {
  backImage: string;
  frontImage: string;
  onAdvance: () => void;
  faceBack: boolean;
}) => {
  return (
    <div style={{ perspective: 1000 }} className="w-full max-w-md mx-auto">
      <motion.div
        style={{
          width: '100%',
          aspectRatio: '2/3',
          position: 'relative',
          transformStyle: 'preserve-3d',
          cursor: 'pointer',
        }}
        animate={{ rotateY: faceBack ? 0 : 180 }}
        transition={{ duration: 0.6 }}
        onClick={onAdvance}
        drag="x"
        dragConstraints={{ left: -300, right: 300 }}
        dragElastic={0.35}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          const threshold = 40;
          if (Math.abs(info.offset.x) > threshold || Math.abs(info.velocity.x) > 800) {
            onAdvance();
          }
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backImage}
            alt="card back"
            className="w-full h-full object-contain rounded-2xl"
            style={{ display: 'block' }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frontImage}
            alt="card front"
            className="w-full h-full object-contain rounded-2xl"
            style={{ display: 'block' }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/card_back.png';
            }}
          />
        </div>
      </motion.div>
    </div>
  );
};

export default function GachaPage() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [clientSeed, setClientSeed] = useState('');
  const [slots, setSlots] = useState<PackSlot[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [proof, setProof] = useState<{ server_seed_hash: string; server_nonce: string; entropy_proof: string } | null>(null);
  const [clientProofSeed, setClientProofSeed] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'info' | 'error'>('info');
  const [useUsdc, setUseUsdc] = useState(false);
  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT ? new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT) : null;
  const [packStage, setPackStage] = useState<'idle' | 'swing' | 'tear' | 'reveal'>('idle');
  const [revealIndex, setRevealIndex] = useState<number>(-1);
  const [revealMode, setRevealMode] = useState<'fast' | 'one'>('fast');
  const [showOneModal, setShowOneModal] = useState(false);
  const [templatesByPack, setTemplatesByPack] = useState<Record<string, Record<number, { name: string; image: string; rarity: string }>>>({});
  const [revealed, setRevealed] = useState<boolean[]>([]);
  const [modalFaceBack, setModalFaceBack] = useState(true);
  const packOptions = useMemo(
    () => [
      { id: 'meg_web_alt', name: 'Mega Evolutions Pack', priceSol: 0.12, priceUsdc: 12, image: '/img/pack_alt.jpg' },
    ],
    []
  );
  const [selectedPack, setSelectedPack] = useState<string>('meg_web_alt');

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown && countdown > 0) {
      timer = setInterval(() => setCountdown((c) => (c ? c - 1 : 0)), 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    // Load card templates for each pack from CSV
    const loadTemplates = async () => {
      try {
        const packs: Record<string, Record<number, { name: string; image: string; rarity: string }>> = {};

        // meg_web default
        const resMeg = await fetch('/data/meg_web_expanded.csv');
        const textMeg = await resMeg.text();
        const linesMeg = textMeg.trim().split('\n').slice(1);
        const mapMeg: Record<number, { name: string; image: string; rarity: string }> = {};
        for (const line of linesMeg) {
          const [num, name, rarity, _variant, image] = line.split(',');
          const id = Number(num);
          if (!mapMeg[id]) {
            const normalizedImage = image?.startsWith('http') ? image : image?.startsWith('/') ? image : `/img/${image}`;
            mapMeg[id] = { name, image: normalizedImage || '/card_back.png', rarity };
          }
        }
        packs['meg_web'] = mapMeg;

        // mega evolutions
        const resMega = await fetch('/data/mega_evolutions.csv');
        if (resMega.ok) {
          const textMega = await resMega.text();
          const linesMega = textMega.trim().split('\n').slice(1);
          const mapMega: Record<number, { name: string; image: string; rarity: string }> = {};
          for (const raw of linesMega) {
            const line = raw.trim();
            if (!line) continue;
            // token_id,name,description,image_url,source_id,rarity,...
            const cells: string[] = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const ch = line[i];
              if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
              } else if (ch === '"') {
                inQuotes = !inQuotes;
              } else if (ch === ',' && !inQuotes) {
                cells.push(current);
                current = '';
              } else {
                current += ch;
              }
            }
            cells.push(current);
            const [tokenId, name, _desc, imageUrl, _sourceId, rarity] = cells;
            const id = Number(tokenId);
            if (!id || !imageUrl) continue;
            if (!mapMega[id]) {
              mapMega[id] = { name: name || `Card ${id}`, image: imageUrl, rarity: rarity || 'Common' };
            }
          }
          packs['meg_web_alt'] = mapMega;
        }

        setTemplatesByPack(packs);
      } catch (e) {
        console.warn('Failed to load templates CSV, using fallback art', e);
      }
    };
    loadTemplates();
  }, []);

  const handlePreview = async () => {
    setStatusMsg(null);
    setStatusKind('info');
    const seed = clientSeed || crypto.randomUUID();
    setClientSeed(seed);
    const res = await previewPack(seed, publicKey?.toBase58() || '', selectedPack === 'meg_web_alt' ? 'meg_web' : selectedPack);
    setSlots(res.slots);
    setRevealed(Array(res.slots.length).fill(false));
    setRevealIndex(-1);
    setShowOneModal(false);
    setProof({ server_seed_hash: res.server_seed_hash, server_nonce: res.server_nonce, entropy_proof: res.entropy_proof });
    setClientProofSeed(seed);
  };

  const handleOpen = async () => {
    if (!connected || !publicKey) return;
    setLoading(true);
    try {
      setStatusMsg(null);
      let userToken: string | undefined;
      let vaultToken: string | undefined;
      let currencyMint: string | undefined;
      if (useUsdc) {
        if (!usdcMint) throw new Error('USDC mint not set');
        const userAta = await deriveAta(publicKey, usdcMint);
        const vaultAta = await deriveAta(vaultAuthorityPk(), usdcMint);
        userToken = userAta.toBase58();
        vaultToken = vaultAta.toBase58();
        currencyMint = usdcMint.toBase58();
      }
      const res = await buildPack(
        clientSeed || crypto.randomUUID(),
        publicKey.toBase58(),
        useUsdc ? 'USDC' : 'SOL',
        userToken,
        vaultToken,
        currencyMint,
        selectedPack === 'meg_web_alt' ? 'meg_web' : selectedPack
      );
      setSlots(res.lineup);
      setRevealed(Array(res.lineup.length).fill(false));
      setRevealIndex(0);
      setModalFaceBack(true);
      if (revealMode === 'one') setShowOneModal(true);
      setSessionId(res.session_id);
      setCountdown(3600);
      setProof({
        server_seed_hash: res.provably_fair.server_seed_hash,
        server_nonce: res.provably_fair.server_nonce,
        entropy_proof: res.provably_fair.entropy_proof,
      });
      setClientProofSeed(clientSeed || '');
      setPackStage('reveal');
      // Sign and send open pack transaction
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      if (!signTransaction) {
        throw new Error('Wallet is not ready to sign transactions.');
      }
      setStatusKind('info');
      setStatusMsg('Awaiting wallet signature…');
      const signed = await signTransaction(tx);
      setStatusMsg('Submitting transaction…');
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setStatusMsg(`Pack opened tx: ${sig}`);
    } catch (e) {
      console.error(e);
      setStatusKind('error');
      setStatusMsg(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!sessionId || !publicKey) return;
    const res = await claimPack(sessionId, publicKey.toBase58());
    const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
    try {
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setStatusKind('info');
      setStatusMsg(`Claim tx: ${sig}`);
    } catch (e) {
      console.error('claim error', e);
      setStatusKind('error');
      setStatusMsg(extractErrorMessage(e));
    }
  };

  const handleSellback = async () => {
    if (!sessionId || !publicKey) return;
    const res = await sellbackPack(sessionId, publicKey.toBase58());
    const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
    try {
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setStatusKind('info');
      setStatusMsg(`Sellback tx: ${sig}`);
    } catch (e) {
      console.error('sellback error', e);
      setStatusKind('error');
      setStatusMsg(extractErrorMessage(e));
    }
  };

  const enrichedSlots = useMemo(() => {
    const templateMap =
      templatesByPack[selectedPack] || templatesByPack['meg_web'] || {};
    return slots.map((slot, idx) => {
      const template = slot.template_id ? templateMap[slot.template_id] : undefined;
      const isRevealed = revealed[idx];
      return {
        ...slot,
        displayName: template?.name || `Template ${slot.template_id ?? 'TBD'}`,
        image: isRevealed ? template?.image || '/card_back.png' : '/card_back.png',
        revealed: isRevealed,
      };
    });
  }, [slots, templatesByPack, selectedPack, revealed]);

  const selectedPackInfo = useMemo(
    () => packOptions.find((p) => p.id === selectedPack) || packOptions[0],
    [packOptions, selectedPack]
  );

  useEffect(() => {
    setModalFaceBack(true);
  }, [revealIndex]);

  const revealCurrent = (idx: number) => {
    setRevealed((prev) => {
      const next = [...prev];
      next[idx] = true;
      return next;
    });
  };

  const swipeAdvanceModal = () => {
    if (!enrichedSlots.length || revealIndex < 0) return;
    if (!revealed[revealIndex]) {
      revealCurrent(revealIndex);
      setModalFaceBack(false);
      return;
    }
    if (revealIndex < enrichedSlots.length - 1) {
      setRevealIndex((prev) => Math.min(prev + 1, enrichedSlots.length - 1));
      setModalFaceBack(true);
    } else {
      setShowOneModal(false);
    }
  };

  const revealCards = enrichedSlots.map((slot, i) => (
    <motion.div
      key={i}
      className="rounded-3xl p-4 aspect-[2/3] card-blur border border-white/5 cursor-pointer perspective"
      whileHover={i <= revealIndex ? { rotateY: 4, rotateX: -2, scale: 1.02 } : undefined}
      whileTap={i === revealIndex ? { scale: 0.98 } : undefined}
      initial={packStage === 'reveal' && i <= revealIndex ? { opacity: 0, y: 30, rotate: -6, scale: 0.95 } : false}
      animate={
        i <= revealIndex
          ? { opacity: 1, y: 0, rotate: 0, scale: 1 }
          : { opacity: 0.3, scale: 0.9 }
      }
      transition={{ delay: i * 0.06, type: 'spring', stiffness: 140, damping: 18 }}
      onClick={() => {
        revealCurrent(i);
        setRevealIndex(i);
      }}
    >
      <div className={`h-full w-full rounded-2xl bg-gradient-to-br ${rarityColors[slot.rarity] || 'from-white/10 to-white/5'} flex flex-col justify-between p-2 overflow-hidden`}>
        <div className={`text-xs uppercase text-white/60 px-2 pt-2 ${i <= revealIndex ? 'opacity-100' : 'opacity-40'}`}>
          Slot {i + 1}
        </div>
        <div className="flex-1 flex items-center justify-center">
          <img
            src={slot.image}
            alt={slot.displayName}
            className={`h-full w-full object-contain drop-shadow-lg transition duration-300 ${slot.revealed ? 'opacity-100' : 'opacity-70'}`}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/card_back.png';
            }}
          />
        </div>
        <div className={`px-2 pb-2 transition-opacity ${i <= revealIndex && slot.revealed ? 'opacity-100' : 'opacity-30'}`}>
          <p className="text-sm text-white/60">{slot.rarity}</p>
          <p className="text-lg font-semibold leading-tight">{slot.displayName}</p>
        </div>
      </div>
    </motion.div>
  ));

  const packVariants = {
    idle: { rotate: 0, y: 0, scale: 1 },
    swing: { rotate: [0, -6, 6, 0], y: [0, -8, 8, 0], transition: { duration: 0.8 } },
    tear: { scale: 1.05, rotate: 0, y: -4 },
    reveal: { opacity: 0, scale: 0.9 },
  };

  return (
    <div className="space-y-8">
      <div className="card-blur rounded-3xl p-6 border border-white/5 grid lg:grid-cols-[1.1fr,0.9fr] gap-6 items-center">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <img src="/mochi_icon.png" alt="Mochi icon" className="h-10 w-10 rounded-full" />
            <div>
              <p className="text-sm uppercase text-white/60 tracking-[0.2em]">Mochi Great Pack</p>
              <p className="text-xl font-semibold">11 cards • 60 minute decision window</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
      {packOptions.map((pack) => (
        <button
          key={pack.id}
          type="button"
          onClick={() => setSelectedPack(pack.id)}
          className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${
            selectedPack === pack.id ? 'border-aurora/60 bg-aurora/10' : 'border-white/10 bg-white/5'
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pack.image} alt={pack.name} className="h-12 w-12 rounded-xl object-cover" />
          <div className="text-left">
            <p className="font-semibold">{pack.name}</p>
                  <p className="text-xs text-white/60">{pack.priceSol} SOL / {pack.priceUsdc} USDC</p>
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-xs uppercase text-white/60">Price</p>
              <p className="text-lg font-semibold">{selectedPackInfo.priceSol} SOL / {selectedPackInfo.priceUsdc} USDC</p>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-xs uppercase text-white/60">Buyback</p>
              <p className="text-lg font-semibold">90% full-pack</p>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10">
              <p className="text-xs uppercase text-white/60">Timer</p>
              <p className="text-lg font-semibold">{countdown !== null ? `${Math.max(countdown, 0)}s` : 'Start a session'}</p>
            </div>
          </div>
        </div>
        <div className="relative h-48 sm:h-60">
          <div className="absolute inset-0 bg-gradient-to-r from-sakura/30 to-aurora/20 blur-3xl" />
          <motion.div
            className="relative h-full w-full rounded-3xl overflow-hidden border border-white/10 bg-black/60"
            whileHover={{ rotateY: 6, rotateX: -3, scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 120, damping: 14 }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(255,100,200,0.1),transparent_45%)]" />
            <div className="h-full flex items-center justify-center">
              <motion.div
                className="h-40 w-28 sm:h-48 sm:w-32 rounded-2xl border border-white/10 bg-white/5 shadow-2xl flex items-center justify-center"
                variants={packVariants}
                animate={packStage}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedPackInfo.image}
                  alt={selectedPackInfo.name}
                  className="h-full w-full object-contain rounded-2xl"
                />
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <input
          value={clientSeed}
          onChange={(e) => setClientSeed(e.target.value)}
          placeholder="Client seed for provably-fair RNG"
          className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10"
        />
        <div className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={useUsdc} onChange={(e) => setUseUsdc(e.target.checked)} />
          <span>Pay with USDC</span>
        </div>
        <button onClick={handlePreview} className="px-4 py-3 rounded-xl bg-white/10 border border-white/10">Preview RNG</button>
        <button
          onClick={handleOpen}
          disabled={!connected || loading}
          className="px-5 py-3 rounded-xl bg-sakura text-ink font-semibold shadow-glow disabled:opacity-50"
        >
          {loading ? 'Building...' : 'Buy pack'}
        </button>
      </div>
      {sessionId && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-4 text-sm text-white/70 mt-3">
          <div className="font-semibold text-white">Active session</div>
          <div>
            Session ID: <span className="font-mono text-white/90">{sessionId}</span>
          </div>
          {countdown !== null && countdown > 0 && (
            <div>
              Time left: <span className="font-semibold text-white">{countdown}s</span>
            </div>
          )}
          <div className="text-white/60">
            Claim or sell back before buying another pack (auto-expire after 1 hour).
          </div>
        </div>
      )}
      {statusMsg && (
        <div
          className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${
            statusKind === 'error'
              ? 'border-red-400/70 bg-red-500/10 text-red-100'
              : 'border-aurora/50 bg-white/5 text-white/80'
          }`}
        >
          {statusMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-white/70">Reveal mode:</span>
        <button
          type="button"
          className={`px-4 py-2 rounded-xl border ${revealMode === 'fast' ? 'bg-aurora/30 border-aurora/50 text-white' : 'bg-white/5 border-white/10 text-white/70'}`}
          onClick={() => {
            setRevealMode('fast');
            setShowOneModal(false);
          }}
        >
          Fast mode (grid)
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded-xl border ${revealMode === 'one' ? 'bg-aurora/30 border-aurora/50 text-white' : 'bg-white/5 border-white/10 text-white/70'}`}
          onClick={() => {
            setRevealMode('one');
            if (enrichedSlots.length) setShowOneModal(true);
          }}
        >
          1-card mode (swipe/tap)
        </button>
      </div>

      <div className="grid md:grid-cols-4 lg:grid-cols-5 gap-4">
        {revealCards.map((card, i) => (
          <div
            key={i}
            onClick={() => {
              if (!revealed[i]) {
                revealCurrent(i);
              }
            }}
          >
            {card}
          </div>
        ))}
      </div>
      <p className="text-xs text-white/60">Flip by swipe/drag in 1-card mode; click a card in grid to reveal.</p>
      <AnimatePresence>
        {revealMode === 'one' && showOneModal && revealIndex >= 0 && revealIndex < enrichedSlots.length && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/80 backdrop-blur flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="relative w-full max-w-md card-blur border border-white/10 rounded-2xl p-4 flex flex-col gap-4"
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
            >
              <button
                type="button"
                className="absolute right-3 top-3 text-white/60 hover:text-white"
                onClick={() => setShowOneModal(false)}
              >
                ✕
              </button>
              {enrichedSlots[revealIndex] && (
                <>
                  <p className="text-xs uppercase text-white/60">Card {revealIndex + 1} of {enrichedSlots.length}</p>
                  <div className="relative">
                    <FlipModalCard
                      backImage="/card_back.png"
                      frontImage={enrichedSlots[revealIndex].image}
                      faceBack={modalFaceBack}
                      onAdvance={swipeAdvanceModal}
                    />
                    <div className="absolute bottom-2 inset-x-0 p-2 bg-gradient-to-t from-black/70 to-transparent rounded-b-2xl text-center">
                      <p className="text-xs text-white/70">{enrichedSlots[revealIndex].rarity}</p>
                      <p className="text-sm font-semibold">{enrichedSlots[revealIndex].displayName}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="cta-ghost flex-1"
                      onClick={() => {
                        setRevealIndex(enrichedSlots.length - 1);
                        setShowOneModal(false);
                        setRevealed(Array(enrichedSlots.length).fill(true));
                        setModalFaceBack(false);
                      }}
                    >
                      Skip all
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {proof && (
        <div className="card-blur rounded-2xl p-4 border border-white/5 text-sm text-white/80 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Provably-fair dashboard</p>
            <span className="text-xs text-white/50">Verify with hash + nonce</span>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <p className="text-xs text-white/60">server_seed_hash</p>
              <p className="break-all">{proof.server_seed_hash}</p>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <p className="text-xs text-white/60">server_nonce</p>
              <p className="break-all">{proof.server_nonce}</p>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <p className="text-xs text-white/60">client_seed</p>
              <p className="break-all">{clientProofSeed || clientSeed || 'n/a'}</p>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <p className="text-xs text-white/60">entropy_proof</p>
              <p className="break-all">{proof.entropy_proof}</p>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-xs text-white/70">
            <p className="font-semibold mb-1">How to verify</p>
            <ol className="list-decimal ml-5 space-y-1">
              <li>Compute `sha256(server_seed_hash:client_seed)` → server_nonce (should match).</li>
              <li>Compute `sha256(server_seed:client_seed:server_nonce)` → entropy_proof.</li>
              <li>Use entropy_proof to seed RNG and reproduce slot rarities.</li>
            </ol>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleClaim}
          disabled={!sessionId}
          className="px-5 py-3 rounded-xl bg-aurora text-ink font-semibold disabled:opacity-50"
        >
          Keep cards
        </button>
        <button
          onClick={handleSellback}
          disabled={!sessionId}
          className="px-5 py-3 rounded-xl border border-white/20 hover:border-sakura text-white disabled:opacity-50"
        >
          Instant sell-back (90%)
        </button>
      </div>
    </div>
  );
}
