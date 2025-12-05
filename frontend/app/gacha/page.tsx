'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  api,
  buildPack,
  claimPack,
  previewPack,
  sellbackPack,
  expirePack,
  PackSlot,
  fetchActiveSession,
  confirmOpen,
  confirmClaim,
  confirmExpire,
} from '../../lib/api';
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
    const data = axiosErr?.response?.data as any;
    const detail =
      (data && (data.detail || data.message)) ||
      (Array.isArray(data?.detail) ? data.detail.map((d: any) => d.msg || JSON.stringify(d)).join('; ') : null);
    if (detail) {
      const msg = String(detail);
      if (msg.toLowerCase().includes('cardnotavailable') || msg.toLowerCase().includes('card not available') || msg.includes('6004') || msg.includes('0x1774')) {
        return 'Pack inventory busy. Please try again in a moment (we are refreshing the vault cards).';
      }
      return msg;
    }
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
        className="cursor-grab active:cursor-grabbing"
        style={{
          width: '100%',
          maxWidth: '360px',
          aspectRatio: '2/3',
          position: 'relative',
          transformStyle: 'preserve-3d',
          touchAction: 'none',
        }}
        animate={{ rotateY: faceBack ? 0 : 180, x: 0 }}
        transition={{ duration: 0.6 }}
        drag
        dragConstraints={{ left: -200, right: 200, top: -200, bottom: 200 }}
        dragElastic={0.22}
        dragMomentum={false}
        dragSnapToOrigin
        whileDrag={{ rotateX: -16, scale: 0.99 }}
        onClick={onAdvance}
        onDragEnd={(_, info) => {
          const threshold = 10;
          const velocityThreshold = 120;
          const dist = Math.hypot(info.offset.x, info.offset.y);
          if (dist > threshold || Math.hypot(info.velocity.x, info.velocity.y) > velocityThreshold) {
            onAdvance();
          }
        }}
        >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backImage}
            alt="card back"
            className="w-full h-full object-contain rounded-2xl"
            style={{ display: 'block', width: '100%', height: '100%' }}
            draggable={false}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frontImage}
            alt="card front"
            className="w-full h-full object-contain rounded-2xl"
            style={{ display: 'block', width: '100%', height: '100%' }}
            draggable={false}
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
  const [openLoading, setOpenLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [sellbackLoading, setSellbackLoading] = useState(false);
  const [expireLoading, setExpireLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [proof, setProof] = useState<{ server_seed_hash: string; server_nonce: string; entropy_proof: string } | null>(null);
  const [clientProofSeed, setClientProofSeed] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'info' | 'error'>('info');
  const [useUsdc, setUseUsdc] = useState(false);
  const [testModeMsg, setTestModeMsg] = useState<string | null>(null);
  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT ? new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT) : null;
  const [packStage, setPackStage] = useState<'idle' | 'swing' | 'tear' | 'reveal'>('idle');
  const [revealIndex, setRevealIndex] = useState<number>(-1);
  const [revealMode, setRevealMode] = useState<'fast' | 'one'>('one'); // fast mode temporarily disabled in UI
  const [showOneModal, setShowOneModal] = useState(false);
  const [templatesByPack, setTemplatesByPack] = useState<Record<string, Record<number, { name: string; image: string; rarity: string }>>>({});
  const [revealed, setRevealed] = useState<boolean[]>([]);
  const [modalFaceBack, setModalFaceBack] = useState(true);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [openSignature, setOpenSignature] = useState<string | null>(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [opening, setOpening] = useState(false);
  const packOptions = useMemo(
    () => [
      { id: 'meg_web_alt', name: 'Mega Evolutions Pack', priceSol: 0.12, priceUsdc: 12, image: '/img/pack_alt.jpg' },
    ],
    []
  );
  const [selectedPack, setSelectedPack] = useState<string>('meg_web_alt');
  const resetSessionState = useCallback(() => {
    setSessionId(null);
    setSlots([]);
    setRevealed([]);
    setRevealIndex(-1);
    setShowOneModal(false);
    setProof(null);
    setClientProofSeed('');
    setCountdown(null);
    setPackStage('idle');
    setOpenSignature(null);
    setConfirmDone(false);
  }, []);

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

  const hydrateSession = useCallback(
    async ({ interactive = false, fresh = false }: { interactive?: boolean; fresh?: boolean } = {}) => {
      if (!publicKey) return;
      if (interactive) {
        setResumeLoading(true);
        setStatusMsg(null);
      }
      try {
        const pending = await fetchActiveSession(publicKey.toBase58());
        setSessionId(pending.session_id);
        setSlots(pending.lineup);
        setRevealed(Array(pending.lineup.length).fill(fresh ? false : true));
        setRevealIndex(fresh ? 0 : pending.lineup.length - 1);
        setModalFaceBack(fresh ? true : false);
        setShowOneModal(fresh ? revealMode === 'one' : false);
        setPackStage('reveal');
        setCountdown(pending.countdown_seconds);
        const fair = pending.provably_fair || {};
        setProof({
          server_seed_hash: fair.server_seed_hash || '',
          server_nonce: fair.server_nonce || '',
          entropy_proof: fair.entropy_proof || fair.assets || '',
        });
        setClientProofSeed('');
        setConfirmDone(true); // session exists on-chain; allow claim/sell
        if (interactive) {
          setStatusKind('info');
          setStatusMsg(fresh ? 'Pack opened and locked. Reveal, then claim or sell back.' : 'Resumed your pending pack session. Claim or sell back before the timer ends.');
        }
      } catch (err) {
        const axiosErr = err as AxiosError;
        if (axiosErr?.response?.status === 404) {
          if (interactive) {
            setStatusKind('error');
            setStatusMsg('No active session to resume.');
          }
          resetSessionState();
        } else {
          console.error('resume error', err);
          setStatusKind('error');
          setStatusMsg(extractErrorMessage(err));
        }
      } finally {
        if (interactive) {
          setResumeLoading(false);
        }
      }
    },
    [publicKey, resetSessionState, revealMode],
  );

  const waitForSession = useCallback(
    async (attempts: number = 8, delayMs: number = 1200) => {
      if (!publicKey) return null;
      for (let i = 0; i < attempts; i += 1) {
        try {
          const pending = await fetchActiveSession(publicKey.toBase58());
          return pending;
        } catch (err) {
          const axiosErr = err as AxiosError;
          if (axiosErr?.response?.status !== 404) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      return null;
    },
    [publicKey],
  );

  useEffect(() => {
    if (!publicKey) {
      resetSessionState();
      return;
    }
    hydrateSession();
  }, [publicKey, hydrateSession, resetSessionState]);

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
    if (!connected || !publicKey || openLoading) return;
    if (sessionId) {
      setStatusKind('error');
      setStatusMsg('Finish or cancel your current pack before buying another.');
      return;
    }
    setOpenSignature(null);
    setConfirmDone(false);
    setOpening(true);
    setOpenLoading(true);
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
      const buildRes = await buildPack(
        clientSeed || crypto.randomUUID(),
        publicKey.toBase58(),
        useUsdc ? 'USDC' : 'SOL',
        userToken,
        vaultToken,
        currencyMint
      );
      const raritiesForConfirm = buildRes.lineup.map((s) => s.rarity);
      const templateIdsForConfirm = buildRes.lineup.map((s) => (s.template_id === undefined ? null : s.template_id));
      const serverNonceForConfirm = buildRes.provably_fair?.server_nonce;
      // Do not render lineup/session yet; wait for on-chain confirmation.
      // Sign and send open pack transaction
      const tx = buildV0Tx(publicKey, buildRes.recent_blockhash, buildRes.instructions);
      if (!signTransaction) {
        throw new Error('Wallet is not ready to sign transactions.');
      }
        setStatusKind('info');
        setStatusMsg('Awaiting wallet signature…');
        const signed = await signTransaction(tx);
        setStatusMsg('Submitting transaction…');
      let sig: string | null = null;
      try {
        sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      } catch (sendErr) {
        console.error('sendTransaction failed', sendErr);
        setStatusKind('error');
        setStatusMsg(extractErrorMessage(sendErr));
        resetSessionState();
        return;
      }
      if (!sig) {
        setStatusKind('error');
        setStatusMsg('Transaction not submitted. Please try again.');
        resetSessionState();
        return;
      }
      setOpenSignature(sig);
      setConfirmDone(false);
      // Auto-confirm immediately
      try {
        setConfirmLoading(true);
        setStatusMsg('Waiting for your pack to finalize on-chain…');
        const confirmRes = await confirmOpen(
          sig,
          publicKey.toBase58(),
          raritiesForConfirm,
          templateIdsForConfirm,
          serverNonceForConfirm,
        );
        if (!confirmRes || !confirmRes.state) {
          throw new Error('Confirm failed – no state returned.');
        }
        setConfirmDone(true);
        await hydrateSession({ interactive: true, fresh: true });
        setStatusKind('info');
        setStatusMsg('Pack opened and locked. Reveal, then claim or sell back.');
      } catch (err) {
        console.error('confirm open error', err);
        setStatusKind('info');
        setStatusMsg('Finalizing pack on-chain… this can take a few seconds. Auto-resuming.');
        try {
          const pending = await waitForSession();
          if (!pending) {
            throw err;
          }
          setSessionId(pending.session_id);
          setSlots(pending.lineup);
          setRevealed(Array(pending.lineup.length).fill(true));
          setRevealIndex(pending.lineup.length - 1);
          setModalFaceBack(false);
          setShowOneModal(false);
          setPackStage('reveal');
          setCountdown(pending.countdown_seconds);
          const fair = pending.provably_fair || {};
          setProof({
            server_seed_hash: fair.server_seed_hash || '',
            server_nonce: fair.server_nonce || '',
            entropy_proof: fair.entropy_proof || fair.assets || '',
          });
          setConfirmDone(true);
          setStatusKind('info');
          setStatusMsg('Session detected on-chain. Reveal, then claim or sell back.');
        } catch (resumeErr) {
          console.error('auto-resume after confirm failure', resumeErr);
          // Clear any local session state to avoid ghost sessions.
          resetSessionState();
          setStatusMsg(`${extractErrorMessage(err)}. If stuck, try Sell Back or wait for expiry.`);
        }
      } finally {
        setConfirmLoading(false);
      }
    } catch (e) {
      console.error(e);
      setStatusKind('error');
      setStatusMsg(extractErrorMessage(e));
      resetSessionState();
    } finally {
      setOpenLoading(false);
      setOpening(false);
    }
  };

  const handleReset = async () => {
    setStatusKind('error');
    setStatusMsg('Reset is disabled (v1 removed). If stuck, wait for expiry or use sell back.');
  };

  const handleClaim = async () => {
    if (!publicKey || claimLoading) return;
    if (!confirmDone) {
      setStatusKind('error');
      setStatusMsg('Please confirm cards before claiming.');
      return;
    }
    setClaimLoading(true);
    try {
      setStatusKind('info');
      setStatusMsg('Building claim transaction…');
      const res = await claimPack(publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      setStatusMsg('Submitting claim…');
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      await confirmClaim(sig, publicKey.toBase58(), 'claim').catch(async () => {
        await api.post('/program/v2/claim/cleanup', { wallet: publicKey.toBase58() });
      });
      setStatusMsg(`Claimed! Tx: ${sig}`);
      resetSessionState();
      hydrateSession();
    } catch (e) {
      console.error('claim error', e);
      setStatusKind('error');
      setStatusMsg(extractErrorMessage(e));
    } finally {
      setClaimLoading(false);
    }
  };

  const handleSellback = async () => {
    if (!publicKey || sellbackLoading) return;
    if (!confirmDone) {
      setStatusKind('error');
      setStatusMsg('Please confirm cards before sell-back.');
      return;
    }
    setSellbackLoading(true);
    try {
      setStatusKind('info');
      setStatusMsg('Building sell-back transaction…');
      let userToken: string | undefined;
      let vaultToken: string | undefined;
      if (useUsdc && usdcMint) {
        const userAta = await deriveAta(publicKey, usdcMint);
        const vaultAta = await deriveAta(vaultAuthorityPk(), usdcMint);
        userToken = userAta.toBase58();
        vaultToken = vaultAta.toBase58();
      }
      const res = await sellbackPack(publicKey.toBase58(), userToken, vaultToken);
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      setStatusMsg('Submitting sell-back transaction…');
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      await confirmClaim(sig, publicKey.toBase58(), 'sellback').catch(async () => {
        await api.post('/program/v2/claim/cleanup', { wallet: publicKey.toBase58() });
      });
      setStatusMsg(`Sell-back tx: ${sig}`);
      resetSessionState();
    } catch (e) {
      console.error('sellback error', e);
      setStatusKind('error');
      setStatusMsg(extractErrorMessage(e));
    } finally {
      setSellbackLoading(false);
    }
  };

  const handleExpire = async () => {
    if (!publicKey || expireLoading) return;
    setExpireLoading(true);
    try {
      setStatusKind('info');
      setStatusMsg('Building expire transaction…');
      const res = await expirePack(publicKey.toBase58());
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      const signed = signTransaction ? await signTransaction(tx) : tx;
      setStatusMsg('Submitting expire transaction…');
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      await confirmExpire(sig, publicKey.toBase58());
      setStatusMsg(`Expire session tx: ${sig}`);
      resetSessionState();
    } catch (e) {
      console.error('expire error', e);
      setStatusKind('error');
      setStatusMsg(extractErrorMessage(e));
    } finally {
      setExpireLoading(false);
    }
  };

  const handleTestPurchase = () => {
    // Local-only pack to exercise the UI without chain calls.
    setStatusKind('info');
    setStatusMsg('Test pack: UI-only, no chain calls.');
    setTestModeMsg('Demo pack loaded – flip/swipe to test the UI.');
    const dummySlots: PackSlot[] = Array.from({ length: 11 }).map((_, i) => ({
      slot_index: i,
      rarity: ['Common', 'Uncommon', 'Rare', 'UltraRare'][i % 4],
      template_id: i + 1,
    }));
    setSlots(dummySlots);
    setRevealed(Array(dummySlots.length).fill(false));
    setRevealIndex(0);
    setModalFaceBack(true);
    if (revealMode === 'one') setShowOneModal(true);
    setSessionId('test-session');
    setCountdown(3600);
    setProof({
      server_seed_hash: 'test-hash',
      server_nonce: 'test-nonce',
      entropy_proof: 'test-entropy',
    });
    setClientProofSeed('test-seed');
    setPackStage('swing');
    setTimeout(() => setPackStage('tear'), 800);
    setTimeout(() => setPackStage('reveal'), 1500);
  };

  const enrichedSlots = useMemo(() => {
    const templateMap =
      templatesByPack[selectedPack] || templatesByPack['meg_web'] || {};
    return slots.map((slot, idx) => {
      const template = slot.template_id ? templateMap[slot.template_id] : undefined;
      const isRevealed = revealed[idx];
      const isNft = !!slot.is_nft || ['rare','doublerare','ultrarare','illustrationrare','specialillustrationrare','megahyperrare'].includes((slot.rarity || '').replace(/\\s+/g,'').toLowerCase());
      return {
        ...slot,
        displayName: template?.name || `Template ${slot.template_id ?? 'TBD'}`,
        image: isRevealed ? template?.image || '/card_back.png' : '/card_back.png',
        revealed: isRevealed,
        is_nft: isNft,
        badge: isNft ? 'NFT' : 'Virtual',
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
      <div className={`h-full w-full rounded-2xl bg-gradient-to-br ${rarityColors[slot.rarity] || 'from-white/10 to-white/5'} flex flex-col justify-between p-2 overflow-hidden ${rarityGlowClass(slot.rarity)}`}>
        <div className="flex items-center justify-between px-2 pt-2 text-xs uppercase">
          <span className={`${i <= revealIndex ? 'text-white/80' : 'text-white/40'}`}>Slot {i + 1}</span>
          <span className={`px-2 py-1 rounded-full text-[10px] font-semibold ${slot.is_nft ? 'bg-aurora/40 text-white' : 'bg-white/20 text-white/80'}`}>
            {slot.is_nft ? 'NFT' : 'Virtual'}
          </span>
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
      {opening && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/10 bg-white/10 px-6 py-4 text-white space-y-2">
            <p className="text-lg font-semibold">Opening pack…</p>
            <p className="text-sm text-white/70">Waiting for the transaction to confirm on-chain.</p>
          </div>
        </div>
      )}
      <div className="card-blur rounded-3xl p-6 border border-white/5 grid lg:grid-cols-[1.1fr,0.9fr] gap-6 items-center">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <img src="/mochi_icon.png" alt="Mochi icon" className="h-10 w-10 rounded-full" />
            <div>
              <p className="text-sm uppercase text-white/60 tracking-[0.2em]">Mega Evolutions Pack</p>
              <p className="text-xl font-semibold">11 cards</p>
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
        <button
          onClick={handlePreview}
          className="px-4 py-3 rounded-xl bg-white/10 border border-white/10"
        >
          Preview RNG
        </button>
        <button
          onClick={handleOpen}
          disabled={!connected || openLoading || !!sessionId}
          className="px-5 py-3 rounded-xl bg-sakura text-ink font-semibold shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sessionId ? 'Session active' : openLoading ? 'Awaiting wallet…' : 'Buy pack'}
        </button>
      </div>
      <div className="flex gap-3">
        <button
          onClick={handleTestPurchase}
          className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm"
          type="button"
        >
          Demo / Test Pack – No Deduction
        </button>
        {testModeMsg && <p className="text-sm text-white/60">{testModeMsg}</p>}
      </div>
      {connected && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => hydrateSession({ interactive: true })}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={resumeLoading || !publicKey}
          >
            {resumeLoading ? 'Resuming…' : 'Resume pending pack'}
          </button>
          <p className="text-xs text-white/60">Use this if you refreshed mid-pack or need to reload the lineup.</p>
        </div>
      )}
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
          <div className="text-white/60">Cards auto-verify after purchase. If stuck, use Sell Back or wait for expiry.</div>
          {openSignature && <span className="text-xs text-white/60 break-all">Open tx: {openSignature}</span>}
          {confirmLoading && <span className="text-xs text-white/60">Verifying cards…</span>}
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
          className="px-4 py-2 rounded-xl border bg-white/5 border-white/10 text-white/40 cursor-not-allowed"
          disabled
        >
          Fast mode (coming soon)
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
          disabled={!sessionId || claimLoading || !confirmDone}
          className="px-5 py-3 rounded-xl bg-aurora text-ink font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {claimLoading ? 'Claiming…' : confirmDone ? 'Keep cards' : 'Confirm cards first'}
        </button>
        <button
          onClick={handleSellback}
          disabled={!sessionId || sellbackLoading || !confirmDone}
          className="px-5 py-3 rounded-xl border border-white/20 hover:border-sakura text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sellbackLoading ? 'Processing…' : 'Instant sell-back (90%)'}
        </button>
        <button
          onClick={handleExpire}
          disabled={!sessionId || !publicKey || (countdown !== null && countdown > 0) || expireLoading}
          className="px-5 py-3 rounded-xl border border-white/20 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {expireLoading ? 'Expiring…' : 'Expire session'}
        </button>
      </div>
    </div>
  );
}
