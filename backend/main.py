from __future__ import annotations

import hashlib
import json
import os
import random
import time
import uuid
from typing import Dict, List, Optional

import requests
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel
from pydantic_settings import BaseSettings
import re
from solders.pubkey import Pubkey
from solders.instruction import Instruction
from solders.keypair import Keypair as SoldersKeypair
from solders.hash import Hash
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from solana.rpc.api import Client as SolanaClient
from solana.rpc.types import TxOpts
from sqlmodel import Field, Session, SQLModel, create_engine, select

from tx_builder import (
    build_admin_force_expire_ix,
    build_claim_pack_ix,
    build_fill_listing_ix,
    build_list_card_ix,
    build_open_pack_ix,
    build_sellback_pack_ix,
    card_record_pda,
    instruction_to_dict,
    listing_pda,
    message_from_instructions,
    pack_session_pda,
    to_pubkey,
    vault_authority_pda,
    vault_state_pda,
    versioned_tx_b64,
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
    server_seed: str = os.environ.get("SERVER_SEED", "dev-server-seed")
    database_url: str = "sqlite:///./mochi.db"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


auth_settings = Settings()


engine = create_engine(auth_settings.database_url)
sol_client = SolanaClient(auth_settings.solana_rpc)
ADMIN_KEYPAIR: Optional[SoldersKeypair] = None


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


def init_db():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session


app = FastAPI(title="Mochi v2 API", version="0.1.0")
SERVER_SEED_HASH = hashlib.sha256(auth_settings.server_seed.encode()).hexdigest()


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


class PackPreviewRequest(BaseModel):
    pack_type: str = "meg_web"
    client_seed: str
    wallet: str


class PackSlot(BaseModel):
    slot_index: int
    rarity: str
    template_id: Optional[int]


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


class KeyMeta(BaseModel):
    pubkey: str
    is_signer: bool
    is_writable: bool


class InstructionMeta(BaseModel):
    program_id: str
    keys: List[KeyMeta]
    data: str


class TxResponse(BaseModel):
    tx_b64: str
    tx_v0_b64: str
    recent_blockhash: str
    instructions: List[InstructionMeta]


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


def pick_template_ids(rng: random.Random, rarities: List[str], db: Session) -> List[Optional[int]]:
    result: List[Optional[int]] = []
    for rarity in rarities:
        stmt = select(CardTemplate).where(CardTemplate.rarity == rarity)
        if rarity == "Energy":
            stmt = select(CardTemplate).where(CardTemplate.is_energy == True)  # noqa: E712
        templates = db.exec(stmt).all()
        if not templates:
            result.append(None)
            continue
        chosen = rng.choice(templates)
        result.append(chosen.template_id)
    return result


def choose_assets_for_templates(template_ids: List[Optional[int]], rarities: List[str], wallet: str, db: Session) -> List[str]:
    asset_ids: List[str] = []
    for idx, tmpl in enumerate(template_ids):
        if tmpl is None:
            asset_ids.append("")
            continue
        stmt = select(MintRecord).where(MintRecord.template_id == tmpl, MintRecord.status == "available")
        record = db.exec(stmt).first()
        if not record:
            raise HTTPException(status_code=400, detail=f"No available asset for template {tmpl} (slot {idx})")
        record.status = "reserved"
        record.owner = wallet
        record.updated_at = time.time()
        db.add(record)
        asset_ids.append(record.asset_id)
    db.commit()
    return asset_ids


def parse_asset_ids(csv_assets: str) -> List[str]:
    if not csv_assets:
        return []
    return [a for a in csv_assets.split(",") if a]


def pda_exists(pda: Pubkey) -> bool:
    resp = sol_client.get_account_info(pda)
    return resp.value is not None


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
    if req.pack_type != "meg_web":
        raise HTTPException(status_code=400, detail="Unsupported pack type")
    is_sol = req.currency.upper() == "SOL"
    if not is_sol:
        if not (req.user_token_account and req.vault_token_account):
            raise HTTPException(status_code=400, detail="Token currency requires token accounts")
        if not req.currency_mint and not auth_settings.usdc_mint:
            raise HTTPException(status_code=400, detail="Token currency requires currency_mint or USDC_MINT env")
    existing_stmt = select(SessionMirror).where(
        SessionMirror.user == req.wallet, SessionMirror.state == "pending", SessionMirror.expires_at > time.time()
    )
    existing = db.exec(existing_stmt).first()
    if existing:
        raise HTTPException(status_code=400, detail="Active pack session already exists")
    nonce = compute_nonce(req.client_seed)
    rng = build_rng(auth_settings.server_seed, req.client_seed)
    rarities = slot_rarities(rng)
    template_ids = pick_template_ids(rng, rarities, db)
    asset_ids = choose_assets_for_templates(template_ids, rarities, req.wallet, db)

    if "" in asset_ids:
        missing_idx = asset_ids.index("")
        raise HTTPException(status_code=400, detail=f"Missing asset for slot {missing_idx}")

    session_id = str(uuid.uuid4())
    mirror = SessionMirror(
        session_id=session_id,
        user=req.wallet,
        rarities=",".join(rarities),
        asset_ids=",".join(asset_ids),
        server_seed_hash=SERVER_SEED_HASH,
        server_nonce=nonce,
        state="pending",
        expires_at=time.time() + 3600,
    )
    db.add(mirror)
    db.commit()

    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    pack_session = pack_session_pda(vault_state, to_pubkey(req.wallet))
    treasury = treasury_pubkey()
    card_records = [card_record_pda(vault_state, to_pubkey(asset)) for asset in asset_ids]
    for cr in card_records:
        if not pda_exists(cr):
            raise HTTPException(status_code=400, detail=f"CardRecord PDA missing on-chain: {cr}")

    rarity_prices = rarity_price_vector(rarities)
    client_seed_hash = hashlib.sha256(req.client_seed.encode()).digest()
    user_token_account = to_pubkey(req.user_token_account) if req.user_token_account else None
    vault_token_account = to_pubkey(req.vault_token_account) if req.vault_token_account else None
    currency = "Sol" if is_sol else "Token"
    ix = build_open_pack_ix(
        user=to_pubkey(req.wallet),
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        vault_treasury=treasury,
        card_records=card_records,
        currency=currency,
        rarity_prices=rarity_prices,
        client_seed_hash=client_seed_hash,
        user_currency_token=user_token_account,
        vault_currency_token=vault_token_account,
    )
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions([ix], to_pubkey(req.wallet), blockhash)
    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, [ix])
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    slots = [PackSlot(slot_index=i, rarity=rarities[i], template_id=template_ids[i]) for i in range(len(rarities))]
    provably_fair = {
        "server_seed_hash": SERVER_SEED_HASH,
        "server_nonce": nonce,
        "client_seed": req.client_seed,
        "assets": ",".join(asset_ids),
        "rarities": ",".join(rarities),
        "entropy_proof": entropy_hex(req.client_seed, nonce),
    }
    return PackBuildResponse(
        tx_b64=tx_b64,
        tx_v0_b64=tx_v0_b64,
        recent_blockhash=blockhash,
        session_id=session_id,
        lineup=slots,
        provably_fair=provably_fair,
        instructions=[instr],
    )


