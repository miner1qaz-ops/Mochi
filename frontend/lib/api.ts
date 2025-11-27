import axios from 'axios';

// Default to relative /api so browser calls hit the nginx proxy (fixes localhost issues in production).
const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL && process.env.NEXT_PUBLIC_BACKEND_URL !== ''
    ? process.env.NEXT_PUBLIC_BACKEND_URL
    : '/api';

export const api = axios.create({ baseURL: API_BASE });

export type PackSlot = { slot_index: number; rarity: string; template_id?: number | null };
export type InstructionMeta = { program_id: string; keys: { pubkey: string; is_signer: boolean; is_writable: boolean }[]; data: string };

export async function previewPack(client_seed: string, wallet: string, pack_type: string = 'meg_web') {
  const { data } = await api.post('/program/open/preview', { client_seed, wallet, pack_type });
  return data as { server_seed_hash: string; server_nonce: string; entropy_proof: string; slots: PackSlot[] };
}

export async function buildPack(
  client_seed: string,
  wallet: string,
  currency: 'SOL' | 'USDC',
  user_token_account?: string,
  vault_token_account?: string,
  currency_mint?: string,
  pack_type: string = 'meg_web',
) {
  const { data } = await api.post('/program/open/build', {
    client_seed,
    wallet,
    pack_type,
    currency,
    user_token_account,
    vault_token_account,
    currency_mint,
  });
  return data as {
    tx_b64: string;
    tx_v0_b64: string;
    recent_blockhash: string;
    session_id: string;
    lineup: PackSlot[];
    provably_fair: Record<string, string>;
    instructions: InstructionMeta[];
  };
}

export async function claimPack(session_id: string, wallet: string) {
  const { data } = await api.post('/program/claim/build', { session_id, wallet });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}

export async function sellbackPack(session_id: string, wallet: string) {
  const { data } = await api.post('/program/sellback/build', { session_id, wallet });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}

export async function listCard(core_asset: string, wallet: string, price_lamports: number, currency_mint?: string) {
  const { data } = await api.post('/marketplace/list/build', {
    core_asset,
    wallet,
    price_lamports,
    currency_mint,
  });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}

export async function fillListing(core_asset: string, wallet: string) {
  const { data } = await api.post('/marketplace/fill/build', { core_asset, wallet });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}

export async function cancelListing(core_asset: string, wallet: string) {
  const { data } = await api.post('/marketplace/cancel/build', { core_asset, wallet });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}
