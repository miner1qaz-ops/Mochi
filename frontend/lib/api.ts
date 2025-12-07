import axios from 'axios';

// Default to relative /api so browser calls hit the nginx proxy (fixes localhost issues in production).
const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL && process.env.NEXT_PUBLIC_BACKEND_URL !== ''
    ? process.env.NEXT_PUBLIC_BACKEND_URL
    : '/api';

export const api = axios.create({ baseURL: API_BASE });

export type PackSlot = { slot_index: number; rarity: string; template_id?: number | null; is_nft?: boolean };
export type InstructionMeta = { program_id: string; keys: { pubkey: string; is_signer: boolean; is_writable: boolean }[]; data: string };
export type PendingSession = {
  session_id: string;
  wallet: string;
  expires_at: number;
  countdown_seconds: number;
  lineup: PackSlot[];
  asset_ids: string[];
  provably_fair: Record<string, string>;
};

export type VirtualCard = { template_id: number; rarity: string; count: number; name?: string; image_url?: string; is_energy?: boolean };
export type Listing = {
  core_asset: string;
  price_lamports: number;
  seller?: string;
  status: string;
  currency_mint?: string;
  template_id?: number;
  rarity?: string;
  name?: string;
  image_url?: string;
  is_fake?: boolean;
};

export type GarbageListing = {
  listing: string;
  vault_state: string;
  seller: string;
  core_asset: string;
  price_lamports?: number;
  status?: string;
};

export type SeedSaleState = {
  sale: string;
  authority: string;
  mint: string;
  seed_vault: string;
  vault_authority: string;
  treasury: string;
  start_ts: number;
  end_ts: number;
  price_tokens_per_sol: number;
  token_cap: number;
  sol_cap_lamports: number;
  sold_tokens: number;
  raised_lamports: number;
  is_canceled: boolean;
  vault_balance?: number | null;
  treasury_balance?: number | null;
  contributor_count?: number | null;
  tokens_remaining?: number | null;
  sol_remaining?: number | null;
  token_decimals: number;
  user_contribution?: {
    buyer: string;
    contributed_lamports: number;
    tokens_owed: number;
    claimed: boolean;
    pda: string;
  } | null;
};

export type SeedContributeBuild = {
  tx_b64: string;
  tx_v0_b64: string;
  recent_blockhash: string;
  instructions: InstructionMeta[];
  lamports: number;
  tokens_owed: number;
  sale: string;
  mint: string;
  start_ts: number;
  end_ts: number;
  contribution_pda: string;
};

export type SeedClaimBuild = {
  tx_b64: string;
  tx_v0_b64: string;
  recent_blockhash: string;
  instructions: InstructionMeta[];
  claimable_tokens: number;
  sale: string;
  mint: string;
  user_ata: string;
  contribution_pda: string;
};

export type PricingSearchResult = {
  template_id: number;
  name: string;
  set_name?: string | null;
  rarity?: string | null;
  image_url?: string | null;
  mid_price?: number | null;
  low_price?: number | null;
  high_price?: number | null;
  collected_at?: number | null;
  display_price?: number | null;
  fair_value?: number | null;
  price_confidence?: string | null;
  confidence_score?: string | null;
  sparkline?: PricingHistoryPoint[];
};

export type PricingCardDetail = {
  template_id: number;
  source: string;
  currency: string;
  mid_price: number;
  low_price: number;
  high_price: number;
  collected_at: number;
  display_price: number;
   fair_value: number;
  avg_7d: number;
  avg_30d: number;
  spread_ratio?: number | null;
  price_confidence: string;
  confidence_score?: string | null;
};

export type PricingHistoryPoint = {
  mid_price: number;
  low_price: number;
  high_price: number;
  collected_at: number;
  fair_value: number;
};

export type PricingPortfolioBreakdown = {
  template_id: number;
  name?: string | null;
  count: number;
  mid_price: number;
  fair_value: number;
  confidence_score?: string | null;
  total_value_usd: number;
  image_url?: string | null;
};

export type PricingStats = {
  portfolio_total: number;
  change_24h?: number | null;
  last_valuation_at: number;
  breakdown: PricingPortfolioBreakdown[];
};

export type PortfolioHoldings = {
  total_value_usd: number;
  breakdown: PricingPortfolioBreakdown[];
};

export type PortfolioTopHolding = {
  template_id: number;
  name?: string | null;
  count: number;
  fair_value: number;
  total_value_usd: number;
  image_url?: string | null;
};

export type PortfolioSummary = {
  total_value_usd: number;
  total_nfts: number;
  total_virtual: number;
  sparkline: number[];
  top_holdings: PortfolioTopHolding[];
};

export type MarketCardListing = {
  core_asset: string;
  price_lamports: number;
  seller?: string | null;
  currency_mint?: string | null;
  is_fake?: boolean;
};

export type MarketCardSummary = {
  template_id: number;
  name: string;
  set_name?: string | null;
  rarity?: string | null;
  image_url?: string | null;
  fair_price?: number | null;
  lowest_listing?: number | null;
  listing_count: number;
  sparkline: PricingHistoryPoint[];
  is_fake?: boolean;
};

