from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import time
import uuid
from typing import Dict, List, Optional, Sequence, Tuple

import requests
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel
from pydantic_settings import BaseSettings
import re
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.instruction import Instruction, AccountMeta
from solders.keypair import Keypair as SoldersKeypair
from solders.hash import Hash
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from solders.compute_budget import set_compute_unit_limit
from solana.rpc.api import Client as SolanaClient
from solana.rpc.types import TxOpts, MemcmpOpts
from sqlalchemy import Index, text
from sqlmodel import Field, Session, SQLModel, create_engine, select, func

from tx_builder import (
    build_admin_force_expire_ix,
    build_admin_force_close_session_ix,
    build_admin_force_close_v2_ix,
    build_admin_reset_session_ix,
    build_admin_force_cancel_listing_ix,
    build_admin_prune_listing_ix,
    build_user_reset_session_ix,
    build_expire_session_ix,
    build_expire_session_v2_ix,
    build_claim_pack_ix,
    build_claim_pack_v2_ix,
    build_fill_listing_ix,
    build_list_card_ix,
    build_cancel_listing_ix,
    build_open_pack_ix,
    build_open_pack_v2_ix,
    build_sellback_pack_ix,
    build_sellback_pack_v2_ix,
    build_seed_claim_ix,
    build_seed_contribute_ix,
    card_record_pda,
    instruction_to_dict,
    listing_pda,
    message_from_instructions,
    pack_session_pda,
    pack_session_v2_pda,
    seed_contribution_pda,
    seed_sale_pda,
    seed_vault_authority_pda,
    seed_vault_token_pda,
    PROGRAM_ID,
    SEED_SALE_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    to_pubkey,
    vault_authority_pda,
    vault_state_pda,
    versioned_tx_b64,
    build_system_transfer_ix,
)


class Settings(BaseSettings):
    solana_rpc: str = "https://api.devnet.solana.com"
    solana_devnet_rpc: str = "https://api.devnet.solana.com"
    helius_rpc_url: str = ""
    admin_address: Optional[str] = None
    admin_keypair_path: Optional[str] = None
    platform_wallet: Optional[str] = None
    treasury_wallet: Optional[str] = None
    core_collection_address: Optional[str] = None
    usdc_mint: Optional[str] = None
    mochi_token_mint: Optional[str] = None
    mochi_token_decimals: int = 6
    listing_fee_mochi: int = 0  # raw smallest-unit amount
    official_collections: Optional[str] = None  # comma-separated list of collection mints treated as official
    seed_sale_authority: Optional[str] = None
    seed_sale_mint: Optional[str] = None
    seed_sale_treasury: Optional[str] = None
    recycle_rate: int = 10
    claim_window_seconds: int = 3600
    server_seed: str = os.environ.get("SERVER_SEED", "dev-server-seed")
    database_url: str = "sqlite:///./mochi.db"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


auth_settings = Settings()


engine = create_engine(auth_settings.database_url)
sol_client = SolanaClient(auth_settings.solana_rpc)
ADMIN_KEYPAIR: Optional[SoldersKeypair] = None
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvR93dZczYEdiH7kXe1JgRQ1d2Cdu9pfAFu7h")
SYSVAR_RENT_PUBKEY = Pubkey.from_string("SysvarRent111111111111111111111111111111111")


class CardTemplate(SQLModel, table=True):
    template_id: int = Field(primary_key=True)
    index: int
    card_name: str
    rarity: str
    variant: Optional[str] = None
    set_code: Optional[str] = None
    set_name: Optional[str] = None
    is_energy: bool = False
    energy_type: Optional[str] = None
    image_url: Optional[str] = None


class MintRecord(SQLModel, table=True):
    asset_id: str = Field(primary_key=True)
    template_id: int
    rarity: str
    status: str = Field(default="available")
    owner: Optional[str] = None
    updated_at: float = Field(default_factory=lambda: time.time())
    is_fake: bool = Field(default=False)


class SessionMirror(SQLModel, table=True):
    session_id: str = Field(primary_key=True)
    user: str
    rarities: str
    asset_ids: str = Field(default="")
    server_seed_hash: str
    server_nonce: str
    state: str = Field(default="pending")
    created_at: float = Field(default_factory=lambda: time.time())
    expires_at: float
    template_ids: str = Field(default="")
    version: int = Field(default=1)


