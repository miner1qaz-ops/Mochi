'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildPack, claimPack, previewPack, sellbackPack, PackSlot } from '../../lib/api';
import { buildV0Tx } from '../../lib/tx';
import { deriveAta } from '../../lib/ata';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

// vault_authority PDA derives from program id; until we pull it from backend, we reconstruct here
const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const VAULT_STATE_SEED = 'vault_state';

function vaultAuthorityPk() {
  const vaultState = PublicKey.findProgramAddressSync([Buffer.from(VAULT_STATE_SEED)], PROGRAM_ID)[0];
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault_authority'), vaultState.toBuffer()], PROGRAM_ID);
  return pda;
}

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
  const [useUsdc, setUseUsdc] = useState(false);
  const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT ? new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT) : null;

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown && countdown > 0) {
      timer = setInterval(() => setCountdown((c) => (c ? c - 1 : 0)), 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const handlePreview = async () => {
    const seed = clientSeed || crypto.randomUUID();
    setClientSeed(seed);
    const res = await previewPack(seed, publicKey?.toBase58() || '');
    setSlots(res.slots);
    setProof({ server_seed_hash: res.server_seed_hash, server_nonce: res.server_nonce, entropy_proof: res.entropy_proof });
    setClientProofSeed(seed);
  };

  const handleOpen = async () => {
    if (!connected || !publicKey) return;
    setLoading(true);
    try {
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
      const res = await buildPack(clientSeed || crypto.randomUUID(), publicKey.toBase58(), useUsdc ? 'USDC' : 'SOL', userToken, vaultToken, currencyMint);
      setSlots(res.lineup);
      setSessionId(res.session_id);
      setCountdown(3600);
      setProof({
        server_seed_hash: res.provably_fair.server_seed_hash,
        server_nonce: res.provably_fair.server_nonce,
        entropy_proof: res.provably_fair.entropy_proof,
      });
      setClientProofSeed(clientSeed || '');
      // Sign and send open pack transaction
      const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
      if (signTransaction) {
        const signed = await signTransaction(tx);
        const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
        setStatusMsg(`Pack opened tx: ${sig}`);
      }
    } catch (e) {
      console.error(e);
      setStatusMsg('Open pack failed');
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
      setStatusMsg(`Claim tx: ${sig}`);
    } catch (e) {
      console.error('claim error', e);
      setStatusMsg('Claim failed');
    }
  };

  const handleSellback = async () => {
    if (!sessionId || !publicKey) return;
    const res = await sellbackPack(sessionId, publicKey.toBase58());
    const tx = buildV0Tx(publicKey, res.recent_blockhash, res.instructions);
    try {
      const signed = signTransaction ? await signTransaction(tx) : tx;
      const sig = await connection.sendTransaction(signed, { skipPreflight: false, maxRetries: 3 });
      setStatusMsg(`Sellback tx: ${sig}`);
    } catch (e) {
      console.error('sellback error', e);
      setStatusMsg('Sellback failed');
    }
  };

  const revealCards = slots.map((slot, i) => (
    <motion.div
      key={i}
      className="rounded-3xl p-4 aspect-[2/3] card-blur border border-white/5 cursor-pointer"
      whileHover={{ rotate: -1, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className={`h-full w-full rounded-2xl bg-gradient-to-br ${rarityColors[slot.rarity] || 'from-white/10 to-white/5'} flex flex-col justify-between p-4`}>
        <div className="text-xs uppercase text-white/60">Slot {i + 1}</div>
        <div>
          <p className="text-sm text-white/60">{slot.rarity}</p>
          <p className="text-lg font-semibold">Template {slot.template_id ?? 'TBD'}</p>
        </div>
      </div>
    </motion.div>
  ));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Open Gacha Pack</h1>
          <p className="text-white/60">11 cards • 1 hour decision window • 90% instant sell-back</p>
        </div>
        <div className="text-right text-white/80">
          <p className="text-lg font-semibold">Price: 0.1 SOL / 10 USDC</p>
          {countdown !== null && <p className="text-xs text-sakura">Decision timer: {Math.max(countdown, 0)}s</p>}
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

      <div className="grid md:grid-cols-4 lg:grid-cols-5 gap-4">{revealCards}</div>
      {statusMsg && <p className="text-sm text-white/60">{statusMsg}</p>}

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