export type MarketCardDetail = {
  template_id: number;
  name: string;
  set_name?: string | null;
  rarity?: string | null;
  image_url?: string | null;
  fair_price?: number | null;
  confidence?: string | null;
  change_24h?: number | null;
  change_7d?: number | null;
  change_30d?: number | null;
  history: PricingHistoryPoint[];
  listings: MarketCardListing[];
  my_assets?: string[] | null;
  lowest_listing?: number | null;
  listing_count: number;
  is_fake?: boolean;
};

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
) {
  const { data } = await api.post('/program/v2/open/build', {
    client_seed,
    wallet,
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

export async function claimPack(wallet: string) {
  const { data } = await api.post('/program/v2/claim/build', { wallet });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}

export async function sellbackPack(wallet: string, user_token_account?: string, vault_token_account?: string) {
  const { data } = await api.post('/program/v2/sellback/build', { wallet, user_token_account, vault_token_account });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}

export async function fetchInventoryRarity(): Promise<Record<string, number>> {
  const { data } = await api.get('/admin/inventory/rarity');
  return data as Record<string, number>;
}

export async function expirePack(wallet: string) {
  const { data } = await api.post('/program/v2/expire/build', { wallet });
  return data as { tx_b64: string; tx_v0_b64: string; recent_blockhash: string; instructions: InstructionMeta[] };
}

export async function fetchActiveSession(wallet: string) {
  const { data } = await api.get('/program/v2/session/pending', { params: { wallet } });
  return data as PendingSession;
}

export async function confirmOpen(
  signature: string,
  wallet: string,
  rarities?: string[],
  template_ids?: Array<number | null>,
  server_nonce?: string,
) {
  const { data } = await api.post('/program/v2/open/confirm', { signature, wallet, rarities, template_ids, server_nonce });
  return data as { state: string; assets: string[] };
}

export async function confirmClaim(signature: string, wallet: string, action: 'claim' | 'sellback' = 'claim') {
  const endpoint = action === 'claim' ? '/program/v2/claim/confirm' : '/program/v2/sellback/confirm';
  const { data } = await api.post(endpoint, { signature, wallet });
  return data as { state: string; assets: string[] };
}

export async function confirmExpire(signature: string, wallet: string) {
  const { data } = await api.post('/program/v2/expire/confirm', { signature, wallet });
  return data as { state: string; assets: string[] };
}

export async function fetchVirtualCards(wallet: string) {
  const { data } = await api.get(`/profile/${wallet}/virtual`);
  return data as VirtualCard[];
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

export async function fetchGarbageListings() {
  const { data } = await api.get('/admin/marketplace/garbage');
  return data as GarbageListing[];
}

export async function forceCancelGarbage(assets: string[], vault_state?: string) {
  const { data } = await api.post('/admin/marketplace/force_cancel', { assets, vault_state });
  return data as { ok: Array<{ asset: string; signature: string }>; errors: Array<{ asset: string; error: string }> };
}

export async function fetchListings() {
  const { data } = await api.get('/marketplace/listings');
  return data as Listing[];
}

export async function fetchPricesMock() {
  const { data } = await api.post('/pricing/fetch', {});
  return data as { ok: boolean; snapshots: number; source: string };
}

export async function searchPrices(query: string, limit: number = 20) {
  const { data } = await api.get('/pricing/search', { params: { q: query, limit } });
  return data as PricingSearchResult[];
}

export async function fetchPricingBySet(setName: string, limit: number = 200) {
  const { data } = await api.get('/pricing/set', { params: { set_name: setName, limit } });
  return data as PricingSearchResult[];
}

export async function fetchPricingSets() {
  const { data } = await api.get('/pricing/sets');
  return data as string[];
}

export async function fetchPricingCard(templateId: number) {
  const { data } = await api.get(`/pricing/card/${templateId}`);
  return data as PricingCardDetail;
}

export async function fetchPricingHistory(templateId: number) {
  const { data } = await api.get(`/pricing/card/${templateId}/history`);
  return data as PricingHistoryPoint[];
}

export async function fetchPricingSparklines(templateIds: number[], points: number = 30) {
  const ids = templateIds.join(',');
  const { data } = await api.get('/pricing/sparklines', { params: { template_ids: ids, points } });
  return data as { template_id: number; points: PricingHistoryPoint[] }[];
}

export async function fetchPricingStats(wallet: string) {
  const { data } = await api.get('/pricing/stats', { params: { wallet } });
  return data as PricingStats;
}

export async function fetchPortfolioSummary(wallet: string) {
  const { data } = await api.get('/portfolio/summary', { params: { wallet } });
  return data as PortfolioSummary;
}

export async function fetchPortfolioHoldings(wallet: string) {
  const { data } = await api.get('/portfolio/holdings', { params: { wallet } });
  return data as PortfolioHoldings;
}

export async function fetchMarketCards(params: { q?: string; set_name?: string; rarity?: string; sort?: string; listed_only?: boolean }) {
  const { data } = await api.get('/market/cards', { params });
  return data as MarketCardSummary[];
}

export async function fetchMarketCard(templateId: number, opts?: { days?: number; wallet?: string }) {
  const { data } = await api.get(`/market/card/${templateId}`, { params: opts });
  return data as MarketCardDetail;
}

export async function fetchSeedSaleState(wallet?: string) {
  const { data } = await api.get('/seed_sale/state', { params: wallet ? { wallet } : undefined });
  return data as SeedSaleState;
}

export async function buildSeedContribute(wallet: string, lamports?: number, sol?: number) {
  const payload: any = { wallet };
  if (lamports !== undefined) payload.lamports = lamports;
  if (sol !== undefined) payload.sol = sol;
  const { data } = await api.post('/seed_sale/contribute/build', payload);
  return data as SeedContributeBuild;
}

export async function buildSeedClaim(wallet: string, user_token_account?: string) {
  const { data } = await api.post('/seed_sale/claim/build', { wallet, user_token_account });
  return data as SeedClaimBuild;
}