class VirtualCard(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    wallet: str
    template_id: int
    rarity: str
    count: int = Field(default=0)
    updated_at: float = Field(default_factory=lambda: time.time())


class RecycleLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    wallet: str
    total_cards: int
    reward_amount: int
    created_at: float = Field(default_factory=lambda: time.time())


class PriceSnapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    template_id: int = Field(index=True)
    source: str = Field(default="pokespider_tcgplayer")
    currency: str = Field(default="USD")
    market_price: float = Field(default=0)  # recent sales
    direct_low: float = Field(default=0)  # lowest listing
    mid_price: float = Field(default=0)
    low_price: float = Field(default=0)
    high_price: float = Field(default=0)
    collected_at: float = Field(default_factory=lambda: time.time())

    __table_args__ = (Index("idx_price_snapshot_template_ts", "template_id", "collected_at"),)


def ensure_price_snapshot_schema():
    """Lightweight migration helper for new pricing fields/indexes."""
    with engine.begin() as conn:
        existing_cols = set()
        try:
            rows = conn.execute(text("PRAGMA table_info('PriceSnapshot')")).fetchall()
            existing_cols = {row[1] for row in rows}
        except Exception:
            existing_cols = set()
        alters: List[Tuple[str, str]] = []
        if "market_price" not in existing_cols:
            alters.append(("ADD COLUMN market_price FLOAT DEFAULT 0", "market_price"))
        if "direct_low" not in existing_cols:
            alters.append(("ADD COLUMN direct_low FLOAT DEFAULT 0", "direct_low"))
        for clause, col in alters:
            conn.execute(text(f"ALTER TABLE PriceSnapshot {clause}"))
        # ensure composite index for high-frequency inserts/reads
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_price_snapshot_template_ts ON PriceSnapshot (template_id, collected_at DESC)"))


def init_db():
    SQLModel.metadata.create_all(engine)
    ensure_price_snapshot_schema()


def get_session():
    with Session(engine) as session:
        yield session


app = FastAPI(title="Mochi v2 API", version="0.1.0")
SERVER_SEED_HASH = hashlib.sha256(auth_settings.server_seed.encode()).hexdigest()
PACK_CARD_COUNT = 11
RARITY_LABELS = [
    "Common",
    "Uncommon",
    "Rare",
    "DoubleRare",
    "UltraRare",
    "IllustrationRare",
    "SpecialIllustrationRare",
    "MegaHyperRare",
    "Energy",
]
RARE_PLUS = {
    "Rare",
    "DoubleRare",
    "UltraRare",
    "IllustrationRare",
    "SpecialIllustrationRare",
    "MegaHyperRare",
}
PACK_STATE_LABELS = [
    "uninitialized",
    "pending",
    "accepted",
    "rejected",
    "expired",
]
LISTING_STATUS_LABELS = ["active", "filled", "cancelled", "burned", "deprecated"]
CARD_STATUS_LABELS = [
    "available",
    "reserved",
    "user_owned",
    "redeem_pending",
    "burned",
    "deprecated",
]


# Odds pulled from legacy picker for meg_web pack
FLEX_ODDS = {
    "Rare": 0.25,
    "Uncommon": 0.35,
    "Common": 0.40,
}
REVERSE_ODDS = {
    "MegaHyperRare": 0.0004,
    "SpecialIllustrationRare": 0.0099,
    "IllustrationRare": 0.1089,
    "UltraRare": 0.035,
    "DoubleRare": 0.08,
    "Rare": 0.15,
    "Uncommon": 0.28,
    "Common": 0.3358,
}
RARE_SLOT_ODDS = {
    "MegaHyperRare": 0.000758,
    "SpecialIllustrationRare": 0.008333,
    "IllustrationRare": 0.090909,
    "UltraRare": 0.071429,
    "DoubleRare": 0.166667,
    "Rare": 0.661905,
}

RARITY_PRICE_LAMPORTS = {
    "Common": 1_000_000,
    "Uncommon": 2_000_000,
    "Rare": 3_000_000,
    "DoubleRare": 6_000_000,
    "UltraRare": 10_000_000,
    "IllustrationRare": 15_000_000,
    "SpecialIllustrationRare": 30_000_000,
    "MegaHyperRare": 50_000_000,
    "Energy": 1_000_000,
}

# Seed sale constants
MIN_SEED_CONTRIB_LAMPORTS = 10_000_000  # 0.01 SOL
SEED_CONTRIBUTION_DISCRIMINATOR = bytes.fromhex("b6bb0e6f48a7f2d4")


class PackPreviewRequest(BaseModel):
    pack_type: str = "meg_web"
    client_seed: str
    wallet: str


class PackSlot(BaseModel):
    slot_index: int
    rarity: str
    template_id: Optional[int]
    is_nft: bool = False


class PackPreviewResponse(BaseModel):
    server_seed_hash: str
    server_nonce: str
    entropy_proof: str
    slots: List[PackSlot]


class PackBuildRequest(BaseModel):
    pack_type: str = "meg_web"
    client_seed: str
    wallet: str
    currency: str = "SOL"
    user_token_account: Optional[str] = None
    vault_token_account: Optional[str] = None
    currency_mint: Optional[str] = None


class PackBuildResponse(BaseModel):
    tx_b64: str
    tx_v0_b64: str
    recent_blockhash: str
    session_id: str
    lineup: List[PackSlot]
    provably_fair: Dict[str, str]
    instructions: List["InstructionMeta"]


class SessionActionRequest(BaseModel):
    session_id: str
    wallet: str
    user_token_account: Optional[str] = None
    vault_token_account: Optional[str] = None


class PackBuildV2Request(BaseModel):
    client_seed: str
    wallet: str
    currency: str = "SOL"
    user_token_account: Optional[str] = None
    vault_token_account: Optional[str] = None


class SessionActionV2Request(BaseModel):
    wallet: str
    session_id: Optional[str] = None
    user_token_account: Optional[str] = None
    vault_token_account: Optional[str] = None


class BatchClaimRequest(BaseModel):
    wallet: str
    batch_assets: List[str]


class TestClaim3Request(BaseModel):
    wallet: str


class AdminResetRequest(BaseModel):
    wallet: str

class AdminForceCancelListings(BaseModel):
    assets: List[str]
    vault_state: Optional[str] = None


class PendingSessionResponse(BaseModel):
    session_id: str
    wallet: str
    expires_at: float
    countdown_seconds: int
    lineup: List[PackSlot]
    asset_ids: List[str]
    provably_fair: Dict[str, str]


class KeyMeta(BaseModel):
    pubkey: str
    is_signer: bool
    is_writable: bool


class InstructionMeta(BaseModel):
    program_id: str
    keys: List[KeyMeta]
    data: str


class MultiTxResponse(BaseModel):
    """Return a sequence of transactions to be sent in order."""
    txs: List[TxResponse]

class TxResponse(BaseModel):
    tx_b64: str
    tx_v0_b64: str
    recent_blockhash: str
    instructions: List[InstructionMeta]


class PricingCardResponse(BaseModel):
    template_id: int
    source: str
    currency: str
    mid_price: float
    low_price: float
    high_price: float
    collected_at: float
    display_price: float
    fair_value: float
    avg_7d: float
    avg_30d: float
    spread_ratio: Optional[float] = None
    price_confidence: str
    confidence_score: Optional[str] = None


class PricingHistoryPoint(BaseModel):
    mid_price: float
    low_price: float
    high_price: float
    collected_at: float
    fair_value: float


class PricingPortfolioBreakdown(BaseModel):
    template_id: int
    name: Optional[str] = None
    count: int
    mid_price: float
    fair_value: float
    confidence_score: Optional[str] = None
    total_value_usd: float


class PricingPortfolioResponse(BaseModel):
    total_value_usd: float
    breakdown: List[PricingPortfolioBreakdown]


class PricingStatsResponse(BaseModel):
    portfolio_total: float
    change_24h: Optional[float] = None
    last_valuation_at: float
    breakdown: List[PricingPortfolioBreakdown]


class PricingSearchItem(BaseModel):
    template_id: int
    name: str
    set_name: Optional[str] = None
    rarity: Optional[str] = None
    image_url: Optional[str] = None
    mid_price: Optional[float] = None
    low_price: Optional[float] = None
    high_price: Optional[float] = None
    collected_at: Optional[float] = None
    display_price: Optional[float] = None
    price_confidence: Optional[str] = None
    confidence_score: Optional[str] = None
    fair_value: Optional[float] = None
    sparkline: Optional[List[PricingHistoryPoint]] = None


class PricingSparkline(BaseModel):
    template_id: int
    points: List[PricingHistoryPoint]


class SeedContributionView(BaseModel):
    buyer: str
    contributed_lamports: int
    tokens_owed: int
    claimed: bool
    pda: str


class SeedSaleStateResponse(BaseModel):
    sale: str
    authority: str
    mint: str
    seed_vault: str
    vault_authority: str
    treasury: str
    start_ts: int
    end_ts: int
    price_tokens_per_sol: int
    token_cap: int
    sol_cap_lamports: int
    sold_tokens: int
    raised_lamports: int
    is_canceled: bool
    vault_balance: Optional[int] = None
    treasury_balance: Optional[int] = None
    contributor_count: Optional[int] = None
    tokens_remaining: Optional[int] = None
    sol_remaining: Optional[int] = None
    token_decimals: int = 0
    user_contribution: Optional[SeedContributionView] = None


class SeedContributeRequest(BaseModel):
    wallet: str
    lamports: Optional[int] = None
    sol: Optional[float] = None


class SeedContributeBuildResponse(TxResponse):
    lamports: int
    tokens_owed: int
    sale: str
    mint: str
    start_ts: int
    end_ts: int
    contribution_pda: str


class SeedClaimRequest(BaseModel):
    wallet: str
    user_token_account: Optional[str] = None


class SeedClaimBuildResponse(TxResponse):
    claimable_tokens: int
    sale: str
    mint: str
    user_ata: str
    contribution_pda: str


class AssetStatusView(BaseModel):
    asset_id: str
    template_id: Optional[int]
    rarity: Optional[str]
    status: str
    owner: Optional[str]


class SessionDiagnostic(BaseModel):
    session_id: str
    user: str
    state: str
    expires_at: float
    has_pack_session: bool
    asset_statuses: List[AssetStatusView]


class UnreserveRequest(BaseModel):
    owner: Optional[str] = None
    statuses: Optional[List[str]] = None


class ListRequest(BaseModel):
    core_asset: str
    price_lamports: int
    wallet: str
    currency_mint: Optional[str] = None


class ListingView(BaseModel):
    core_asset: str
    price_lamports: int
    seller: Optional[str] = None
    status: str
    currency_mint: Optional[str] = None
    template_id: Optional[int] = None
    rarity: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None
    is_fake: bool = False
    current_mid: Optional[float] = None
    high_90d: Optional[float] = None
    low_90d: Optional[float] = None


class AssetView(BaseModel):
    asset_id: str
    template_id: int
    rarity: str
    status: str
    owner: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None


class MarketplaceActionRequest(BaseModel):
    core_asset: str
    wallet: str


class AdminSessionSettleRequest(BaseModel):
    session_id: str


class InventoryRefreshResponse(BaseModel):
    owner: str
    count: int
    updated: List[str]


class ConfirmOpenRequest(BaseModel):
    signature: str
    wallet: str
    rarities: Optional[List[str]] = None
    template_ids: Optional[List[Optional[int]]] = None
    server_nonce: Optional[str] = None


class ConfirmClaimRequest(BaseModel):
    signature: str
    wallet: str
    action: str = "claim"

class ClaimCleanupRequest(BaseModel):
    wallet: str
    session_id: Optional[str] = None

class RecycleItem(BaseModel):
    template_id: int
    rarity: str
    count: int = 1


class RecycleBuildRequest(BaseModel):
    wallet: str
    items: List[RecycleItem]
    user_token_account: str


class VirtualCardView(BaseModel):
    template_id: int
    rarity: str
    count: int
    name: Optional[str] = None
    image_url: Optional[str] = None
    is_energy: Optional[bool] = None


def hash_seed(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def compute_nonce(client_seed: str) -> str:
    return hashlib.sha256(f"{SERVER_SEED_HASH}:{client_seed}".encode()).hexdigest()[:16]


def entropy_hex(client_seed: str, nonce: str) -> str:
    return hashlib.sha256(f"{auth_settings.server_seed}:{client_seed}:{nonce}".encode()).hexdigest()


def wrap_instruction_meta(raw: dict) -> InstructionMeta:
    return InstructionMeta(
        program_id=raw["program_id"],
        keys=[KeyMeta(**k) for k in raw["keys"]],
        data=raw["data"],
    )


def seed_sale_config() -> Dict[str, Pubkey]:
    authority = auth_settings.seed_sale_authority or auth_settings.admin_address or auth_settings.platform_wallet
    mint = auth_settings.seed_sale_mint or auth_settings.mochi_token_mint
    treasury = auth_settings.seed_sale_treasury or auth_settings.treasury_wallet or auth_settings.platform_wallet
    if not authority or not mint or not treasury:
        raise HTTPException(status_code=500, detail="Seed sale authority/mint/treasury not configured")
    authority_pk = to_pubkey(authority)
    mint_pk = to_pubkey(mint)
    treasury_pk = to_pubkey(treasury)
    sale = seed_sale_pda(authority_pk, mint_pk)
    vault_auth = seed_vault_authority_pda(sale)
    seed_vault = seed_vault_token_pda(sale)
    return {
        "authority": authority_pk,
        "mint": mint_pk,
        "treasury": treasury_pk,
        "sale": sale,
        "vault_authority": vault_auth,
        "seed_vault": seed_vault,
    }


def parse_seed_sale_account(data: bytes) -> Optional[dict]:
    if len(data) < 8 + 220:
        return None
    o = 8  # skip discriminator

    def read_pubkey() -> Pubkey:
        nonlocal o
        pk = Pubkey.from_bytes(data[o : o + 32])
        o += 32
        return pk

    def read_i64() -> int:
        nonlocal o
        val = int.from_bytes(data[o : o + 8], "little", signed=True)
        o += 8
        return val

    def read_u64() -> int:
        nonlocal o
        val = int.from_bytes(data[o : o + 8], "little", signed=False)
        o += 8
        return val

    authority = read_pubkey()
    mint = read_pubkey()
    seed_vault = read_pubkey()
    vault_authority = read_pubkey()
    treasury = read_pubkey()
    start_ts = read_i64()
    end_ts = read_i64()
    price_tokens_per_sol = read_u64()
    token_cap = read_u64()
    sol_cap_lamports = read_u64()
    sold_tokens = read_u64()
    raised_lamports = read_u64()
    is_canceled = data[o] == 1
    o += 1
    bump = data[o] if o < len(data) else 0
    o += 1
    vault_bump = data[o] if o < len(data) else 0
    o += 1
    vault_token_bump = data[o] if o < len(data) else 0
    return {
        "authority": authority,
        "mint": mint,
        "seed_vault": seed_vault,
        "vault_authority": vault_authority,
        "treasury": treasury,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "price_tokens_per_sol": price_tokens_per_sol,
        "token_cap": token_cap,
        "sol_cap_lamports": sol_cap_lamports,
        "sold_tokens": sold_tokens,
        "raised_lamports": raised_lamports,
        "is_canceled": is_canceled,
        "bump": bump,
        "vault_bump": vault_bump,
        "vault_token_bump": vault_token_bump,
    }


def parse_seed_contribution_account(data: bytes) -> Optional[dict]:
    if len(data) < 8 + 32 * 2 + 8 * 2 + 2:
        return None
    o = 8

    def read_pubkey() -> Pubkey:
        nonlocal o
        pk = Pubkey.from_bytes(data[o : o + 32])
        o += 32
        return pk

    def read_u64() -> int:
        nonlocal o
        val = int.from_bytes(data[o : o + 8], "little", signed=False)
        o += 8
        return val

    sale = read_pubkey()
    buyer = read_pubkey()
    contributed_lamports = read_u64()
    tokens_owed = read_u64()
    claimed = data[o] == 1
    o += 1
    bump = data[o] if o < len(data) else 0
    return {
        "sale": sale,
        "buyer": buyer,
        "contributed_lamports": contributed_lamports,
        "tokens_owed": tokens_owed,
        "claimed": claimed,
        "bump": bump,
    }


def derive_ata(owner: Pubkey, mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [owner.to_bytes(), TOKEN_PROGRAM_ID.to_bytes(), mint.to_bytes()], ASSOCIATED_TOKEN_PROGRAM_ID
    )[0]


def build_create_ata_ix(payer: Pubkey, owner: Pubkey, mint: Pubkey) -> Instruction:
    ata = derive_ata(owner, mint)
    system_program = Pubkey.from_string("11111111111111111111111111111111")
    accounts = [
        AccountMeta(payer, is_signer=True, is_writable=True),
        AccountMeta(ata, is_signer=False, is_writable=True),
        AccountMeta(owner, is_signer=False, is_writable=False),
        AccountMeta(mint, is_signer=False, is_writable=False),
        AccountMeta(system_program, is_signer=False, is_writable=False),
        AccountMeta(TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(SYSVAR_RENT_PUBKEY, is_signer=False, is_writable=False),
    ]
    return Instruction(ASSOCIATED_TOKEN_PROGRAM_ID, b"", accounts)


def fetch_contributor_count(sale: Pubkey) -> Optional[int]:
    payload = {
        "jsonrpc": "2.0",
        "id": "contrib_count",
        "method": "getProgramAccounts",
        "params": [
            str(SEED_SALE_PROGRAM_ID),
            {
                "encoding": "base64",
                "filters": [
                    {"memcmp": {"offset": 0, "bytes": base64.b64encode(SEED_CONTRIBUTION_DISCRIMINATOR).decode()}},
                    {"memcmp": {"offset": 8, "bytes": str(sale)}},
                ],
            },
        ],
    }
    try:
        resp = requests.post(auth_settings.solana_rpc, json=payload, timeout=10)
        resp.raise_for_status()
        result = resp.json().get("result", [])
        if isinstance(result, list):
            return len(result)
    except Exception:
        return None
    return None


def load_seed_sale_state() -> Dict[str, object]:
    cfg = seed_sale_config()
    resp = sol_client.get_account_info(cfg["sale"])
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Seed sale PDA not found on-chain")
    parsed = parse_seed_sale_account(bytes(resp.value.data))
    if not parsed:
        raise HTTPException(status_code=500, detail="Unable to parse seed sale account")
    if parsed["authority"] != cfg["authority"] or parsed["mint"] != cfg["mint"]:
        raise HTTPException(status_code=400, detail="Seed sale config mismatch (authority/mint)")
    parsed["pda"] = cfg["sale"]
    parsed["vault_authority"] = cfg["vault_authority"]
    parsed["seed_vault"] = cfg["seed_vault"]
    parsed["treasury"] = cfg["treasury"]
    return parsed


def load_seed_contribution(sale: Pubkey, buyer: Pubkey) -> Optional[dict]:
    contrib_pda = seed_contribution_pda(sale, buyer)
    resp = sol_client.get_account_info(contrib_pda)
    if resp.value is None or resp.value.data is None:
        return None
    parsed = parse_seed_contribution_account(bytes(resp.value.data))
    if not parsed:
        return None
    parsed["pda"] = contrib_pda
    return parsed


def build_rng(server_seed: str, client_seed: str) -> random.Random:
    nonce = compute_nonce(client_seed)
    digest = hashlib.sha256(f"{server_seed}:{client_seed}:{nonce}".encode()).digest()
    seed_int = int.from_bytes(digest, "big")
    return random.Random(seed_int)


def get_latest_blockhash() -> str:
    body = {"jsonrpc": "2.0", "id": "mochi", "method": "getLatestBlockhash"}
    try:
        resp = requests.post(auth_settings.solana_rpc, json=body, timeout=10)
        resp.raise_for_status()
        result = resp.json().get("result", {})
        value = result.get("value", {}) or result
        return value.get("blockhash") or value.get("context", {}).get("blockhash", "")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to fetch blockhash: {exc}") from exc


def treasury_pubkey() -> Pubkey:
    target = auth_settings.treasury_wallet or auth_settings.platform_wallet
    if not target:
        raise HTTPException(status_code=500, detail="Treasury wallet not configured")
    return to_pubkey(target)


def get_latest_price_snapshot(template_id: int, db: Session) -> Optional[PriceSnapshot]:
    stmt = select(PriceSnapshot).where(PriceSnapshot.template_id == template_id).order_by(PriceSnapshot.collected_at.desc())
    return db.exec(stmt).first()


def fair_value_from_snapshot(snap: PriceSnapshot) -> float:
    """Apply fair-value priority: market_price -> direct_low -> mid -> low -> high -> 0."""
    for candidate in [snap.market_price, snap.direct_low, snap.mid_price, snap.low_price, snap.high_price]:
        if candidate and float(candidate) > 0:
            return float(candidate)
    return 0.0


def confidence_score_from_snapshot(snap: PriceSnapshot, now_ts: Optional[float] = None) -> str:
    now_val = now_ts or time.time()
    confidence = "high"
    spread_ratio = None
    if snap.low_price and snap.low_price > 0 and snap.high_price:
        spread_ratio = (float(snap.high_price) - float(snap.low_price)) / float(snap.low_price)
        if spread_ratio > 0.5:
            confidence = "low"
        elif spread_ratio > 0.25:
            confidence = "medium"
    staleness_hours = (now_val - snap.collected_at) / 3600
    if staleness_hours > 72:
        confidence = "low"
    elif staleness_hours > 24 and confidence == "high":
        confidence = "medium"
    return confidence


def fetch_history_points(template_id: int, db: Session, limit: int = 30, min_ts: Optional[float] = None) -> List[PricingHistoryPoint]:
    stmt = (
        select(PriceSnapshot)
        .where(PriceSnapshot.template_id == template_id)
        .order_by(PriceSnapshot.collected_at.desc())
        .limit(limit)
    )
    if min_ts:
        stmt = stmt.where(PriceSnapshot.collected_at >= min_ts)
    snaps = db.exec(stmt).all()
    points: List[PricingHistoryPoint] = []
    for s in snaps:
        points.append(
            PricingHistoryPoint(
                mid_price=float(s.mid_price),
                low_price=float(s.low_price),
                high_price=float(s.high_price),
                collected_at=float(s.collected_at),
                fair_value=fair_value_from_snapshot(s),
            )
        )
    return points


def compute_price_view(template_id: int, db: Session):
    """Derive display price, averages, and confidence from PriceSnapshot history."""
    latest = get_latest_price_snapshot(template_id, db)
    if not latest:
        return None
    now = time.time()
    cutoff_30d = now - 30 * 24 * 3600
    cutoff_7d = now - 7 * 24 * 3600
    snaps = db.exec(
        select(PriceSnapshot)
        .where(PriceSnapshot.template_id == template_id)
        .where(PriceSnapshot.collected_at >= cutoff_30d)
        .order_by(PriceSnapshot.collected_at.desc())
    ).all()

    def avg(values: Sequence[float]) -> float:
        return float(sum(values) / len(values)) if values else 0.0

    fair_values = [fair_value_from_snapshot(s) for s in snaps]
    mid_30d = avg([fv for fv, snap in zip(fair_values, snaps) if snap.collected_at >= cutoff_30d])
    mid_7d = avg([fv for fv, snap in zip(fair_values, snaps) if snap.collected_at >= cutoff_7d])
    latest_fair = fair_value_from_snapshot(latest)
    if mid_7d == 0:
        mid_7d = latest_fair
    if mid_30d == 0:
        mid_30d = latest_fair
    display = latest_fair
    spread_ratio = None
    if latest.low_price and latest.low_price > 0 and latest.high_price:
        spread_ratio = float(latest.high_price - latest.low_price) / float(latest.low_price)
    confidence = confidence_score_from_snapshot(latest, now_ts=now)
    return {
        "latest": latest,
        "display_price": float(display),
        "avg_7d": float(mid_7d),
        "avg_30d": float(mid_30d),
        "spread_ratio": spread_ratio,
        "confidence": confidence,
        "fair_value": latest_fair,
    }


def get_sol_price() -> float:
    """Mock SOL price in USD; replace with Pyth/Chainlink later."""
    return 150.0


def build_portfolio_breakdown(wallet: str, db: Session) -> Tuple[List[PricingPortfolioBreakdown], float]:
    breakdown: List[PricingPortfolioBreakdown] = []
    total_value = 0.0
    templates = {t.template_id: t for t in db.exec(select(CardTemplate)).all()}

    def add_position(template_id: int, count: int):
        nonlocal total_value
        snap = get_latest_price_snapshot(template_id, db)
        if not snap:
            return
        fair_value = fair_value_from_snapshot(snap)
        if fair_value <= 0:
            return
        confidence = confidence_score_from_snapshot(snap)
        value = fair_value * count
        total_value += value
        tmpl = templates.get(template_id)
        breakdown.append(
            PricingPortfolioBreakdown(
                template_id=template_id,
                name=tmpl.card_name if tmpl else None,
                count=count,
                mid_price=float(snap.mid_price),
                fair_value=fair_value,
                confidence_score=confidence,
                total_value_usd=value,
            )
        )

    # Virtual cards
    virtuals = db.exec(select(VirtualCard).where(VirtualCard.wallet == wallet)).all()
    for vc in virtuals:
        add_position(vc.template_id, vc.count)

    # NFTs (MintRecords) owned by wallet
    nfts = db.exec(select(MintRecord).where(MintRecord.owner == wallet)).all()
    counts: Dict[int, int] = {}
    for n in nfts:
        counts[n.template_id] = counts.get(n.template_id, 0) + 1
    for template_id, count in counts.items():
        add_position(template_id, count)

    return breakdown, total_value


def get_snapshot_as_of(template_id: int, as_of_ts: float, db: Session) -> Optional[PriceSnapshot]:
    stmt = (
        select(PriceSnapshot)
        .where(PriceSnapshot.template_id == template_id)
        .where(PriceSnapshot.collected_at <= as_of_ts)
        .order_by(PriceSnapshot.collected_at.desc())
        .limit(1)
    )
    return db.exec(stmt).first()


@app.post("/pricing/fetch", response_model=dict)
def pricing_fetch(db: Session = Depends(get_session)):
    """Mock price fetcher for testing; assigns random USD prices to all CardTemplates."""
    rng = random.Random(time.time())
    templates = db.exec(select(CardTemplate)).all()
    now = time.time()
    created = 0
    for tmpl in templates:
        mid = round(rng.uniform(5, 150), 2)
        low = round(mid * 0.85, 2)
        high = round(mid * 1.15, 2)
        snap = PriceSnapshot(
            template_id=tmpl.template_id,
            source="mock_pricing",
            currency="USD",
            market_price=mid,
            direct_low=low,
            mid_price=mid,
            low_price=low,
            high_price=high,
            collected_at=now,
        )
        db.add(snap)
        created += 1
    db.commit()
    return {"ok": True, "snapshots": created, "source": "mock_pricing"}


def load_admin_keypair() -> SoldersKeypair:
    global ADMIN_KEYPAIR
    if ADMIN_KEYPAIR:
        return ADMIN_KEYPAIR
    if not auth_settings.admin_keypair_path:
        raise HTTPException(status_code=500, detail="ADMIN_KEYPAIR_PATH not configured")
    path = auth_settings.admin_keypair_path
    if not os.path.exists(path):
        raise HTTPException(status_code=500, detail=f"Admin keypair file not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read admin keypair: {exc}") from exc
    secret_bytes: bytes
    if isinstance(data, list):
        secret_bytes = bytes(data)
    elif isinstance(data, dict) and "secretKey" in data:
        secret_bytes = bytes(data["secretKey"])
    else:
        raise HTTPException(status_code=500, detail="Unsupported admin keypair format")
    try:
        ADMIN_KEYPAIR = SoldersKeypair.from_bytes(secret_bytes)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to parse admin keypair: {exc}") from exc
    return ADMIN_KEYPAIR


def choose_weighted(rng: random.Random, odds: Dict[str, float]) -> str:
    roll = rng.random()
    cumulative = 0.0
    for rarity, weight in odds.items():
        cumulative += weight
        if roll <= cumulative:
            return rarity
    return list(odds.keys())[-1]


def slot_rarities(rng: random.Random) -> List[str]:
    rarities: List[str] = []
    rarities.extend(["Common"] * 4)
    rarities.extend(["Uncommon"] * 3)
    rarities.append(choose_weighted(rng, FLEX_ODDS))
    rarities.append(choose_weighted(rng, REVERSE_ODDS))
    rarities.append(choose_weighted(rng, RARE_SLOT_ODDS))
    rarities.append("Energy")
    return rarities


def rarity_price_vector(rarities: List[str]) -> List[int]:
    return [RARITY_PRICE_LAMPORTS.get(r, 1_000_000) for r in rarities]


def normalized_rarity(value: str) -> str:
    return value.replace(" ", "").replace("_", "").lower()


def rarity_is_rare_plus(value: str) -> bool:
    return normalized_rarity(value).capitalize() in {v.capitalize() for v in RARE_PLUS}


def rarity_is_low_tier(value: str) -> bool:
    lower = value.lower()
    if lower in ["common", "uncommon", "energy"]:
        return True
    return not rarity_is_rare_plus(value)


def pick_template_ids(rng: random.Random, rarities: List[str], db: Session) -> List[Optional[int]]:
    result: List[Optional[int]] = []
    for rarity in rarities:
        stmt = select(CardTemplate).where(CardTemplate.rarity == rarity)
        if rarity == "Energy":
            stmt = select(CardTemplate).where(CardTemplate.is_energy == True)  # noqa: E712
        else:
            norm_value = normalized_rarity(rarity)
            normalized_column = func.lower(
                func.replace(
                    func.replace(CardTemplate.rarity, " ", ""),
                    "_",
                    "",
                )
            )
            stmt = select(CardTemplate).where(normalized_column == norm_value)
        templates = db.exec(stmt).all()
        if not templates:
            result.append(None)
            continue
        chosen = rng.choice(templates)
        result.append(chosen.template_id)
    return result


def mutate_virtual_cards(wallet: str, items: List[tuple[int, str]], db: Session, direction: int):
    """
    direction = +1 to add, -1 to remove
    """
    now = time.time()
    for template_id, rarity in items:
        if template_id is None:
            continue
        stmt = select(VirtualCard).where(
            VirtualCard.wallet == wallet,
            VirtualCard.template_id == template_id,
        )
        row = db.exec(stmt).first()
        if not row:
            if direction < 0:
                continue
            row = VirtualCard(wallet=wallet, template_id=template_id, rarity=rarity, count=0)
        row.count = max(0, row.count + direction)
        row.rarity = rarity
        row.updated_at = now
        db.add(row)
    db.commit()


def low_tier_virtual_items(rarities: List[str], template_ids: List[Optional[int]]) -> List[tuple[int, str]]:
    items: List[tuple[int, str]] = []
    for rarity, tmpl in zip(rarities, template_ids):
        if tmpl is None:
            continue
        if rarity_is_rare_plus(rarity):
            continue
        items.append((tmpl, rarity))
    return items


def choose_assets_for_templates(
    template_ids: List[Optional[int]],
    rarities: List[str],
    wallet: str,
    db: Session,
    reserve: bool = False,
) -> List[str]:
    asset_ids: List[str] = []
    for idx, tmpl in enumerate(template_ids):
        if tmpl is None:
            asset_ids.append("")
            continue
        stmt = select(MintRecord).where(MintRecord.template_id == tmpl, MintRecord.status == "available")
        record = db.exec(stmt).first()
        if not record:
            raise HTTPException(status_code=400, detail=f"No available asset for template {tmpl} (slot {idx})")
        if reserve:
            record.status = "reserved"
            record.owner = wallet
            record.updated_at = time.time()
            db.add(record)
        asset_ids.append(record.asset_id)
    if reserve:
        db.commit()
    return asset_ids


def choose_rare_assets_only(
    template_ids: List[Optional[int]],
    rarities: List[str],
    wallet: str,
    db: Session,
):
    rare_indices: List[int] = []
    rare_templates: List[int] = []
    rare_assets: List[str] = []
    for idx, rarity in enumerate(rarities):
        if not rarity_is_rare_plus(rarity):
            continue
        rare_indices.append(idx)
        tmpl = template_ids[idx]
        if tmpl is None:
            raise HTTPException(status_code=400, detail=f"Missing template for rare slot {idx}")
        stmt = select(MintRecord).where(MintRecord.template_id == tmpl, MintRecord.status == "available")
        record = db.exec(stmt).first()
        if not record:
            raise HTTPException(status_code=400, detail=f"No available asset for template {tmpl} (rare slot {idx})")
        rare_templates.append(tmpl)
        rare_assets.append(record.asset_id)
    return rare_indices, rare_templates, rare_assets


def parse_asset_ids(csv_assets: str) -> List[str]:
    if not csv_assets:
        return []
    return [a for a in csv_assets.split(",") if a]


def pda_exists(pda: Pubkey) -> bool:
    resp = sol_client.get_account_info(pda)
    return resp.value is not None


def parse_pack_session_account(data: bytes) -> Optional[dict]:
    if len(data) < 8:
        return None
    offset = 8  # skip Anchor discriminator
    min_len = offset + 32 + 1 + 8 + 8 + 8 + (32 * PACK_CARD_COUNT) + 1 + 32 + 4
    if len(data) < min_len:
        return None
    user = Pubkey.from_bytes(data[offset : offset + 32])
    offset += 32
    currency_idx = data[offset]
    offset += 1
    paid_amount = int.from_bytes(data[offset : offset + 8], "little")
    offset += 8
    created_at = int.from_bytes(data[offset : offset + 8], "little", signed=True)
    offset += 8
    expires_at = int.from_bytes(data[offset : offset + 8], "little", signed=True)
    offset += 8
    card_record_keys: List[Pubkey] = []
    for _ in range(PACK_CARD_COUNT):
        card_record_keys.append(Pubkey.from_bytes(data[offset : offset + 32]))
        offset += 32
    state_idx = data[offset]
    offset += 1
    client_seed_hash = data[offset : offset + 32]
    offset += 32
    if len(data) < offset + 4:
        return None
    rarity_len = int.from_bytes(data[offset : offset + 4], "little")
    offset += 4
    rarity_prices: List[int] = []
    for _ in range(rarity_len):
        if len(data) < offset + 8:
            break
        rarity_prices.append(int.from_bytes(data[offset : offset + 8], "little"))
        offset += 8
    currency = "SOL" if currency_idx == 0 else "Token"
    state = PACK_STATE_LABELS[state_idx] if 0 <= state_idx < len(PACK_STATE_LABELS) else str(state_idx)
    return {
        "user": user,
        "currency": currency,
        "paid_amount": paid_amount,
        "created_at": created_at,
        "expires_at": expires_at,
        "card_record_keys": card_record_keys,
        "state": state,
        "client_seed_hash": client_seed_hash,
        "rarity_prices": rarity_prices,
    }


def parse_pack_session_v2_account(data: bytes) -> Optional[dict]:
    if len(data) < 8:
        return None
    offset = 8
    min_len = offset + 32 + 1 + 8 + 8 + 8 + 4
    if len(data) < min_len:
        return None
    user = Pubkey.from_bytes(data[offset : offset + 32])
    offset += 32
    currency_idx = data[offset]
    offset += 1
    paid_amount = int.from_bytes(data[offset : offset + 8], "little")
    offset += 8
    created_at = int.from_bytes(data[offset : offset + 8], "little", signed=True)
    offset += 8
    expires_at = int.from_bytes(data[offset : offset + 8], "little", signed=True)
    offset += 8
    # rare_card_keys vec
    if len(data) < offset + 4:
        return None
    rare_len = int.from_bytes(data[offset : offset + 4], "little")
    offset += 4
    rare_cards: List[Pubkey] = []
    for _ in range(rare_len):
        if len(data) < offset + 32:
            break
        rare_cards.append(Pubkey.from_bytes(data[offset : offset + 32]))
        offset += 32
    # rare_templates vec
    if len(data) < offset + 4:
        return None
    tmpl_len = int.from_bytes(data[offset : offset + 4], "little")
    offset += 4
    rare_templates: List[int] = []
    for _ in range(tmpl_len):
        if len(data) < offset + 4:
            break
        rare_templates.append(int.from_bytes(data[offset : offset + 4], "little"))
        offset += 4
    if len(data) < offset + 1 + 32 + 1:
        return None
    state_idx = data[offset]
    offset += 1
    client_seed_hash = data[offset : offset + 32]
    offset += 32
    total_slots = data[offset] if offset < len(data) else 11
    currency = "SOL" if currency_idx == 0 else "Token"
    state = PACK_STATE_LABELS[state_idx] if 0 <= state_idx < len(PACK_STATE_LABELS) else str(state_idx)
    return {
        "user": user,
        "currency": currency,
        "paid_amount": paid_amount,
        "created_at": created_at,
        "expires_at": expires_at,
        "rare_cards": rare_cards,
        "rare_templates": rare_templates,
        "state": state,
        "client_seed_hash": client_seed_hash,
        "total_slots": total_slots,
    }


def parse_listing_account(data: bytes) -> Optional[dict]:
    if len(data) < 8:
        return None
    offset = 8
    min_len = offset + 32 * 3 + 8 + 1 + 1
    if len(data) < min_len:
        return None
    vault_state = Pubkey.from_bytes(data[offset : offset + 32])
    offset += 32
    seller = Pubkey.from_bytes(data[offset : offset + 32])
    offset += 32
    core_asset = Pubkey.from_bytes(data[offset : offset + 32])
    offset += 32
    price_lamports = int.from_bytes(data[offset : offset + 8], "little")
    offset += 8
    currency_present = data[offset]
    offset += 1
    currency_mint = None
    if currency_present == 1 and len(data) >= offset + 32:
        currency_mint = Pubkey.from_bytes(data[offset : offset + 32])
        offset += 32
    status_idx = data[offset] if offset < len(data) else 0
    status = LISTING_STATUS_LABELS[status_idx] if 0 <= status_idx < len(LISTING_STATUS_LABELS) else str(status_idx)
    return {
        "vault_state": vault_state,
        "seller": seller,
        "core_asset": core_asset,
        "price_lamports": price_lamports,
        "currency_mint": currency_mint,
        "status": status,
    }


def templates_to_csv(templates: List[Optional[int]]) -> str:
    return ",".join("" if t is None else str(t) for t in templates)


def parse_templates(csv_templates: str) -> List[Optional[int]]:
    if not csv_templates:
        return []
    out: List[Optional[int]] = []
    for token in csv_templates.split(","):
        if token == "":
            out.append(None)
            continue
        try:
            out.append(int(token))
        except ValueError:
            out.append(None)
    return out


def build_mint_to_ix(mint: Pubkey, destination: Pubkey, authority: Pubkey, amount: int) -> Instruction:
    data = bytes([7]) + amount.to_bytes(8, "little")
    metas = [
        AccountMeta(pubkey=mint, is_signer=False, is_writable=True),
        AccountMeta(pubkey=destination, is_signer=False, is_writable=True),
        AccountMeta(pubkey=authority, is_signer=True, is_writable=False),
    ]
    return Instruction(program_id=TOKEN_PROGRAM_ID, data=data, accounts=metas)


def derive_ata(owner: Pubkey, mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [bytes(owner), bytes(TOKEN_PROGRAM_ID), bytes(mint)],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0]


def build_create_ata_ix(payer: Pubkey, owner: Pubkey, mint: Pubkey, ata: Pubkey) -> Instruction:
    # Associated token account creation ix (instruction 0)
    metas = [
        AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
        AccountMeta(pubkey=ata, is_signer=False, is_writable=True),
        AccountMeta(pubkey=owner, is_signer=False, is_writable=False),
        AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    return Instruction(program_id=ASSOCIATED_TOKEN_PROGRAM_ID, data=bytes([0]), accounts=metas)


def build_spl_transfer_ix(source: Pubkey, dest: Pubkey, owner: Pubkey, amount: int) -> Instruction:
    data = bytes([3]) + amount.to_bytes(8, "little")
    metas = [
        AccountMeta(pubkey=source, is_signer=False, is_writable=True),
        AccountMeta(pubkey=dest, is_signer=False, is_writable=True),
        AccountMeta(pubkey=owner, is_signer=True, is_writable=False),
    ]
    return Instruction(program_id=TOKEN_PROGRAM_ID, data=data, accounts=metas)


def parse_card_record_account(data: bytes) -> Optional[dict]:
    if len(data) < 8:
        return None
    offset = 8  # skip discriminator
    if len(data) < offset + 32 + 32 + 4 + 1 + 1 + 32:
        return None
    vault_state = Pubkey.from_bytes(data[offset : offset + 32])
    offset += 32
    core_asset = Pubkey.from_bytes(data[offset : offset + 32])
    offset += 32
    template_id = int.from_bytes(data[offset : offset + 4], "little")
    offset += 4
    rarity_idx = data[offset]
    offset += 1
    status_idx = data[offset]
    offset += 1
    owner = Pubkey.from_bytes(data[offset : offset + 32])
    rarity = RARITY_LABELS[rarity_idx] if 0 <= rarity_idx < len(RARITY_LABELS) else "Unknown"
    return {
        "vault_state": vault_state,
        "core_asset": core_asset,
        "template_id": template_id,
        "rarity": rarity,
        "status": status_idx,
        "owner": owner,
    }


def backfill_session_from_chain(wallet: str, db: Session) -> Optional[SessionMirror]:
    wallet_pk = to_pubkey(wallet)
    vault_state = vault_state_pda()
    pack_session = pack_session_pda(vault_state, wallet_pk)
    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        return None
    session_info = parse_pack_session_account(bytes(resp.value.data))
    if not session_info or session_info.get("state") != "pending":
        return None
    assets: List[str] = []
    rarities: List[str] = []
    for cr_key in session_info["card_record_keys"]:
        cr_resp = sol_client.get_account_info(cr_key)
        if cr_resp.value is None or cr_resp.value.data is None:
            continue
        record_info = parse_card_record_account(bytes(cr_resp.value.data))
        if not record_info:
            continue
        asset_id = str(record_info["core_asset"])
        assets.append(asset_id)
        rarities.append(record_info["rarity"])
        record = db.get(MintRecord, asset_id)
        if record:
            record.status = "reserved"
            record.owner = wallet
            record.updated_at = time.time()
            db.add(record)
    if len(assets) != PACK_CARD_COUNT:
        return None
    session_id = str(pack_session)
    mirror = db.get(SessionMirror, session_id)
    if not mirror:
        mirror = SessionMirror(
            session_id=session_id,
            user=wallet,
            rarities=",".join(rarities),
            asset_ids=",".join(assets),
            server_seed_hash=SERVER_SEED_HASH,
            server_nonce=session_info["client_seed_hash"].hex(),
            state="pending",
            created_at=float(session_info["created_at"]),
            expires_at=float(session_info["expires_at"]),
        )
    else:
        mirror.rarities = ",".join(rarities)
        mirror.asset_ids = ",".join(assets)
        mirror.state = "pending"
        mirror.expires_at = float(session_info["expires_at"])
    db.add(mirror)
    db.commit()
    return mirror


def listing_owner_from_chain(vault_state: Pubkey, core_asset: Pubkey) -> Optional[Pubkey]:
    listing = listing_pda(vault_state, core_asset)
    resp = sol_client.get_account_info(listing)
    if resp.value is None or resp.value.data is None:
        return None
    # Minimal check: first 32 bytes after discriminator should be vault_state; next 32 = seller
    data = bytes(resp.value.data)
    if len(data) < 8 + 32 + 32:
        return None
    seller_bytes = data[8 + 32 : 8 + 32 + 32]
    return Pubkey.from_bytes(seller_bytes)


def helius_get_assets(owner: str, collection: Optional[str]) -> List[dict]:
    if not auth_settings.helius_rpc_url:
        return []
    page = 1
    limit = 100
    items: List[dict] = []
    while True:
        body = {
            "jsonrpc": "2.0",
            "id": f"mochi-{page}",
            "method": "getAssetsByOwner",
            "params": {
                "ownerAddress": owner,
                "page": page,
                "limit": limit,
                "options": {"showUnverifiedCollections": False},
            },
        }
        if collection:
            body["params"]["displayOptions"] = {"showCollectionMetadata": True}
            body["params"]["grouping"] = ["collection", collection]
        resp = requests.post(auth_settings.helius_rpc_url, json=body, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        chunk = data.get("result", {}).get("items", []) or []
        if not chunk:
            break
        items.extend(chunk)
        if len(chunk) < limit:
            break
        page += 1
    return items


@app.on_event("startup")
def startup_event():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok", "server_seed_hash": SERVER_SEED_HASH}


@app.get("/seed_sale/state", response_model=SeedSaleStateResponse)
def seed_sale_state(wallet: Optional[str] = None):
    sale_info = load_seed_sale_state()
    contributor_count = fetch_contributor_count(sale_info["pda"])
    vault_balance = None
    treasury_balance = None
    try:
        balance_resp = sol_client.get_token_account_balance(sale_info["seed_vault"])
        if balance_resp.value is not None:
            vault_balance = int(balance_resp.value.amount)
    except Exception:
        vault_balance = None
    try:
        bal = sol_client.get_balance(sale_info["treasury"])
        treasury_balance = bal.value if bal is not None else None
    except Exception:
        treasury_balance = None

    tokens_remaining = None
    if sale_info["token_cap"] > 0:
        tokens_remaining = max(sale_info["token_cap"] - sale_info["sold_tokens"], 0)
    sol_remaining = None
    if sale_info["sol_cap_lamports"] > 0:
        sol_remaining = max(sale_info["sol_cap_lamports"] - sale_info["raised_lamports"], 0)

    user_contribution: Optional[SeedContributionView] = None
    if wallet:
        try:
            contrib = load_seed_contribution(sale_info["pda"], to_pubkey(wallet))
            if contrib:
                user_contribution = SeedContributionView(
                    buyer=str(contrib["buyer"]),
                    contributed_lamports=contrib["contributed_lamports"],
                    tokens_owed=contrib["tokens_owed"],
                    claimed=contrib["claimed"],
                    pda=str(contrib["pda"]),
                )
        except Exception:
            user_contribution = None

    return SeedSaleStateResponse(
        sale=str(sale_info["pda"]),
        authority=str(sale_info["authority"]),
        mint=str(sale_info["mint"]),
        seed_vault=str(sale_info["seed_vault"]),
        vault_authority=str(sale_info["vault_authority"]),
        treasury=str(sale_info["treasury"]),
        start_ts=sale_info["start_ts"],
        end_ts=sale_info["end_ts"],
        price_tokens_per_sol=sale_info["price_tokens_per_sol"],
        token_cap=sale_info["token_cap"],
        sol_cap_lamports=sale_info["sol_cap_lamports"],
        sold_tokens=sale_info["sold_tokens"],
        raised_lamports=sale_info["raised_lamports"],
        is_canceled=sale_info["is_canceled"],
        vault_balance=vault_balance,
        treasury_balance=treasury_balance,
        contributor_count=contributor_count,
        tokens_remaining=tokens_remaining,
        sol_remaining=sol_remaining,
        token_decimals=auth_settings.mochi_token_decimals,
        user_contribution=user_contribution,
    )


@app.post("/seed_sale/contribute/build", response_model=SeedContributeBuildResponse)
def seed_sale_contribute(req: SeedContributeRequest):
    sale_info = load_seed_sale_state()
    now = int(time.time())
    if sale_info["is_canceled"]:
        raise HTTPException(status_code=400, detail="Seed sale is canceled")
    if now < sale_info["start_ts"]:
        raise HTTPException(status_code=400, detail="Seed sale not started")
    if now > sale_info["end_ts"]:
        raise HTTPException(status_code=400, detail="Seed sale ended")

    lamports = req.lamports
    if lamports is None and req.sol is not None:
        lamports = int(req.sol * 1_000_000_000)
    if lamports is None:
        raise HTTPException(status_code=400, detail="lamports or sol amount is required")
    if lamports <= 0 or lamports < MIN_SEED_CONTRIB_LAMPORTS:
        raise HTTPException(status_code=400, detail="Contribution too small (min 0.01 SOL)")

    tokens_owed = lamports * sale_info["price_tokens_per_sol"]
    if sale_info["token_cap"] > 0 and sale_info["sold_tokens"] + tokens_owed > sale_info["token_cap"]:
        raise HTTPException(status_code=400, detail="Token cap would be exceeded by this contribution")
    if sale_info["sol_cap_lamports"] > 0 and sale_info["raised_lamports"] + lamports > sale_info["sol_cap_lamports"]:
        raise HTTPException(status_code=400, detail="SOL cap would be exceeded by this contribution")

    try:
        buyer = to_pubkey(req.wallet)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid wallet: {exc}") from exc
    ix = build_seed_contribute_ix(
        buyer=buyer,
        authority=sale_info["authority"],
        mint=sale_info["mint"],
        treasury=sale_info["treasury"],
        lamports=lamports,
    )
    instructions = [ix]
    blockhash = get_latest_blockhash()
    payer = buyer
    instrs_meta = [wrap_instruction_meta(instruction_to_dict(ix_)) for ix_ in instructions]
    return SeedContributeBuildResponse(
        tx_b64=message_from_instructions(instructions, payer, blockhash),
        tx_v0_b64=versioned_tx_b64(payer, blockhash, instructions),
        recent_blockhash=blockhash,
        instructions=instrs_meta,
        lamports=lamports,
        tokens_owed=tokens_owed,
        sale=str(sale_info["pda"]),
        mint=str(sale_info["mint"]),
        start_ts=sale_info["start_ts"],
        end_ts=sale_info["end_ts"],
        contribution_pda=str(seed_contribution_pda(sale_info["pda"], buyer)),
    )


@app.post("/seed_sale/claim/build", response_model=SeedClaimBuildResponse)
def seed_sale_claim(req: SeedClaimRequest):
    sale_info = load_seed_sale_state()
    now = int(time.time())
    if sale_info["is_canceled"]:
        raise HTTPException(status_code=400, detail="Seed sale is canceled")
    if now <= sale_info["end_ts"]:
        raise HTTPException(status_code=400, detail="Seed sale not ended yet")

    try:
        buyer = to_pubkey(req.wallet)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid wallet: {exc}") from exc
    contrib = load_seed_contribution(sale_info["pda"], buyer)
    if not contrib:
        raise HTTPException(status_code=404, detail="No contribution found for this wallet")
    if contrib["claimed"]:
        raise HTTPException(status_code=400, detail="Contribution already claimed")
    claimable = contrib["tokens_owed"]
    if claimable <= 0:
        raise HTTPException(status_code=400, detail="Nothing to claim")

    user_ata = to_pubkey(req.user_token_account) if req.user_token_account else derive_ata(buyer, sale_info["mint"])
    needs_ata = False
    try:
        ata_info = sol_client.get_account_info(user_ata)
        needs_ata = ata_info.value is None
    except Exception:
        needs_ata = False

    instructions: List[Instruction] = []
    if needs_ata:
        instructions.append(build_create_ata_ix(payer=buyer, owner=buyer, mint=sale_info["mint"]))
    try:
        vault_balance_resp = sol_client.get_token_account_balance(sale_info["seed_vault"])
        if vault_balance_resp.value is not None:
            available = int(vault_balance_resp.value.amount)
            if available < claimable:
                raise HTTPException(status_code=400, detail="Seed vault balance is insufficient for claim")
    except HTTPException:
        raise
    except Exception:
        # skip balance check if RPC fails
        pass

    claim_ix = build_seed_claim_ix(
        buyer=buyer,
        authority=sale_info["authority"],
        mint=sale_info["mint"],
        user_ata=user_ata,
    )
    instructions.append(claim_ix)
    blockhash = get_latest_blockhash()
    instrs_meta = [wrap_instruction_meta(instruction_to_dict(ix_)) for ix_ in instructions]
    return SeedClaimBuildResponse(
        tx_b64=message_from_instructions(instructions, buyer, blockhash),
        tx_v0_b64=versioned_tx_b64(buyer, blockhash, instructions),
        recent_blockhash=blockhash,
        instructions=instrs_meta,
        claimable_tokens=claimable,
        sale=str(sale_info["pda"]),
        mint=str(sale_info["mint"]),
        user_ata=str(user_ata),
        contribution_pda=str(contrib["pda"]),
    )


@app.post("/program/open/preview", response_model=PackPreviewResponse)
def preview_pack(req: PackPreviewRequest, db: Session = Depends(get_session)):
    if req.pack_type != "meg_web":
        raise HTTPException(status_code=400, detail="Unsupported pack type")
    nonce = compute_nonce(req.client_seed)
    rng = build_rng(auth_settings.server_seed, req.client_seed)
    rarities = slot_rarities(rng)
    template_ids = pick_template_ids(rng, rarities, db)
    slots = [
        PackSlot(slot_index=i, rarity=rarity, template_id=template_ids[i]) for i, rarity in enumerate(rarities)
    ]
    return PackPreviewResponse(
        server_seed_hash=SERVER_SEED_HASH,
        server_nonce=nonce,
        entropy_proof=entropy_hex(req.client_seed, nonce),
        slots=slots,
    )


@app.post("/program/open/build", response_model=PackBuildResponse)
def build_pack(req: PackBuildRequest, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 build deprecated; use /program/v2/open/build")


@app.post("/program/v2/open/build", response_model=PackBuildResponse)
def build_pack_v2(req: PackBuildV2Request, db: Session = Depends(get_session)):
    is_sol = req.currency.upper() == "SOL"
    if not is_sol:
        if not (req.user_token_account and req.vault_token_account):
            raise HTTPException(status_code=400, detail="Token currency requires token accounts")
    vault_state = vault_state_pda()
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(req.wallet))
    if pda_exists(pack_session):
        resp = sol_client.get_account_info(pack_session)
        info = parse_pack_session_v2_account(bytes(resp.value.data)) if resp.value and resp.value.data else None
        if info and info.get("state") == "pending":
            raise HTTPException(
                status_code=400,
                detail="A v2 pack session already exists. Claim, sell back, or expire it before opening another.",
            )

    nonce = compute_nonce(req.client_seed)
    rng = build_rng(auth_settings.server_seed, req.client_seed)
    rarities = slot_rarities(rng)
    template_ids = pick_template_ids(rng, rarities, db)
    rare_indices, rare_templates, rare_assets = choose_rare_assets_only(template_ids, rarities, req.wallet, db)
    rare_card_records = [card_record_pda(vault_state, to_pubkey(asset)) for asset in rare_assets]
    for cr in rare_card_records:
        if not pda_exists(cr):
            raise HTTPException(status_code=400, detail=f"CardRecord PDA missing on-chain: {cr}")

    client_seed_hash = hashlib.sha256(req.client_seed.encode()).digest()
    currency = "Sol" if is_sol else "Token"
    user_token_account = to_pubkey(req.user_token_account) if req.user_token_account else None
    vault_token_account = to_pubkey(req.vault_token_account) if req.vault_token_account else None
    open_ix = build_open_pack_v2_ix(
        user=to_pubkey(req.wallet),
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority_pda(vault_state),
        vault_treasury=treasury_pubkey(),
        rare_card_records=rare_card_records,
        currency=currency,
        client_seed_hash=client_seed_hash,
        rare_templates=rare_templates,
        user_currency_token=user_token_account,
        vault_currency_token=vault_token_account,
    )
    compute_ix = set_compute_unit_limit(units=350_000)
    instructions = [compute_ix, open_ix]
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions(instructions, to_pubkey(req.wallet), blockhash)
    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, instructions)
    instrs_meta = [wrap_instruction_meta(instruction_to_dict(ix_)) for ix_ in instructions]

    lineup: List[PackSlot] = []
    rare_set = set(rare_indices)
    for idx, rarity in enumerate(rarities):
        lineup.append(
            PackSlot(
                slot_index=idx,
                rarity=rarity,
                template_id=template_ids[idx],
                is_nft=idx in rare_set,
            )
        )

    provably_fair = {
        "server_seed_hash": SERVER_SEED_HASH,
        "server_nonce": nonce,
        "client_seed": req.client_seed,
        "templates": templates_to_csv(template_ids),
        "rarities": ",".join(rarities),
        "entropy_proof": entropy_hex(req.client_seed, nonce),
    }
    session_id = str(pack_session)
    expires_at = time.time() + auth_settings.claim_window_seconds if hasattr(auth_settings, "claim_window_seconds") else time.time() + 3600
    mirror = db.get(SessionMirror, session_id)
    if not mirror:
        mirror = SessionMirror(
            session_id=session_id,
            user=req.wallet,
            rarities=",".join(rarities),
            asset_ids=",".join(rare_assets),
            server_seed_hash=SERVER_SEED_HASH,
            server_nonce=nonce,
            state="building",
            created_at=time.time(),
            expires_at=expires_at,
            template_ids=templates_to_csv(template_ids),
            version=2,
        )
    else:
        mirror.user = req.wallet
        mirror.rarities = ",".join(rarities)
        mirror.asset_ids = ",".join(rare_assets)
        mirror.server_seed_hash = SERVER_SEED_HASH
        mirror.server_nonce = nonce
        mirror.state = "building"
        mirror.expires_at = expires_at
        mirror.template_ids = templates_to_csv(template_ids)
        mirror.version = 2
    db.add(mirror)
    db.commit()

    return PackBuildResponse(
        tx_b64=tx_b64,
        tx_v0_b64=tx_v0_b64,
        recent_blockhash=blockhash,
        session_id=session_id,
        lineup=lineup,
        provably_fair=provably_fair,
        instructions=instrs_meta,
    )


@app.get("/program/session/pending", response_model=PendingSessionResponse)
def get_pending_session(wallet: str, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 pending deprecated; use /program/v2/session/pending")


@app.post("/program/claim/build", response_model=TxResponse)
def claim_pack(req: SessionActionRequest, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 claim deprecated; use /program/v2/claim/build")


def _session_and_cards(wallet: str):
    vault_state = vault_state_pda()
    pack_session = pack_session_pda(vault_state, to_pubkey(wallet))
    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Session not found on-chain")
    session_info = parse_pack_session_account(bytes(resp.value.data))
    if not session_info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    if session_info.get("state") != "pending":
        raise HTTPException(status_code=400, detail=f"Session in state {session_info.get('state')}")
    if time.time() > session_info.get("expires_at", 0):
        raise HTTPException(status_code=400, detail="Session expired")
    card_records = session_info.get("card_record_keys", [])
    if len(card_records) != PACK_CARD_COUNT:
        raise HTTPException(status_code=400, detail="Incomplete card_record_keys in session")
    return vault_state, pack_session, session_info, card_records


def _chunk(lst: List[str], sizes: List[int]) -> List[List[str]]:
    out = []
    idx = 0
    for sz in sizes:
        if idx >= len(lst):
            break
        out.append(lst[idx : idx + sz])
        idx += sz
    if idx < len(lst):
        out.append(lst[idx:])
    return [chunk for chunk in out if chunk]


@app.post("/program/claim/batch_flow", response_model=MultiTxResponse)
def claim_pack_batch_flow(req: SessionActionRequest, db: Session = Depends(get_session)):
    """
    Build a series of batch claim txs (default 3/3/3/2) plus finalize_claim.
    """
    raise HTTPException(status_code=410, detail="v1 claim deprecated; use /program/v2/claim/build")


@app.post("/program/claim/test3", response_model=TxResponse)
def claim_pack_test3(req: TestClaim3Request, db: Session = Depends(get_session)):
    """
    Build a single tx to claim exactly 3 cards (benchmark).
    """
    raise HTTPException(status_code=410, detail="v1 claim deprecated; use /program/v2/claim/build")


@app.post("/program/claim/batch", response_model=TxResponse)
def claim_pack_batch(req: BatchClaimRequest, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 claim deprecated; use /program/v2/claim/build")


@app.post("/program/v2/claim/build", response_model=TxResponse)
def claim_pack_v2(req: SessionActionV2Request, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(req.wallet))
    treasury = treasury_pubkey()

    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Session not found on-chain")
    session_info = parse_pack_session_v2_account(bytes(resp.value.data))
    if not session_info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    if session_info.get("state") != "pending":
        raise HTTPException(status_code=400, detail=f"Session in state {session_info.get('state')}")
    if time.time() > session_info.get("expires_at", 0):
        raise HTTPException(status_code=400, detail="Session expired")

    rare_cards = session_info.get("rare_cards", [])
    core_assets: List[Pubkey] = []
    for cr in rare_cards:
        cr_resp = sol_client.get_account_info(cr)
        if cr_resp.value is None or cr_resp.value.data is None:
            raise HTTPException(status_code=400, detail=f"CardRecord PDA missing on-chain: {cr}")
        record_info = parse_card_record_account(bytes(cr_resp.value.data))
        if not record_info:
            raise HTTPException(status_code=400, detail=f"Could not parse CardRecord: {cr}")
        if record_info["status"] != 1 or str(record_info["owner"]) != req.wallet:
            raise HTTPException(status_code=400, detail="Cards are not reserved; please reset and reopen the pack.")
        core_assets.append(record_info["core_asset"])

    ix = build_claim_pack_v2_ix(
        user=to_pubkey(req.wallet),
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        vault_treasury=treasury,
        card_records=rare_cards,
        core_assets=core_assets,
    )
    compute_ix = set_compute_unit_limit(units=350_000)
    instructions = [compute_ix, ix]
    blockhash = get_latest_blockhash()
    payer = to_pubkey(req.wallet)
    tx_b64 = message_from_instructions(instructions, payer, blockhash)
    tx_v0_b64 = versioned_tx_b64(payer, blockhash, instructions)
    instrs_meta = [wrap_instruction_meta(instruction_to_dict(ix_)) for ix_ in instructions]

    return TxResponse(
        tx_b64=tx_b64,
        tx_v0_b64=tx_v0_b64,
        recent_blockhash=blockhash,
        instructions=instrs_meta,
    )


@app.post("/program/claim/finalize", response_model=TxResponse)
def finalize_claim(wallet: str, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 claim deprecated; use /program/v2/claim/build")


def wait_for_confirmation(signature: str, timeout_sec: int = 30) -> bool:
    start = time.time()
    try:
        sig_obj = Signature.from_string(signature)
    except Exception:
        sig_obj = signature  # fallback to raw string
    while time.time() - start < timeout_sec:
        resp = sol_client.get_signature_statuses([sig_obj])
        if resp.value and resp.value[0]:
            status = resp.value[0]
            if status.err is not None:
                return False
            if status.confirmation_status:
                return True
        time.sleep(0.8)
    return False


def sync_from_chain(wallet: str, db: Session) -> dict:
    """Mirror on-chain PackSession + CardRecords to DB for a single wallet."""
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    pack_session = pack_session_pda(vault_state, to_pubkey(wallet))
    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        return {"session_state": None, "assets": []}
    info = parse_pack_session_account(bytes(resp.value.data))
    if not info:
        return {"session_state": None, "assets": []}
    state = info.get("state")
    assets: list[str] = []
    now = time.time()
    rarities = []
    for cr_key in info["card_record_keys"]:
        cr_resp = sol_client.get_account_info(cr_key)
        if cr_resp.value and cr_resp.value.data:
            record_info = parse_card_record_account(bytes(cr_resp.value.data))
            if record_info:
                asset_id = str(record_info["core_asset"])
                assets.append(asset_id)
                rarities.append(record_info["rarity"])
                rec = db.get(MintRecord, asset_id)
                if rec:
                    status_idx = record_info["status"]
                    status_label = CARD_STATUS_LABELS[status_idx] if 0 <= status_idx < len(CARD_STATUS_LABELS) else rec.status
                    rec.status = status_label
                    rec.owner = str(record_info["owner"])
                    rec.updated_at = now
                    db.add(rec)
    # Update mirror
    session_id = str(pack_session)
    mirror = db.get(SessionMirror, session_id)
    if not mirror:
        mirror = SessionMirror(
            session_id=session_id,
            user=wallet,
            rarities=",".join(rarities),
            asset_ids=",".join(assets),
            server_seed_hash=SERVER_SEED_HASH,
            server_nonce=info["client_seed_hash"].hex(),
            state=state or "pending",
            created_at=float(info.get("created_at", now)),
            expires_at=float(info.get("expires_at", now)),
        )
    else:
        mirror.state = state or mirror.state
        mirror.asset_ids = ",".join(assets)
        mirror.rarities = ",".join(rarities)
        mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
    db.add(mirror)
    db.commit()
    # If session not pending, release any reserved -> available for this session's assets
    if state and state != "pending":
        for asset in assets:
            rec = db.get(MintRecord, asset)
            if rec and rec.status == "reserved":
                rec.status = "available"
                rec.owner = str(vault_authority)
                rec.updated_at = now
                db.add(rec)
        db.commit()
    return {"session_state": state, "assets": assets}


@app.post("/program/open/confirm")
def confirm_open(req: ConfirmOpenRequest, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 confirm deprecated; use /program/v2/open/confirm")


@app.post("/program/v2/open/confirm")
def confirm_open_v2(req: ConfirmOpenRequest, db: Session = Depends(get_session)):
    signature = req.signature
    wallet = req.wallet
    if not wait_for_confirmation(signature):
        raise HTTPException(status_code=400, detail="Signature not confirmed or transaction failed")

    vault_state = vault_state_pda()
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(wallet))
    info = None
    # Retry briefly to avoid flakiness right after confirmation.
    for _ in range(5):
        resp = sol_client.get_account_info(pack_session)
        if resp.value and resp.value.data:
            info = parse_pack_session_v2_account(bytes(resp.value.data))
            if info:
                break
        time.sleep(0.5)
    if not info:
        raise HTTPException(status_code=400, detail="Pack session v2 not found or unparsable after confirmation")
    on_state = info.get("state")
    if on_state not in ["pending", "accepted"]:
        raise HTTPException(status_code=400, detail=f"Unexpected on-chain session state {on_state}")

    session_id = str(pack_session)
    mirror = db.get(SessionMirror, session_id)
    rarities = mirror.rarities.split(",") if mirror and mirror.rarities else []
    template_ids = parse_templates(mirror.template_ids) if mirror and mirror.template_ids else []
    client_rarities = req.rarities or []
    client_templates = req.template_ids or []
    if not rarities and client_rarities:
        rarities = client_rarities
    if not template_ids and client_templates:
        template_ids = client_templates
    if rarities and template_ids and len(template_ids) < len(rarities):
        template_ids = list(template_ids) + [None] * (len(rarities) - len(template_ids))

    rare_cards = info.get("rare_cards", [])
    rare_assets: List[str] = []
    now = time.time()
    for cr in rare_cards:
        cr_resp = sol_client.get_account_info(cr)
        if cr_resp.value is None or cr_resp.value.data is None:
            raise HTTPException(status_code=400, detail=f"CardRecord missing on-chain: {cr}")
        record_info = parse_card_record_account(bytes(cr_resp.value.data))
        if not record_info:
            raise HTTPException(status_code=400, detail=f"Could not parse CardRecord: {cr}")
        if record_info["status"] not in [1, 2] or str(record_info["owner"]) != wallet:
            raise HTTPException(status_code=400, detail="Cards are not reserved; please reset and reopen the pack.")
        asset_id = str(record_info["core_asset"])
        rare_assets.append(asset_id)
        rec = db.get(MintRecord, asset_id)
        if rec:
            rec.status = "reserved"
            rec.owner = wallet
            rec.updated_at = now
            db.add(rec)

    nonce_hex = req.server_nonce or info.get("client_seed_hash", b"").hex()
    if not mirror:
        mirror = SessionMirror(
            session_id=session_id,
            user=wallet,
            rarities=",".join(rarities),
            asset_ids=",".join(rare_assets),
            server_seed_hash=SERVER_SEED_HASH,
            server_nonce=nonce_hex,
            state=on_state or "pending",
            created_at=float(info.get("created_at", now)),
            expires_at=float(info.get("expires_at", now + 3600)),
            template_ids=",".join("" if t is None else str(t) for t in template_ids),
            version=2,
        )
    else:
        mirror.state = on_state or "pending"
        if rarities:
            mirror.rarities = ",".join(rarities)
        if template_ids:
            mirror.template_ids = ",".join("" if t is None else str(t) for t in template_ids)
        mirror.asset_ids = ",".join(rare_assets)
        mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
        mirror.server_nonce = nonce_hex
        mirror.version = 2
    db.add(mirror)
    db.commit()

    # Add low-tier virtuals on open (only if we have a usable lineup).
    if rarities and template_ids:
        mutate_virtual_cards(wallet, low_tier_virtual_items(rarities, template_ids), db, direction=1)
    return {"state": on_state, "assets": rare_assets}


@app.post("/program/claim/confirm")
def confirm_claim(req: ConfirmClaimRequest, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 confirm deprecated; use /program/v2/claim/confirm")


@app.post("/program/v2/claim/confirm")
def confirm_claim_v2(req: ConfirmClaimRequest, db: Session = Depends(get_session)):
    signature = req.signature
    wallet = req.wallet
    if not wait_for_confirmation(signature):
        raise HTTPException(status_code=400, detail="Signature not confirmed")

    vault_state = vault_state_pda()
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(wallet))
    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Session not found on-chain")
    info = parse_pack_session_v2_account(bytes(resp.value.data))
    if not info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    state = info.get("state")
    if state != "accepted":
        raise HTTPException(status_code=400, detail=f"On-chain session state is {state}, expected accepted")

    rare_cards = info.get("rare_cards", [])
    assets: list[str] = []
    now = time.time()
    for cr in rare_cards:
        cr_resp = sol_client.get_account_info(cr)
        if cr_resp.value and cr_resp.value.data:
            record_info = parse_card_record_account(bytes(cr_resp.value.data))
            if record_info:
                asset_id = str(record_info["core_asset"])
                assets.append(asset_id)
                rec = db.get(MintRecord, asset_id)
                if rec:
                    rec.status = "user_owned"
                    rec.owner = wallet
                    rec.updated_at = now
                    db.add(rec)
    mirror = db.get(SessionMirror, str(pack_session))
    if mirror:
        mirror.state = "accepted"
        mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
        mirror.version = 2
        db.add(mirror)
    db.commit()
    return {"state": state, "assets": assets}


@app.post("/program/v2/claim/cleanup")
def claim_cleanup(req: ClaimCleanupRequest, db: Session = Depends(get_session)):
    """Best-effort cleanup if UI and on-chain get out of sync after claim/sellback/expire."""
    wallet = req.wallet
    vault_state = vault_state_pda()
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(wallet))
    resp = sol_client.get_account_info(pack_session)
    if resp.value and resp.value.data:
        info = parse_pack_session_v2_account(bytes(resp.value.data))
        if info and info.get("state") != "pending":
            # Mirror to DB and let frontend reopen
            mirror = db.get(SessionMirror, str(pack_session))
            if mirror:
                mirror.state = info.get("state", mirror.state)
                mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
                mirror.version = 2
                db.add(mirror)
                db.commit()
            return {"state": info.get("state"), "cleared": False}
    # If no account or already cleared, delete mirrors
    mirror = db.get(SessionMirror, str(pack_session))
    if mirror:
        db.delete(mirror)
        db.commit()
    return {"state": "cleared", "cleared": True}


@app.post("/program/sellback/confirm")
def confirm_sellback(signature: str, wallet: str, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 confirm deprecated; use /program/v2/sellback/confirm")


@app.post("/program/v2/sellback/confirm")
def confirm_sellback_v2(signature: str, wallet: str, db: Session = Depends(get_session)):
    if not wait_for_confirmation(signature):
        raise HTTPException(status_code=400, detail="Signature not confirmed")

    vault_state = vault_state_pda()
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(wallet))
    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Session not found on-chain")
    info = parse_pack_session_v2_account(bytes(resp.value.data))
    if not info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    state = info.get("state")
    if state != "rejected":
        raise HTTPException(status_code=400, detail=f"On-chain session state is {state}, expected rejected")

    session_id = str(pack_session)
    mirror = db.get(SessionMirror, session_id)
    rarities = mirror.rarities.split(",") if mirror else []
    template_ids = parse_templates(mirror.template_ids) if mirror else []

    now = time.time()
    assets: list[str] = []
    for cr in info.get("rare_cards", []):
        cr_resp = sol_client.get_account_info(cr)
        if cr_resp.value and cr_resp.value.data:
            record_info = parse_card_record_account(bytes(cr_resp.value.data))
            if record_info:
                asset_id = str(record_info["core_asset"])
                assets.append(asset_id)
                rec = db.get(MintRecord, asset_id)
                if rec:
                    rec.status = "available"
                    rec.owner = str(vault_authority_pda(vault_state))
                    rec.updated_at = now
                    db.add(rec)
    if mirror:
        mirror.state = "rejected"
        mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
        mirror.version = 2
        db.add(mirror)
    db.commit()
    # Remove the low-tier virtual cards that were added on open.
    if rarities and template_ids:
        mutate_virtual_cards(wallet, low_tier_virtual_items(rarities, template_ids), db, direction=-1)
    return {"state": state, "assets": assets}


@app.post("/program/v2/expire/confirm")
def confirm_expire_v2(signature: str, wallet: str, db: Session = Depends(get_session)):
    if not wait_for_confirmation(signature):
        raise HTTPException(status_code=400, detail="Signature not confirmed")

    vault_state = vault_state_pda()
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(wallet))
    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Session not found on-chain")
    info = parse_pack_session_v2_account(bytes(resp.value.data))
    if not info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    state = info.get("state")
    if state != "expired":
        raise HTTPException(status_code=400, detail=f"On-chain session state is {state}, expected expired")

    session_id = str(pack_session)
    mirror = db.get(SessionMirror, session_id)
    rarities = mirror.rarities.split(",") if mirror else []
    template_ids = parse_templates(mirror.template_ids) if mirror else []

    now = time.time()
    assets: list[str] = []
    for cr in info.get("rare_cards", []):
        cr_resp = sol_client.get_account_info(cr)
        if cr_resp.value and cr_resp.value.data:
            record_info = parse_card_record_account(bytes(cr_resp.value.data))
            if record_info:
                asset_id = str(record_info["core_asset"])
                assets.append(asset_id)
                rec = db.get(MintRecord, asset_id)
                if rec:
                    rec.status = "available"
                    rec.owner = str(vault_authority_pda(vault_state))
                    rec.updated_at = now
                    db.add(rec)
    if mirror:
        mirror.state = "expired"
        mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
        mirror.version = 2
        db.add(mirror)
    db.commit()
    if rarities and template_ids:
        mutate_virtual_cards(wallet, low_tier_virtual_items(rarities, template_ids), db, direction=-1)
    return {"state": state, "assets": assets}


@app.post("/program/open/reset_build", response_model=TxResponse)
def build_reset_pack(wallet: str, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 reset deprecated; use admin force-close if needed")


@app.post("/program/expire/build", response_model=TxResponse)
def expire_pack(req: SessionActionRequest, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 expire deprecated; use /program/v2/expire/build")


@app.post("/program/v2/expire/build", response_model=TxResponse)
def expire_pack_v2(req: SessionActionV2Request, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(req.wallet))
    treasury = treasury_pubkey()

    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Session not found on-chain")
    session_info = parse_pack_session_v2_account(bytes(resp.value.data))
    if not session_info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    if session_info.get("state") != "pending":
        raise HTTPException(status_code=400, detail=f"Session in state {session_info.get('state')}")
    if time.time() <= session_info.get("expires_at", 0):
        raise HTTPException(status_code=400, detail="Session not yet expired")

    rare_cards = session_info.get("rare_cards", [])
    ix = build_expire_session_v2_ix(
        user=to_pubkey(req.wallet),
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        vault_treasury=treasury,
        card_records=rare_cards,
    )
    blockhash = get_latest_blockhash()
    payer = to_pubkey(req.wallet)
    tx_b64 = message_from_instructions([ix], payer, blockhash)
    tx_v0_b64 = versioned_tx_b64(payer, blockhash, [ix])
    instr = wrap_instruction_meta(instruction_to_dict(ix))
    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.post("/program/sellback/build", response_model=TxResponse)
def sellback_pack(req: SessionActionRequest, db: Session = Depends(get_session)):
    raise HTTPException(status_code=410, detail="v1 sellback deprecated; use /program/v2/sellback/build")


@app.post("/program/v2/sellback/build", response_model=TxResponse)
def sellback_pack_v2(req: SessionActionV2Request, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(req.wallet))
    treasury = treasury_pubkey()

    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        raise HTTPException(status_code=404, detail="Session not found on-chain")
    session_info = parse_pack_session_v2_account(bytes(resp.value.data))
    if not session_info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    if session_info.get("state") != "pending":
        raise HTTPException(status_code=400, detail=f"Session in state {session_info.get('state')}")
    if time.time() > session_info.get("expires_at", 0):
        raise HTTPException(status_code=400, detail="Session expired")

    rare_cards = session_info.get("rare_cards", [])
    core_assets: List[Pubkey] = []
    for cr in rare_cards:
        cr_resp = sol_client.get_account_info(cr)
        if cr_resp.value is None or cr_resp.value.data is None:
            raise HTTPException(status_code=400, detail=f"CardRecord PDA missing on-chain: {cr}")
        record_info = parse_card_record_account(bytes(cr_resp.value.data))
        if not record_info:
            raise HTTPException(status_code=400, detail=f"Could not parse CardRecord: {cr}")
        core_assets.append(record_info["core_asset"])

    ix = build_sellback_pack_v2_ix(
        user=to_pubkey(req.wallet),
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        vault_treasury=treasury,
        card_records=rare_cards,
        core_assets=core_assets,
        user_currency_token=to_pubkey(req.user_token_account) if req.user_token_account else None,
        vault_currency_token=to_pubkey(req.vault_token_account) if req.vault_token_account else None,
    )
    blockhash = get_latest_blockhash()
    payer = to_pubkey(req.wallet)
    tx_b64 = message_from_instructions([ix], payer, blockhash)
    tx_v0_b64 = versioned_tx_b64(payer, blockhash, [ix])
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.get("/profile/{wallet}")
def profile(wallet: str):
    assets = helius_get_assets(wallet, auth_settings.core_collection_address)
    return {"wallet": wallet, "assets": assets}

@app.get("/program/v2/session/pending", response_model=PendingSessionResponse)
def get_pending_session_v2(wallet: str, db: Session = Depends(get_session)):
    now = time.time()
    vault_state = vault_state_pda()
    pack_session = pack_session_v2_pda(vault_state, to_pubkey(wallet))
    resp = sol_client.get_account_info(pack_session)
    if resp.value is None or resp.value.data is None:
        # Clear any stale mirror
        mirror = db.get(SessionMirror, str(pack_session))
        if mirror:
            db.delete(mirror)
            db.commit()
        raise HTTPException(status_code=404, detail="No active session")
    info = parse_pack_session_v2_account(bytes(resp.value.data))
    if not info:
        raise HTTPException(status_code=400, detail="Unable to parse on-chain session")
    state = info.get("state")
    if state != "pending":
        # Update mirror and return 404 so UI can open again
        mirror = db.get(SessionMirror, str(pack_session))
        if mirror:
            mirror.state = state
            mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
            db.add(mirror)
            db.commit()
        raise HTTPException(status_code=404, detail=f"No pending session (state={state})")

    mirror = db.get(SessionMirror, str(pack_session))
    # Prefer mirror for full lineup
    rarities = mirror.rarities.split(",") if mirror and mirror.rarities else []
    templates = parse_templates(mirror.template_ids) if mirror and mirror.template_ids else []
    assets = parse_asset_ids(mirror.asset_ids) if mirror and mirror.asset_ids else []

    # Build rare set from on-chain rare_cards
    rare_templates = set(info.get("rare_templates", []) or [])
    rare_indices = {idx for idx, r in enumerate(rarities) if rarity_is_rare_plus(r)}
    # If mirror missing, fallback minimal
    if not rarities and mirror:
        rarities = mirror.rarities.split(",") if mirror.rarities else []
        templates = parse_templates(mirror.template_ids) if mirror.template_ids else []
    lineup: List[PackSlot] = []
    for idx, rarity in enumerate(rarities):
        tmpl_id = templates[idx] if idx < len(templates) else None
        is_nft = rarity_is_rare_plus(rarity) or (tmpl_id in rare_templates) or (idx in rare_indices)
        lineup.append(
            PackSlot(
                slot_index=idx,
                rarity=rarity,
                template_id=tmpl_id,
                is_nft=is_nft,
            )
        )

    countdown = int(max(0, info.get("expires_at", now) - now))
    provably_fair = {
        "server_seed_hash": SERVER_SEED_HASH,
        "server_nonce": info.get("client_seed_hash", b"").hex(),
        "assets": ",".join(assets),
        "rarities": ",".join(rarities),
        "templates": ",".join(str(t) for t in templates),
    }

    # Upsert mirror to match on-chain
    if not mirror:
        mirror = SessionMirror(
            session_id=str(pack_session),
            user=wallet,
            rarities=",".join(rarities),
            asset_ids=",".join(assets),
            server_seed_hash=SERVER_SEED_HASH,
            server_nonce=info.get("client_seed_hash", b"").hex(),
            state="pending",
            created_at=float(info.get("created_at", now)),
            expires_at=float(info.get("expires_at", now + 3600)),
            template_ids=",".join(str(t) for t in templates),
            version=2,
        )
    else:
        mirror.state = "pending"
        mirror.asset_ids = ",".join(assets)
        mirror.rarities = ",".join(rarities)
        mirror.template_ids = ",".join(str(t) for t in templates)
        mirror.expires_at = float(info.get("expires_at", mirror.expires_at))
        mirror.version = 2
    db.add(mirror)
    db.commit()

    return PendingSessionResponse(
        session_id=mirror.session_id,
        wallet=mirror.user,
        expires_at=mirror.expires_at,
        countdown_seconds=countdown,
        lineup=lineup,
        asset_ids=assets,
        provably_fair=provably_fair,
    )


@app.get("/profile/{wallet}/virtual", response_model=List[VirtualCardView])
def profile_virtual(wallet: str, db: Session = Depends(get_session)):
    stmt = select(VirtualCard).where(VirtualCard.wallet == wallet)
    rows = db.exec(stmt).all()
    result: List[VirtualCardView] = []
    for row in rows:
        tmpl = db.get(CardTemplate, row.template_id) if row.template_id is not None else None
        result.append(
            VirtualCardView(
                template_id=row.template_id,
                rarity=row.rarity,
                count=row.count,
                name=tmpl.card_name if tmpl else None,
                image_url=tmpl.image_url if tmpl else None,
                is_energy=tmpl.is_energy if tmpl else None,
            )
        )
    return result


@app.post("/profile/recycle/build", response_model=TxResponse)
def recycle_build(req: RecycleBuildRequest, db: Session = Depends(get_session)):
    if not req.items:
        raise HTTPException(status_code=400, detail="No items provided for recycle")
    mint_str = auth_settings.mochi_token_mint
    if not mint_str:
        raise HTTPException(status_code=500, detail="MOCHI_TOKEN_MINT not configured")
    # Validate inventory
    balance: Dict[int, int] = {}
    stmt = select(VirtualCard).where(VirtualCard.wallet == req.wallet)
    for row in db.exec(stmt).all():
        balance[row.template_id] = row.count
    total_cards = 0
    for item in req.items:
        have = balance.get(item.template_id, 0)
        if have < item.count:
            raise HTTPException(status_code=400, detail=f"Not enough virtual cards for template {item.template_id}")
        total_cards += item.count
    if total_cards < auth_settings.recycle_rate:
        raise HTTPException(status_code=400, detail=f"Need at least {auth_settings.recycle_rate} cards to recycle")

    reward_tokens = total_cards // auth_settings.recycle_rate
    if reward_tokens <= 0:
        raise HTTPException(status_code=400, detail="Recycle did not produce any rewards")
    reward_amount = reward_tokens * (10 ** auth_settings.mochi_token_decimals)

    admin_kp = load_admin_keypair()
    admin_pub = admin_kp.pubkey()
    mint_pub = to_pubkey(mint_str)
    dest_token = to_pubkey(req.user_token_account)
    mint_ix = build_mint_to_ix(mint_pub, dest_token, admin_pub, reward_amount)
    blockhash = get_latest_blockhash()
    message = MessageV0.try_compile(admin_pub, [mint_ix], [], Hash.from_string(blockhash))
    tx = VersionedTransaction(message, [admin_kp])
    tx_b64 = base64.b64encode(bytes(tx)).decode()
    tx_v0_b64 = tx_b64  # already versioned message
    instr = wrap_instruction_meta(instruction_to_dict(mint_ix))

    # Deduct recycled cards and log
    expanded: List[tuple[int, str]] = []
    for item in req.items:
        for _ in range(item.count):
            expanded.append((item.template_id, item.rarity))
    mutate_virtual_cards(req.wallet, expanded, db, direction=-1)
    db.add(RecycleLog(wallet=req.wallet, total_cards=total_cards, reward_amount=reward_amount))
    db.commit()

    return TxResponse(
        tx_b64=tx_b64,
        tx_v0_b64=tx_v0_b64,
        recent_blockhash=blockhash,
        instructions=[instr],
    )


@app.get("/marketplace/listings", response_model=List[ListingView])
def marketplace_listings(db: Session = Depends(get_session)):
    """
    Fall back to on-chain listing PDAs so drifted DB status won't hide items.
    Keep this light: no price snapshot aggregation to avoid DB pool exhaustion.
    """
    vault_state = vault_state_pda()
    # Listing account discriminator
    listing_disc = hashlib.sha256(b"account:Listing").digest()[:8]
    memcmp = MemcmpOpts(offset=0, bytes=listing_disc)
    try:
        resp = sol_client.get_program_accounts(
            PROGRAM_ID,
            encoding="base64",
            filters=[memcmp],
        )
        accounts = resp.value or []
    except Exception:
        accounts = []

    results: List[ListingView] = []
    seen: set[str] = set()

    for acc in accounts:
        info = acc.account
        if not info or info.owner != PROGRAM_ID:
            continue
        listing_data = None
        try:
            listing_data = parse_listing_account(bytes(info.data))
        except Exception:
            listing_data = None
        if not listing_data:
            continue
        # Ignore junk listings from other vaults or corrupted data.
        if str(listing_data.get("vault_state")) != str(vault_state):
            continue
        status = (listing_data.get("status") or "").lower()
        if status and status != "active":
            continue
        core_asset = str(listing_data.get("core_asset"))
        if core_asset in seen:
            continue
        seen.add(core_asset)

        row = db.exec(select(MintRecord).where(MintRecord.asset_id == core_asset)).first()
        card_meta = db.get(CardTemplate, row.template_id) if row and row.template_id else None
        results.append(
            ListingView(
                core_asset=core_asset,
                price_lamports=listing_data.get("price_lamports", 0),
                seller=str(listing_data.get("seller")),
                status=listing_data.get("status") or "active",
                currency_mint=str(listing_data.get("currency_mint")) if listing_data.get("currency_mint") else None,
                template_id=row.template_id if row else None,
                rarity=row.rarity if row else None,
                name=card_meta.card_name if card_meta else None,
                image_url=card_meta.image_url if card_meta else None,
                is_fake=bool(getattr(row, "is_fake", False)) if row else False,
                current_mid=None,
                high_90d=None,
                low_90d=None,
            )
        )
    return results


@app.get("/admin/marketplace/garbage")
def admin_garbage_listings():
    """
    Surface listing PDAs that are pointing at the wrong vault_state so we can clean them up.
    Only returns entries whose vault_state != the canonical vault_state_pda().
    """
    canonical = vault_state_pda()
    listing_disc = hashlib.sha256(b"account:Listing").digest()[:8]
    memcmp = MemcmpOpts(offset=0, bytes=listing_disc)
    try:
        resp = sol_client.get_program_accounts(
            PROGRAM_ID,
            encoding="base64",
            filters=[memcmp],
        )
        accounts = resp.value or []
    except Exception:
        accounts = []

    garbage: List[dict] = []
    for acc in accounts:
        info = acc.account
        if not info or info.owner != PROGRAM_ID:
            continue
        listing_data = None
        try:
            listing_data = parse_listing_account(bytes(info.data))
        except Exception:
            listing_data = None
        if not listing_data:
            continue
        if str(listing_data.get("vault_state")) == str(canonical):
            continue
        garbage.append(
            {
                "listing": str(acc.pubkey),
                "vault_state": str(listing_data.get("vault_state")),
                "seller": str(listing_data.get("seller")),
                "core_asset": str(listing_data.get("core_asset")),
                "price_lamports": listing_data.get("price_lamports"),
                "status": listing_data.get("status"),
            }
        )
    return garbage


@app.post("/marketplace/list/build", response_model=TxResponse)
def marketplace_list(req: ListRequest, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    canonical_vault = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    card_record = card_record_pda(vault_state, to_pubkey(req.core_asset))
    listing = listing_pda(vault_state, to_pubkey(req.core_asset))
    core_asset = to_pubkey(req.core_asset)

    # Hard guard: only allow listings against the canonical vault PDA.
    if str(vault_state) != str(canonical_vault):
        raise HTTPException(status_code=400, detail="Invalid vault_state; please reload and try again.")
    if not pda_exists(card_record):
        # With deposit-on-list we can initialize card_record on the fly, but we still require a known template/rarity.
        pass

    stmt = select(MintRecord).where(MintRecord.asset_id == req.core_asset)
    record = db.exec(stmt).first()
    is_fake = False
    template_id = None
    rarity_val = None
    if record:
        is_fake = bool(getattr(record, "is_fake", False))
        template_id = record.template_id
        rarity_val = record.rarity
    else:
        # Unknown NFT: allow list but mark fake and use placeholders
        is_fake = True
        template_id = 0
        rarity_val = "Unknown"
        record = MintRecord(
            asset_id=req.core_asset,
            template_id=template_id,
            rarity=rarity_val,
            status="listed",
            owner=req.wallet,
            is_fake=True,
        )

    def rarity_index(val: str) -> int:
        norm = normalized_rarity(val)
        for idx, label in enumerate(RARITY_LABELS):
            if normalized_rarity(label) == norm:
                return idx
        return 0  # default to Common

    rarity_tag = rarity_index(rarity_val or "Common")

    instructions = []

    # Optional MOCHI listing fee
    fee_amount = getattr(auth_settings, "listing_fee_mochi", 0) or 0
    mochi_mint_str = getattr(auth_settings, "mochi_token_mint", None)
    if fee_amount and mochi_mint_str:
        mint = to_pubkey(mochi_mint_str)
        seller_pk = to_pubkey(req.wallet)
        treasury_pk = treasury_pubkey()
        seller_ata = derive_ata(seller_pk, mint)
        treasury_ata = derive_ata(treasury_pk, mint)
        if not pda_exists(seller_ata):
            instructions.append(build_create_ata_ix(seller_pk, seller_pk, mint, seller_ata))
        if not pda_exists(treasury_ata):
            instructions.append(build_create_ata_ix(seller_pk, treasury_pk, mint, treasury_ata))
        instructions.append(build_spl_transfer_ix(seller_ata, treasury_ata, seller_pk, fee_amount))

    ix = build_list_card_ix(
        seller=to_pubkey(req.wallet),
        vault_state=vault_state,
        card_record=card_record,
        core_asset=core_asset,
        listing=listing,
        vault_authority=vault_authority,
        price_lamports=req.price_lamports,
        currency_mint=req.currency_mint,
        template_id=template_id or 0,
        rarity_tag=rarity_tag,
    )
    instructions.append(ix)

    blockhash = get_latest_blockhash()
    payer = to_pubkey(req.wallet)
    tx_b64 = message_from_instructions(instructions, payer, blockhash)
    tx_v0_b64 = versioned_tx_b64(payer, blockhash, instructions)
    instrs_meta = [wrap_instruction_meta(instruction_to_dict(ix_)) for ix_ in instructions]

    # Mirror listing status
    record.status = "listed"
    record.owner = req.wallet
    record.updated_at = time.time()
    record.is_fake = is_fake
    db.add(record)
    db.commit()

    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=instrs_meta)


@app.post("/marketplace/fill/build", response_model=TxResponse)
def marketplace_fill(req: MarketplaceActionRequest, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    card_record = card_record_pda(vault_state, to_pubkey(req.core_asset))
    listing = listing_pda(vault_state, to_pubkey(req.core_asset))
    treasury = treasury_pubkey()
    if not pda_exists(card_record):
        raise HTTPException(status_code=400, detail="CardRecord PDA missing on-chain")
    resp_listing = sol_client.get_account_info(listing)
    if resp_listing.value is None:
        raise HTTPException(status_code=400, detail="Listing PDA missing on-chain; please relist")
    if str(resp_listing.value.owner) != str(PROGRAM_ID):
        raise HTTPException(
            status_code=400,
            detail="Listing PDA owned by wrong program; please relist to repair",
        )
    listing_info = None
    try:
        listing_info = parse_listing_account(bytes(resp_listing.value.data))
    except Exception:
        listing_info = None
    if not listing_info:
        raise HTTPException(status_code=400, detail="Unable to parse listing account")
    if listing_info.get("status") and listing_info["status"].lower() != "active":
        raise HTTPException(status_code=400, detail="Listing not active; please relist")
    price = listing_info.get("price_lamports", 0)
    if price <= 0:
        raise HTTPException(status_code=400, detail="Listing price invalid; please relist")

    stmt = select(MintRecord).where(MintRecord.asset_id == req.core_asset)
    record = db.exec(stmt).first()
    seller_pubkey = listing_info.get("seller") or (listing_owner_from_chain(vault_state, to_pubkey(req.core_asset)) or treasury)
    seller_pubkey = to_pubkey(str(seller_pubkey))

    ix = build_fill_listing_ix(
        buyer=to_pubkey(req.wallet),
        seller=seller_pubkey,
        vault_state=vault_state,
        card_record=card_record,
        listing=listing,
        vault_authority=vault_authority,
        vault_treasury=treasury,
    )
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions([ix], to_pubkey(req.wallet), blockhash)
    instr_fill = wrap_instruction_meta(instruction_to_dict(ix))

    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, [ix])
    return TxResponse(
        tx_b64=tx_b64,
        tx_v0_b64=tx_v0_b64,
        recent_blockhash=blockhash,
        instructions=[instr_fill],
    )


@app.post("/marketplace/cancel/build", response_model=TxResponse)
def marketplace_cancel(req: MarketplaceActionRequest, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    card_record = card_record_pda(vault_state, to_pubkey(req.core_asset))
    listing = listing_pda(vault_state, to_pubkey(req.core_asset))
    core_asset = to_pubkey(req.core_asset)

    ix = build_cancel_listing_ix(
        seller=to_pubkey(req.wallet),
        vault_state=vault_state,
        card_record=card_record,
        core_asset=core_asset,
        listing=listing,
        vault_authority=vault_authority,
    )
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions([ix], to_pubkey(req.wallet), blockhash)
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, [ix])
    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.get("/admin/inventory/rarity")
def admin_inventory(db: Session = Depends(get_session)):
    stmt = select(MintRecord)
    rows = db.exec(stmt).all()
    counts: Dict[str, int] = {}
    for row in rows:
        counts[row.rarity] = counts.get(row.rarity, 0) + 1
    vrows = db.exec(select(VirtualCard)).all()
    for row in vrows:
        key = f"virtual_{row.rarity}"
        counts[key] = counts.get(key, 0) + row.count
    return counts


@app.get("/pricing/rarity")
def pricing_rarity():
    return RARITY_PRICE_LAMPORTS


@app.get("/pricing/search", response_model=List[PricingSearchItem])
def pricing_search(q: str, limit: int = 20, db: Session = Depends(get_session)):
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query too short")
    limit = max(1, min(limit, 50))
    q_norm = f"%{q.strip().lower()}%"
    stmt = (
        select(CardTemplate)
        .where(func.lower(CardTemplate.card_name).like(q_norm))
        .limit(limit * 3)
    )
    templates = db.exec(stmt).all()
    results: List[PricingSearchItem] = []
    for tmpl in templates:
        pv = compute_price_view(tmpl.template_id, db)
        if not pv:
            continue
        snap = pv["latest"]
        history_points = fetch_history_points(tmpl.template_id, db, limit=30)
        results.append(
            PricingSearchItem(
                template_id=tmpl.template_id,
                name=tmpl.card_name,
                set_name=tmpl.set_name,
                rarity=tmpl.rarity,
                image_url=tmpl.image_url,
                mid_price=float(snap.mid_price),
                low_price=float(snap.low_price),
                high_price=float(snap.high_price),
                collected_at=float(snap.collected_at),
                display_price=pv["display_price"],
                fair_value=pv["fair_value"],
                price_confidence=pv["confidence"],
                confidence_score=pv["confidence"],
                sparkline=history_points,
            )
        )
        if len(results) >= limit:
            break
    return results


@app.get("/pricing/set", response_model=List[PricingSearchItem])
def pricing_set(set_name: str, limit: int = 200, db: Session = Depends(get_session)):
    if not set_name or len(set_name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Set name too short")
    limit = max(1, min(limit, 500))
    stmt = (
        select(CardTemplate)
        .where(func.lower(CardTemplate.set_name) == set_name.strip().lower())
        .order_by(CardTemplate.card_name.asc())
        .limit(limit * 2)
    )
    templates = db.exec(stmt).all()
    results: List[PricingSearchItem] = []
    for tmpl in templates:
        pv = compute_price_view(tmpl.template_id, db)
        if not pv:
            continue
        snap = pv["latest"]
        history_points = fetch_history_points(tmpl.template_id, db, limit=30)
        results.append(
            PricingSearchItem(
                template_id=tmpl.template_id,
                name=tmpl.card_name,
                set_name=tmpl.set_name,
                rarity=tmpl.rarity,
                image_url=tmpl.image_url,
                mid_price=float(snap.mid_price),
                low_price=float(snap.low_price),
                high_price=float(snap.high_price),
                collected_at=float(snap.collected_at),
                display_price=pv["display_price"],
                fair_value=pv["fair_value"],
                price_confidence=pv["confidence"],
                confidence_score=pv["confidence"],
                sparkline=history_points,
            )
        )
        if len(results) >= limit:
            break
    return results


@app.get("/pricing/sets", response_model=List[str])
def pricing_sets(db: Session = Depends(get_session)):
    stmt = (
        select(CardTemplate.set_name)
        .join(PriceSnapshot, PriceSnapshot.template_id == CardTemplate.template_id)
        .where(CardTemplate.set_name.isnot(None))
        .group_by(CardTemplate.set_name)
    )
    rows = db.exec(stmt).all()
    names = [r for r in rows if r]
    # ensure uniqueness and stable order
    seen = set()
    ordered = []
    for name in names:
        if name not in seen:
            seen.add(name)
            ordered.append(name)
    return ordered


@app.get("/pricing/card/{template_id}", response_model=PricingCardResponse)
def pricing_card(template_id: int, db: Session = Depends(get_session)):
    pv = compute_price_view(template_id, db)
    if not pv:
        raise HTTPException(status_code=404, detail="No price snapshot found")
    snap = pv["latest"]
    return PricingCardResponse(
        template_id=template_id,
        source=snap.source,
        currency=snap.currency,
        mid_price=float(snap.mid_price),
        low_price=float(snap.low_price),
        high_price=float(snap.high_price),
        collected_at=float(snap.collected_at),
        display_price=pv["display_price"],
        fair_value=pv["fair_value"],
        avg_7d=pv["avg_7d"],
        avg_30d=pv["avg_30d"],
        spread_ratio=pv["spread_ratio"],
        price_confidence=pv["confidence"],
        confidence_score=pv["confidence"],
    )


@app.get("/pricing/card/{template_id}/history", response_model=List[PricingHistoryPoint])
def pricing_card_history(template_id: int, points: int = 30, db: Session = Depends(get_session)):
    safe_points = max(1, min(points, 90))
    return fetch_history_points(template_id, db, limit=safe_points)


@app.get("/pricing/sparklines", response_model=List[PricingSparkline])
def pricing_sparklines(template_ids: str, points: int = 30, db: Session = Depends(get_session)):
    if not template_ids:
        raise HTTPException(status_code=400, detail="template_ids required")
    safe_points = max(1, min(points, 90))
    deduped: List[int] = []
    for tid_str in template_ids.split(","):
        tid_str = tid_str.strip()
        if not tid_str:
            continue
        try:
            tid_val = int(tid_str)
        except ValueError:
            continue
        if tid_val not in deduped:
            deduped.append(tid_val)
    items: List[PricingSparkline] = []
    for tid in deduped:
        points_list = fetch_history_points(tid, db, limit=safe_points)
        items.append(PricingSparkline(template_id=tid, points=points_list))
    return items


@app.get("/pricing/portfolio", response_model=PricingPortfolioResponse)
def pricing_portfolio(wallet: str, db: Session = Depends(get_session)):
    breakdown, total_value = build_portfolio_breakdown(wallet, db)
    return PricingPortfolioResponse(total_value_usd=total_value, breakdown=breakdown)


@app.get("/pricing/stats", response_model=PricingStatsResponse)
def pricing_stats(wallet: str, db: Session = Depends(get_session)):
    breakdown, total_value = build_portfolio_breakdown(wallet, db)
    now_ts = time.time()
    cutoff_24h = now_ts - 24 * 3600
    previous_total = 0.0
    for item in breakdown:
        snap_prev = get_snapshot_as_of(item.template_id, cutoff_24h, db)
        if snap_prev:
            previous_total += fair_value_from_snapshot(snap_prev) * item.count
        else:
            previous_total += item.fair_value * item.count
    change_pct = 0.0 if previous_total == 0 else ((total_value - previous_total) / previous_total) * 100.0
    return PricingStatsResponse(
        portfolio_total=total_value,
        change_24h=change_pct,
        last_valuation_at=now_ts,
        breakdown=breakdown,
    )


@app.get("/admin/sessions")
def admin_sessions(page: int = 1, page_size: int = 0, db: Session = Depends(get_session)):
    stmt = select(SessionMirror).order_by(SessionMirror.created_at.desc())
    if page_size and page_size > 0:
        safe_page = max(1, page)
        total_row = db.exec(select(func.count()).select_from(SessionMirror)).one()
        total_count = total_row[0] if isinstance(total_row, tuple) else total_row
        offset = (safe_page - 1) * page_size
        items = db.exec(stmt.offset(offset).limit(page_size)).all()
        return {
            "items": items,
            "total": total_count,
            "page": safe_page,
            "page_size": page_size,
        }
    return db.exec(stmt).all()


@app.post("/admin/session/settle")
def admin_session_settle(req: AdminSessionSettleRequest, db: Session = Depends(get_session)):
    stmt = select(SessionMirror).where(SessionMirror.session_id == req.session_id)
    mirror = db.exec(stmt).first()
    if not mirror:
        raise HTTPException(status_code=404, detail="Session not found")
    mirror.state = "settled"
    db.add(mirror)
    db.commit()
    return {"ok": True, "session_id": req.session_id}


@app.post("/admin/sessions/force_expire")
def admin_force_expire(db: Session = Depends(get_session)):
    stmt = select(SessionMirror)
    all_sessions = db.exec(stmt).all()
    pending: List[SessionMirror] = []

    admin_keypair = load_admin_keypair()
    admin_pub = admin_keypair.pubkey()
    if auth_settings.admin_address and auth_settings.admin_address != str(admin_pub):
        raise HTTPException(status_code=400, detail="Admin keypair does not match ADMIN_ADDRESS")

    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    treasury = treasury_pubkey()
    vault_authority_str = str(vault_authority)

    instructions: List[Instruction] = []
    onchain_sessions: List[tuple[SessionMirror, List[str]]] = []
    offline_sessions: List[tuple[SessionMirror, List[str]]] = []
    for sess in all_sessions:
        user_pk = to_pubkey(sess.user)
        pack_session = pack_session_pda(vault_state, user_pk)
        assets = parse_asset_ids(sess.asset_ids)
        if len(assets) < 11:
            continue
        slot_assets = assets[:11]
        card_records = [card_record_pda(vault_state, to_pubkey(asset)) for asset in slot_assets]
        pack_info = None
        resp = sol_client.get_account_info(pack_session)
        if resp.value and resp.value.data:
            pack_info = parse_pack_session_account(bytes(resp.value.data))
        if not pack_info:
            continue
        if pack_info.get("state") != "pending":
            # If not pending, build a reset instead of a force_expire.
            reset_ix = build_admin_reset_session_ix(
                admin=admin_pub,
                user=user_pk,
                vault_state=vault_state,
                pack_session=pack_session,
                vault_authority=vault_authority,
                card_records=card_records,
            )
            instructions.append(reset_ix)
            offline_sessions.append((sess, slot_assets))
            continue
        pending.append(sess)
        ix = build_admin_force_expire_ix(
            admin=admin_pub,
            user=user_pk,
            vault_state=vault_state,
            pack_session=pack_session,
            vault_authority=vault_authority,
            vault_treasury=treasury,
            card_records=card_records,
        )
        instructions.append(ix)
        onchain_sessions.append((sess, slot_assets))

    signature = None
    if instructions:
        blockhash = get_latest_blockhash()
        try:
            message = MessageV0.try_compile(admin_pub, instructions, [], Hash.from_string(blockhash))
            tx = VersionedTransaction(message, [admin_keypair])
            raw_tx = bytes(tx)
            resp = sol_client.send_raw_transaction(raw_tx, opts=TxOpts(skip_preflight=False))
            signature = resp.get("result") if isinstance(resp, dict) else resp
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Force expire failed: {exc}") from exc

    now = time.time()
    def reset_session(sess: SessionMirror, assets: List[str]):
        sess.state = "expired"
        sess.expires_at = now
        db.add(sess)
        for asset in assets:
            rec = db.get(MintRecord, asset)
            if rec:
                rec.status = "available"
                rec.owner = vault_authority_str
                rec.updated_at = now
                db.add(rec)
    for sess, assets in offline_sessions:
        reset_session(sess, assets)
    for sess, assets in onchain_sessions:
        reset_session(sess, assets)
    db.commit()
    sig_str = None
    if signature:
        sig_str = signature.get("result") if isinstance(signature, dict) else str(signature)
    return {"cleared": len(pending), "signature": sig_str}


@app.post("/admin/sessions/reset")
def admin_reset_session(req: AdminResetRequest, db: Session = Depends(get_session)):
    admin_keypair = load_admin_keypair()
    admin_pub = admin_keypair.pubkey()
    if auth_settings.admin_address and auth_settings.admin_address != str(admin_pub):
        raise HTTPException(status_code=400, detail="Admin keypair does not match ADMIN_ADDRESS")

    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    wallet_pk = to_pubkey(req.wallet)
    pack_session = pack_session_pda(vault_state, wallet_pk)

    if not pda_exists(pack_session):
        return {"reset": False, "signature": None, "detail": "No pack_session PDA on-chain"}

    # Collect card_record PDAs (best-effort)
    card_records: List[Pubkey] = []
    stmt = select(SessionMirror).where(SessionMirror.user == req.wallet)
    mirrors = db.exec(stmt).all()
    assets_seen: set[str] = set()
    for m in mirrors:
        for asset in parse_asset_ids(m.asset_ids):
            if asset and asset not in assets_seen:
                assets_seen.add(asset)
                card_records.append(card_record_pda(vault_state, to_pubkey(asset)))

    ix = build_admin_reset_session_ix(
        admin=admin_pub,
        user=wallet_pk,
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        card_records=card_records,
    )
    blockhash = get_latest_blockhash()
    message = MessageV0.try_compile(admin_pub, [ix], [], Hash.from_string(blockhash))
    tx = VersionedTransaction(message, [admin_keypair])
    try:
        sig = sol_client.send_raw_transaction(bytes(tx), opts=TxOpts(skip_preflight=False))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Reset failed: {exc}") from exc

    now = time.time()
    for m in mirrors:
        m.state = "expired"
        m.expires_at = now
        db.add(m)
    for asset in assets_seen:
        rec = db.get(MintRecord, asset)
        if rec:
            rec.status = "available"
            rec.owner = str(vault_authority)
            rec.updated_at = now
            db.add(rec)
    db.commit()
    return {"reset": True, "signature": sig.get("result") if isinstance(sig, dict) else sig}


@app.post("/admin/sessions/force_close")
def admin_force_close(req: AdminResetRequest, db: Session = Depends(get_session)):
    """
    Admin-only hard close: ignores session state, closes pack_session PDA, and frees card records.
    """
    admin_keypair = load_admin_keypair()
    admin_pub = admin_keypair.pubkey()
    if auth_settings.admin_address and auth_settings.admin_address != str(admin_pub):
        raise HTTPException(status_code=400, detail="Admin keypair does not match ADMIN_ADDRESS")

    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    wallet_pk = to_pubkey(req.wallet)
    pack_session = pack_session_pda(vault_state, wallet_pk)

    # Require the PDA to exist.
    resp = sol_client.get_account_info(pack_session)
    if not resp.value or not resp.value.data:
        return {"reset": False, "signature": None, "detail": "No pack_session PDA on-chain"}

    session_info = parse_pack_session_account(bytes(resp.value.data))
    if not session_info:
        raise HTTPException(status_code=500, detail="Unable to parse pack_session account")
    card_record_keys: List[Pubkey] = session_info.get("card_record_keys") or []

    ix = build_admin_force_close_session_ix(
        admin=admin_pub,
        user=wallet_pk,
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        card_records=card_record_keys,
    )

    blockhash = get_latest_blockhash()
    message = MessageV0.try_compile(admin_pub, [ix], [], Hash.from_string(blockhash))
    tx = VersionedTransaction(message, [admin_keypair])
    try:
        sig = sol_client.send_raw_transaction(bytes(tx), opts=TxOpts(skip_preflight=False))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Force close failed: {exc}") from exc
    sig_str = None
    try:
        sig_str = sig.get("result") if isinstance(sig, dict) else str(sig.value) if hasattr(sig, "value") else str(sig)
    except Exception:
        sig_str = str(sig)

    now = time.time()
    # DB mirror cleanup: mark any rows for this wallet as expired and free assets to vault.
    stmt = select(SessionMirror).where(SessionMirror.user == req.wallet)
    mirrors = db.exec(stmt).all()
    for m in mirrors:
        m.state = "expired"
        m.expires_at = now
        db.add(m)
        for asset in parse_asset_ids(m.asset_ids):
            rec = db.get(MintRecord, asset)
            if rec:
                rec.status = "available"
                rec.owner = str(vault_authority)
                rec.updated_at = now
                db.add(rec)
    db.commit()
    return {"reset": True, "signature": sig_str}


@app.post("/admin/marketplace/force_cancel")
def admin_force_cancel_listings(req: AdminForceCancelListings):
    admin_keypair = load_admin_keypair()
    admin_pub = admin_keypair.pubkey()
    if auth_settings.admin_address and auth_settings.admin_address != str(admin_pub):
        raise HTTPException(status_code=400, detail="Admin keypair does not match ADMIN_ADDRESS")

    ok = []
    errors = []
    canonical_vault = vault_state_pda() if not req.vault_state else to_pubkey(req.vault_state)
    for asset in req.assets:
        try:
            core = to_pubkey(asset)
            vault_state = canonical_vault
            vault_authority = vault_authority_pda(vault_state)
            card_record = card_record_pda(vault_state, core)
            listing = listing_pda(vault_state, core)
            resp = sol_client.get_account_info(listing)
            listing_info = None
            listing_account_pk = listing

            # Fallback: if derived listing missing, try treating the provided asset as the listing PDA itself
            if resp.value is None or resp.value.data is None:
                alt = sol_client.get_account_info(core)
                if alt.value is not None and alt.value.owner == PROGRAM_ID and alt.value.data is not None:
                    listing_account_pk = core
                    try:
                        listing_info = parse_listing_account(bytes(alt.value.data))
                        core = to_pubkey(str(listing_info.get("core_asset"))) if listing_info and listing_info.get("core_asset") else core
                    except Exception:
                        listing_info = None
                if listing_info is None:
                    # force prune using whatever account we have (derived or provided)
                    listing_info = {"vault_state": str(canonical_vault), "seller": str(admin_pub), "core_asset": asset}
            else:
                listing_info = parse_listing_account(bytes(resp.value.data))

            if not listing_info or not listing_info.get("seller"):
                # fallback to prune
                listing_info = {"vault_state": str(canonical_vault), "seller": str(admin_pub), "core_asset": asset}

            # If the listing was created under a different vault_state, switch to that so seeds match
            if listing_info.get("vault_state"):
                vault_state = to_pubkey(str(listing_info["vault_state"]))
                vault_authority = vault_authority_pda(vault_state)
                card_record = card_record_pda(vault_state, core)
                if listing_account_pk == listing:
                    listing_account_pk = listing_pda(vault_state, core)
            seller = listing_info["seller"]
            if not pda_exists(vault_state):
                ix = build_admin_prune_listing_ix(
                    admin=admin_pub,
                    vault_state=canonical_vault,
                    listing=listing_account_pk,
                )
            else:
                ix = build_admin_force_cancel_listing_ix(
                    admin=admin_pub,
                    vault_state=vault_state,
                    card_record=card_record,
                    core_asset=core,
                    listing=listing_account_pk,
                    vault_authority=vault_authority,
                    seller=seller,
                )
            blockhash = get_latest_blockhash()
            message = MessageV0.try_compile(admin_pub, [ix], [], Hash.from_string(blockhash))
            tx = VersionedTransaction(message, [admin_keypair])
            sig = sol_client.send_raw_transaction(bytes(tx), opts=TxOpts(skip_preflight=False))
            ok.append({"asset": asset, "signature": sig.get("result") if isinstance(sig, dict) else str(sig)})
        except Exception as exc:  # noqa: BLE001
            errors.append({"asset": asset, "error": str(exc)})
    return {"ok": ok, "errors": errors}


@app.post("/admin/reconcile")
def admin_reconcile(db: Session = Depends(get_session)):
    admin_keypair = load_admin_keypair()
    admin_pub = admin_keypair.pubkey()
    if auth_settings.admin_address and auth_settings.admin_address != str(admin_pub):
        raise HTTPException(status_code=400, detail="Admin keypair does not match ADMIN_ADDRESS")

    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    now = time.time()

    # 1) Reconcile CardRecords -> MintRecords
    card_updates = 0
    stmt = select(MintRecord)
    rows = db.exec(stmt).all()
    assets = [row.asset_id for row in rows]
    pdas = [card_record_pda(vault_state, to_pubkey(a)) for a in assets]
    def chunk(lst, n):
        for i in range(0, len(lst), n):
            yield lst[i : i + n]
    for batch_pdas, batch_rows in zip(chunk(pdas, 50), chunk(rows, 50)):
        try:
            resp = sol_client.get_multiple_accounts(batch_pdas)
        except Exception:
            continue
        if not resp.value:
            continue
        for acct, row in zip(resp.value, batch_rows):
            if acct is None:
                continue
            info = parse_card_record_account(bytes(acct.data))
            if not info:
                continue
            status_idx = info["status"]
            status_label = CARD_STATUS_LABELS[status_idx] if 0 <= status_idx < len(CARD_STATUS_LABELS) else row.status
            owner_str = str(info["owner"])
            if row.status != status_label or row.owner != owner_str:
                row.status = status_label
                row.owner = owner_str
                row.updated_at = now
                db.add(row)
                card_updates += 1

    # 2) Reconcile PackSessions -> SessionMirror and MintRecords (availability)
    session_updates = 0
    stmt = select(SessionMirror)
    sessions = db.exec(stmt).all()
    for mirror in sessions:
        wallet_pk = to_pubkey(mirror.user)
        pack_session = pack_session_pda(vault_state, wallet_pk)
        if not pda_exists(pack_session):
            if mirror.state == "pending":
                mirror.state = "expired"
                mirror.expires_at = now
                db.add(mirror)
                session_updates += 1
            continue
        try:
            resp = sol_client.get_account_info(pack_session)
        except Exception:
            continue
        info = parse_pack_session_account(bytes(resp.value.data)) if resp.value and resp.value.data else None
        if not info:
            continue
        on_state = info.get("state")
        if mirror.state != on_state:
            mirror.state = on_state or mirror.state
            mirror.expires_at = info.get("expires_at", mirror.expires_at)
            db.add(mirror)
            session_updates += 1
        # If not pending, release assets in DB to vault_authority
        if on_state and on_state != "pending":
            assets = parse_asset_ids(mirror.asset_ids)
            for asset in assets:
                rec = db.get(MintRecord, asset)
                if rec and rec.status == "reserved":
                    rec.status = "available"
                    rec.owner = str(vault_authority)
                    rec.updated_at = now
                    db.add(rec)
                    card_updates += 1

    db.commit()
    return {"card_updates": card_updates, "session_updates": session_updates}


@app.get("/admin/inventory/assets", response_model=List[AssetView])
def admin_inventory_assets(db: Session = Depends(get_session)):
    stmt = select(MintRecord)
    rows = db.exec(stmt).all()
    result: List[AssetView] = []
    for row in rows:
        name = None
        image_url: Optional[str] = None
        tmpl = db.get(CardTemplate, row.template_id)
        if tmpl:
            name = tmpl.card_name
            image_url = tmpl.image_url
        result.append(
            AssetView(
                asset_id=row.asset_id,
                template_id=row.template_id,
                rarity=row.rarity,
                status=row.status,
                owner=row.owner,
                name=name,
                image_url=image_url,
            )
        )
    return result


@app.get("/admin/inventory/reserved", response_model=List[AssetStatusView])
def admin_inventory_reserved(db: Session = Depends(get_session)):
    stmt = select(MintRecord).where(MintRecord.status != "available")
    rows = db.exec(stmt).all()
    result: List[AssetStatusView] = []
    for row in rows:
        result.append(
            AssetStatusView(
                asset_id=row.asset_id,
                template_id=row.template_id,
                rarity=row.rarity,
                status=row.status,
                owner=row.owner,
            )
        )
    return result


@app.get("/admin/sessions/diagnostic", response_model=List[SessionDiagnostic])
def admin_sessions_diagnostic(db: Session = Depends(get_session)):
    stmt = select(SessionMirror)
    rows = db.exec(stmt).all()
    vault_state = vault_state_pda()
    diagnostics: List[SessionDiagnostic] = []
    for row in rows:
        user_pk = to_pubkey(row.user)
        pack_session = pack_session_pda(vault_state, user_pk)
        assets = parse_asset_ids(row.asset_ids)
        statuses: List[AssetStatusView] = []
        for asset_id in assets[:11]:
            record = db.get(MintRecord, asset_id)
            if record:
                statuses.append(
                    AssetStatusView(
                        asset_id=record.asset_id,
                        template_id=record.template_id,
                        rarity=record.rarity,
                        status=record.status,
                        owner=record.owner,
                    )
                )
            else:
                statuses.append(
                    AssetStatusView(
                        asset_id=asset_id,
                        template_id=None,
                        rarity=None,
                        status="missing",
                        owner=None,
                    )
                )
        diagnostics.append(
            SessionDiagnostic(
                session_id=row.session_id,
                user=row.user,
                state=row.state,
                expires_at=row.expires_at,
                has_pack_session=pda_exists(pack_session),
                asset_statuses=statuses,
            )
        )
    return diagnostics


@app.post("/admin/inventory/unreserve")
def admin_inventory_unreserve(req: UnreserveRequest, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = str(vault_authority_pda(vault_state))
    stmt = select(MintRecord).where(MintRecord.status != "available")
    if req.owner:
        stmt = stmt.where(MintRecord.owner == req.owner)
    if req.statuses:
        stmt = stmt.where(MintRecord.status.in_(req.statuses))
    rows = db.exec(stmt).all()
    now = time.time()
    affected_sessions: set[str] = set()
    for row in rows:
        sess_stmt = select(SessionMirror).where(
            SessionMirror.state.in_(["pending", "settled"]),
            SessionMirror.asset_ids.like(f"%{row.asset_id}%"),
        )
        for sess in db.exec(sess_stmt).all():
            sess.state = "expired"
            sess.expires_at = now
            db.add(sess)
            affected_sessions.add(sess.session_id)
        row.status = "available"
        row.owner = vault_authority
        row.updated_at = now
        db.add(row)
    db.commit()
    return {"unreserved": len(rows), "sessions_marked": len(affected_sessions)}


def template_id_from_uri(uri: str) -> Optional[int]:
    if not uri:
        return None
    match = re.search(r"(\d{3})", uri)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None
    return None


@app.post("/admin/inventory/refresh", response_model=InventoryRefreshResponse)
def admin_inventory_refresh(db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    if not auth_settings.helius_rpc_url:
        raise HTTPException(status_code=400, detail="HELIUS_RPC_URL not configured")
    assets = helius_get_assets(str(vault_authority), auth_settings.core_collection_address)
    updated: List[str] = []
    for item in assets:
        asset_id = item.get("id")
        if not asset_id:
            continue
        content = item.get("content", {}) or {}
        uri = content.get("json_uri") or content.get("links", {}).get("json")
        tmpl_id = template_id_from_uri(uri or "")
        template_row = db.get(CardTemplate, tmpl_id) if tmpl_id else None
        rarity = "unknown"
        if template_row:
            rarity = template_row.rarity
        existing = db.get(MintRecord, asset_id)
        if existing:
            existing.owner = str(vault_authority)
            existing.status = "available"
            existing.updated_at = time.time()
            db.add(existing)
        else:
            db.add(
                MintRecord(
                    asset_id=asset_id,
                    template_id=tmpl_id or 0,
                    rarity=rarity,
                    status="available",
                    owner=str(vault_authority),
                    updated_at=time.time(),
                )
            )
        updated.append(asset_id)
    db.commit()
    return InventoryRefreshResponse(owner=str(vault_authority), count=len(updated), updated=updated)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