@app.post("/program/claim/build", response_model=TxResponse)
def claim_pack(req: SessionActionRequest, db: Session = Depends(get_session)):
    stmt = select(SessionMirror).where(SessionMirror.session_id == req.session_id)
    mirror = db.exec(stmt).first()
    if not mirror:
        raise HTTPException(status_code=404, detail="Session not found")
    if mirror.user != req.wallet:
        raise HTTPException(status_code=403, detail="Wallet mismatch")
    if mirror.state != "pending":
        raise HTTPException(status_code=400, detail=f"Session in state {mirror.state}")
    if time.time() > mirror.expires_at:
        raise HTTPException(status_code=400, detail="Session expired")

    assets = parse_asset_ids(mirror.asset_ids)
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    pack_session = pack_session_pda(vault_state, to_pubkey(req.wallet))
    treasury = treasury_pubkey()
    card_records = [card_record_pda(vault_state, to_pubkey(asset)) for asset in assets]
    for cr in card_records:
        if not pda_exists(cr):
            raise HTTPException(status_code=400, detail=f"CardRecord PDA missing on-chain: {cr}")

    ix = build_claim_pack_ix(
        user=to_pubkey(req.wallet),
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        vault_treasury=treasury,
        card_records=card_records,
        user_currency_token=to_pubkey(req.user_token_account) if req.user_token_account else None,
        vault_currency_token=to_pubkey(req.vault_token_account) if req.vault_token_account else None,
    )
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions([ix], to_pubkey(req.wallet), blockhash)
    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, [ix])
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    # Mark records as user owned in mirror DB
    for asset in assets:
        stmt = select(MintRecord).where(MintRecord.asset_id == asset)
        record = db.exec(stmt).first()
        if record:
            record.status = "user_owned"
            record.owner = req.wallet
            record.updated_at = time.time()
            db.add(record)
    mirror.state = "accepted"
    db.add(mirror)
    db.commit()

    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.post("/program/sellback/build", response_model=TxResponse)
def sellback_pack(req: SessionActionRequest, db: Session = Depends(get_session)):
    stmt = select(SessionMirror).where(SessionMirror.session_id == req.session_id)
    mirror = db.exec(stmt).first()
    if not mirror:
        raise HTTPException(status_code=404, detail="Session not found")
    if mirror.user != req.wallet:
        raise HTTPException(status_code=403, detail="Wallet mismatch")
    if mirror.state != "pending":
        raise HTTPException(status_code=400, detail=f"Session in state {mirror.state}")
    if time.time() > mirror.expires_at:
        raise HTTPException(status_code=400, detail="Session expired")
    rarities = mirror.rarities.split(",")
    assets = parse_asset_ids(mirror.asset_ids)

    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    pack_session = pack_session_pda(vault_state, to_pubkey(req.wallet))
    treasury = treasury_pubkey()
    card_records = [card_record_pda(vault_state, to_pubkey(asset)) for asset in assets]
    for cr in card_records:
        if not pda_exists(cr):
            raise HTTPException(status_code=400, detail=f"CardRecord PDA missing on-chain: {cr}")

    ix = build_sellback_pack_ix(
        user=to_pubkey(req.wallet),
        vault_state=vault_state,
        pack_session=pack_session,
        vault_authority=vault_authority,
        vault_treasury=treasury,
        card_records=card_records,
        user_currency_token=to_pubkey(req.user_token_account) if req.user_token_account else None,
        vault_currency_token=to_pubkey(req.vault_token_account) if req.vault_token_account else None,
    )
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions([ix], to_pubkey(req.wallet), blockhash)
    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, [ix])
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    # Reset assets to available in mirror DB
    for asset in assets:
        stmt = select(MintRecord).where(MintRecord.asset_id == asset)
        record = db.exec(stmt).first()
        if record:
            record.status = "available"
            record.owner = None
            record.updated_at = time.time()
            db.add(record)
    mirror.state = "rejected"
    db.add(mirror)
    db.commit()

    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.get("/profile/{wallet}")
def profile(wallet: str):
    assets = helius_get_assets(wallet, auth_settings.core_collection_address)
    return {"wallet": wallet, "assets": assets}


@app.get("/marketplace/listings", response_model=List[ListingView])
def marketplace_listings(db: Session = Depends(get_session)):
    stmt = select(MintRecord).where(MintRecord.status == "listed")
    rows = db.exec(stmt).all()
    return [
        ListingView(
            core_asset=row.asset_id,
            price_lamports=0,
            seller=row.owner,
            status=row.status,
            currency_mint=None,
        )
        for row in rows
    ]


@app.post("/marketplace/list/build", response_model=TxResponse)
def marketplace_list(req: ListRequest, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    card_record = card_record_pda(vault_state, to_pubkey(req.core_asset))
    listing = listing_pda(vault_state, to_pubkey(req.core_asset))
    if not pda_exists(card_record):
        raise HTTPException(status_code=400, detail="CardRecord PDA missing on-chain; deposit first")

    ix = build_list_card_ix(
        seller=to_pubkey(req.wallet),
        vault_state=vault_state,
        card_record=card_record,
        listing=listing,
        vault_authority=vault_authority,
        price_lamports=req.price_lamports,
        currency_mint=req.currency_mint,
    )
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions([ix], to_pubkey(req.wallet), blockhash)
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    # Mirror listing status
    stmt = select(MintRecord).where(MintRecord.asset_id == req.core_asset)
    record = db.exec(stmt).first()
    if record:
        record.status = "listed"
        record.owner = req.wallet
        record.updated_at = time.time()
        db.add(record)
        db.commit()

    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.post("/marketplace/fill/build", response_model=TxResponse)
def marketplace_fill(req: MarketplaceActionRequest, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    card_record = card_record_pda(vault_state, to_pubkey(req.core_asset))
    listing = listing_pda(vault_state, to_pubkey(req.core_asset))
    treasury = treasury_pubkey()
    if not pda_exists(card_record):
        raise HTTPException(status_code=400, detail="CardRecord PDA missing on-chain")

    stmt = select(MintRecord).where(MintRecord.asset_id == req.core_asset)
    record = db.exec(stmt).first()
    seller_pubkey = listing_owner_from_chain(vault_state, to_pubkey(req.core_asset)) or treasury
    if record and record.owner:
        seller_pubkey = to_pubkey(record.owner)

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
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    if record:
        record.status = "user_owned"
        record.owner = req.wallet
        record.updated_at = time.time()
        db.add(record)
        db.commit()

    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, [ix])
    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.post("/marketplace/cancel/build", response_model=TxResponse)
def marketplace_cancel(req: MarketplaceActionRequest, db: Session = Depends(get_session)):
    vault_state = vault_state_pda()
    card_record = card_record_pda(vault_state, to_pubkey(req.core_asset))
    listing = listing_pda(vault_state, to_pubkey(req.core_asset))

    ix = build_cancel_listing_ix(
        seller=to_pubkey(req.wallet),
        vault_state=vault_state,
        card_record=card_record,
        listing=listing,
    )
    blockhash = get_latest_blockhash()
    tx_b64 = message_from_instructions([ix], to_pubkey(req.wallet), blockhash)
    instr = wrap_instruction_meta(instruction_to_dict(ix))

    stmt = select(MintRecord).where(MintRecord.asset_id == req.core_asset)
    record = db.exec(stmt).first()
    if record:
        record.status = "user_owned"
        record.owner = req.wallet
        record.updated_at = time.time()
        db.add(record)
        db.commit()

    tx_v0_b64 = versioned_tx_b64(to_pubkey(req.wallet), blockhash, [ix])
    return TxResponse(tx_b64=tx_b64, tx_v0_b64=tx_v0_b64, recent_blockhash=blockhash, instructions=[instr])


@app.get("/admin/inventory/rarity")
def admin_inventory(db: Session = Depends(get_session)):
    stmt = select(MintRecord)
    rows = db.exec(stmt).all()
    counts: Dict[str, int] = {}
    for row in rows:
        counts[row.rarity] = counts.get(row.rarity, 0) + 1
    return counts


@app.get("/pricing/rarity")
def pricing_rarity():
    return RARITY_PRICE_LAMPORTS


@app.get("/admin/sessions")
def admin_sessions(db: Session = Depends(get_session)):
    stmt = select(SessionMirror)
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
    stmt = select(SessionMirror).where(SessionMirror.state == "pending")
    pending = db.exec(stmt).all()
    if not pending:
        return {"cleared": 0, "signature": None}

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
    for sess in pending:
        user_pk = to_pubkey(sess.user)
        pack_session = pack_session_pda(vault_state, user_pk)
        assets = parse_asset_ids(sess.asset_ids)
        if len(assets) < 11:
            raise HTTPException(status_code=400, detail=f"Session {sess.session_id} missing card list")
        card_records = [card_record_pda(vault_state, to_pubkey(asset)) for asset in assets[:11]]
        if not pda_exists(pack_session):
            offline_sessions.append((sess, assets[:11]))
            continue
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
        onchain_sessions.append((sess, assets[:11]))

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
    return {"cleared": len(pending), "signature": signature}


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
