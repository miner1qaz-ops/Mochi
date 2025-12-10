import base64
import hashlib
import os
from typing import List, Optional, Tuple

from borsh_construct import CStruct, Enum, Option, U16, U32, U64, U8, Vec
from solders.instruction import AccountMeta, Instruction
from solders.message import MessageV0
from solders.hash import Hash
from solders.transaction import VersionedTransaction
from solders.pubkey import Pubkey


def load_pubkey(env_name: str) -> Pubkey:
    value = os.environ.get(env_name)
    if not value:
        raise RuntimeError(f"{env_name} must be set to a valid program id")
    try:
        return Pubkey.from_string(value)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"{env_name} is not a valid pubkey: {exc}") from exc


PROGRAM_ID = load_pubkey("PROGRAM_ID")
SYS_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
MPL_CORE_PROGRAM_ID = Pubkey.from_string("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d")
MARKETPLACE_VAULT_SEED = b"market_vault_state"
MARKETPLACE_VAULT_AUTHORITY_SEED = b"market_vault_authority"

# Seed sale program (devnet mock)
SEED_SALE_PROGRAM_ID = load_pubkey("SEED_SALE_PROGRAM_ID")


CurrencyLayout = Enum("Sol" / CStruct(), "Token" / CStruct(), enum_name="Currency")
OpenPackStartLayout = CStruct(
    "currency" / CurrencyLayout,
    "client_seed_hash" / U8[32],
    "rarity_prices" / Vec(U64),
)
OpenPackV2Layout = CStruct(
    "currency" / CurrencyLayout,
    "client_seed_hash" / U8[32],
    "rare_templates" / Vec(U32),
)
SeedInitLayout = CStruct(
    "start_ts" / U64,
    "end_ts" / U64,
    "price_tokens_per_sol" / U64,
    "token_cap" / U64,
    "sol_cap_lamports" / U64,
)
SeedContributeLayout = CStruct("lamports" / U64)
ListCardLayout = CStruct(
    "price_lamports" / U64,
    "currency_mint" / Option(U8[32]),
    "template_id" / U32,
    "rarity" / U8,
)

RARITY_ORDER = [
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


def sighash(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


def to_pubkey(value: str) -> Pubkey:
    return Pubkey.from_string(value)


def vault_state_pda() -> Pubkey:
    return Pubkey.find_program_address([b"vault_state"], PROGRAM_ID)[0]

def market_vault_state_pda() -> Pubkey:
    return Pubkey.find_program_address([MARKETPLACE_VAULT_SEED], PROGRAM_ID)[0]


def vault_authority_pda(vault_state: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"vault_authority", bytes(vault_state)], PROGRAM_ID)[0]

def market_vault_authority_pda(vault_state: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([MARKETPLACE_VAULT_AUTHORITY_SEED, bytes(vault_state)], PROGRAM_ID)[0]


def card_record_pda(vault_state: Pubkey, core_asset: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"card_record", bytes(vault_state), bytes(core_asset)], PROGRAM_ID
    )[0]


def pack_session_pda(vault_state: Pubkey, user: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"pack_session", bytes(vault_state), bytes(user)], PROGRAM_ID
    )[0]

def pack_session_v2_pda(vault_state: Pubkey, user: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"pack_session_v2", bytes(vault_state), bytes(user)], PROGRAM_ID
    )[0]


def listing_pda(vault_state: Pubkey, core_asset: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"listing", bytes(vault_state), bytes(core_asset)], PROGRAM_ID
    )[0]

def seed_sale_pda(authority: Pubkey, mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"seed_sale", bytes(authority), bytes(mint)], SEED_SALE_PROGRAM_ID)[0]

def seed_vault_authority_pda(sale: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"seed_vault", bytes(sale)], SEED_SALE_PROGRAM_ID)[0]

def seed_contribution_pda(sale: Pubkey, buyer: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"contrib", bytes(sale), bytes(buyer)], SEED_SALE_PROGRAM_ID)[0]

def vesting_pda(beneficiary: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"vesting", bytes(beneficiary)], SEED_SALE_PROGRAM_ID)[0]

def seed_vault_token_pda(sale: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"seed_vault_token", bytes(sale)], SEED_SALE_PROGRAM_ID)[0]

def vest_vault_token_pda(beneficiary: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"vest_vault_token", bytes(beneficiary)], SEED_SALE_PROGRAM_ID)[0]


def encode_currency_tag(currency: str):
    if currency.lower() == "sol":
        return CurrencyLayout.enum.Sol()
    return CurrencyLayout.enum.Token()

def encode_rarity_tag(rarity: str) -> int:
    norm = rarity.replace(" ", "").replace("_", "").lower()
    for idx, label in enumerate(RARITY_ORDER):
        if label.lower() == norm:
            return idx
    raise ValueError(f"Unsupported rarity {rarity}")


def encode_open_pack_start(currency: str, client_seed_hash: bytes, rarity_prices: List[int]) -> bytes:
    if len(client_seed_hash) != 32:
        client_seed_hash = hashlib.sha256(client_seed_hash).digest()
    data = OpenPackStartLayout.build(
        {
            "currency": encode_currency_tag(currency),
            "client_seed_hash": list(client_seed_hash),
            "rarity_prices": rarity_prices,
        }
    )
    return sighash("open_pack_start") + data

def encode_open_pack_v2(currency: str, client_seed_hash: bytes, rare_templates: List[int]) -> bytes:
    if len(client_seed_hash) != 32:
        client_seed_hash = hashlib.sha256(client_seed_hash).digest()
    data = OpenPackV2Layout.build(
        {
            "currency": encode_currency_tag(currency),
            "client_seed_hash": list(client_seed_hash),
            "rare_templates": rare_templates,
        }
    )
    return sighash("open_pack") + data


def encode_set_reward_config(mochi_mint: Pubkey, reward_per_pack: int) -> bytes:
    return sighash("set_reward_config") + bytes(mochi_mint) + int(reward_per_pack).to_bytes(8, "little")


def encode_claim_pack() -> bytes:
    return sighash("claim_pack")

def encode_claim_pack_v2() -> bytes:
    return sighash("claim_pack_v2")


def encode_claim_pack_batch() -> bytes:
    return sighash("claim_pack_batch")


def encode_claim_pack_batch3() -> bytes:
    return sighash("claim_pack_batch3")


def encode_finalize_claim() -> bytes:
    return sighash("finalize_claim")


def encode_sellback_pack() -> bytes:
    return sighash("sellback_pack")

def encode_sellback_pack_v2() -> bytes:
    return sighash("sellback_pack_v2")


def encode_expire_session() -> bytes:
    return sighash("expire_session")

def encode_expire_session_v2() -> bytes:
    return sighash("expire_session_v2")


def encode_admin_force_expire() -> bytes:
    return sighash("admin_force_expire")

def encode_admin_force_close_v2() -> bytes:
    return sighash("admin_force_close_v2")


def encode_admin_reset_session() -> bytes:
    return sighash("admin_reset_session")


def encode_admin_force_close_session() -> bytes:
    return sighash("admin_force_close_session")

def encode_admin_force_cancel_listing() -> bytes:
    return sighash("admin_force_cancel_listing")

def encode_admin_prune_listing() -> bytes:
    return sighash("admin_prune_listing")

def encode_seed_init(start_ts: int, end_ts: int, price_tokens_per_sol: int, token_cap: int, sol_cap_lamports: int) -> bytes:
    data = SeedInitLayout.build(
        {
            "start_ts": start_ts,
            "end_ts": end_ts,
            "price_tokens_per_sol": price_tokens_per_sol,
            "token_cap": token_cap,
            "sol_cap_lamports": sol_cap_lamports,
        }
    )
    return sighash("init_sale") + data

def encode_seed_contribute(lamports: int) -> bytes:
    data = SeedContributeLayout.build({"lamports": lamports})
    return sighash("contribute") + data

def encode_seed_claim() -> bytes:
    return sighash("claim")

def encode_seed_cancel() -> bytes:
    return sighash("cancel_sale")

def encode_init_vesting(start_ts: int, cliff_ts: int, end_ts: int, total_amount: int) -> bytes:
    return (
        sighash("init_vesting")
        + start_ts.to_bytes(8, "little", signed=True)
        + cliff_ts.to_bytes(8, "little", signed=True)
        + end_ts.to_bytes(8, "little", signed=True)
        + total_amount.to_bytes(8, "little")
    )

def encode_claim_vesting() -> bytes:
    return sighash("claim_vesting")


def encode_user_reset_session() -> bytes:
    return sighash("user_reset_session")


def encode_list_card(price_lamports: int, currency_mint: Optional[str], template_id: int, rarity_tag: int) -> bytes:
    currency_bytes = None if not currency_mint else list(Pubkey.from_string(currency_mint).to_bytes())
    data = ListCardLayout.build(
        {
            "price_lamports": price_lamports,
            "currency_mint": currency_bytes,
            "template_id": template_id,
            "rarity": rarity_tag,
        }
    )
    return sighash("list_card") + data

def build_seed_init_ix(authority: Pubkey, mint: Pubkey, treasury: Pubkey, start_ts: int, end_ts: int, price_tokens_per_sol: int, token_cap: int, sol_cap_lamports: int) -> Instruction:
    sale = seed_sale_pda(authority, mint)
    vault_auth = seed_vault_authority_pda(sale)
    seed_vault = seed_vault_token_pda(sale)
    data = encode_seed_init(start_ts, end_ts, price_tokens_per_sol, token_cap, sol_cap_lamports)
    accounts = [
        AccountMeta(authority, True, True),
        AccountMeta(mint, False, False),
        AccountMeta(treasury, False, True),
        AccountMeta(sale, False, True),
        AccountMeta(vault_auth, False, False),
        AccountMeta(seed_vault, False, True),
        AccountMeta(TOKEN_PROGRAM_ID, False, False),
        AccountMeta(SYS_PROGRAM_ID, False, False),
        AccountMeta(Pubkey.from_string("SysvarRent111111111111111111111111111111111"), False, False),
    ]
    return Instruction(SEED_SALE_PROGRAM_ID, data, accounts)

def build_seed_contribute_ix(buyer: Pubkey, authority: Pubkey, mint: Pubkey, treasury: Pubkey, lamports: int) -> Instruction:
    sale = seed_sale_pda(authority, mint)
    contrib = seed_contribution_pda(sale, buyer)
    data = encode_seed_contribute(lamports)
    accounts = [
        AccountMeta(buyer, True, True),
        AccountMeta(sale, False, True),
        AccountMeta(treasury, False, True),
        AccountMeta(contrib, False, True),
        AccountMeta(SYS_PROGRAM_ID, False, False),
    ]
    return Instruction(SEED_SALE_PROGRAM_ID, data, accounts)

def build_seed_claim_ix(buyer: Pubkey, authority: Pubkey, mint: Pubkey, user_ata: Pubkey) -> Instruction:
    sale = seed_sale_pda(authority, mint)
    contrib = seed_contribution_pda(sale, buyer)
    vault_auth = seed_vault_authority_pda(sale)
    seed_vault = seed_vault_token_pda(sale)
    data = encode_seed_claim()
    accounts = [
        AccountMeta(buyer, True, False),
        AccountMeta(sale, False, True),
        AccountMeta(contrib, False, True),
        AccountMeta(seed_vault, False, True),
        AccountMeta(vault_auth, False, False),
        AccountMeta(user_ata, False, True),
        AccountMeta(TOKEN_PROGRAM_ID, False, False),
    ]
    return Instruction(SEED_SALE_PROGRAM_ID, data, accounts)

def build_seed_cancel_ix(authority: Pubkey, mint: Pubkey) -> Instruction:
    sale = seed_sale_pda(authority, mint)
    data = encode_seed_cancel()
    accounts = [
        AccountMeta(authority, True, False),
        AccountMeta(sale, False, True),
    ]
    return Instruction(SEED_SALE_PROGRAM_ID, data, accounts)

def build_init_vesting_ix(authority: Pubkey, mint: Pubkey, beneficiary: Pubkey, start_ts: int, cliff_ts: int, end_ts: int, total_amount: int) -> Instruction:
    vesting = vesting_pda(beneficiary)
    vest_vault = vest_vault_token_pda(beneficiary)
    vest_vault_authority = vesting  # same seeds
    data = encode_init_vesting(start_ts, cliff_ts, end_ts, total_amount)
    accounts = [
        AccountMeta(authority, True, True),
        AccountMeta(mint, False, False),
        AccountMeta(beneficiary, False, False),
        AccountMeta(vesting, False, True),
        AccountMeta(vest_vault_authority, False, False),
        AccountMeta(vest_vault, False, True),
        AccountMeta(TOKEN_PROGRAM_ID, False, False),
        AccountMeta(SYS_PROGRAM_ID, False, False),
        AccountMeta(Pubkey.from_string("SysvarRent111111111111111111111111111111111"), False, False),
    ]
    return Instruction(SEED_SALE_PROGRAM_ID, data, accounts)

def build_claim_vesting_ix(beneficiary: Pubkey, beneficiary_ata: Pubkey) -> Instruction:
    vesting = vesting_pda(beneficiary)
    vest_vault = vest_vault_token_pda(beneficiary)
    vest_vault_authority = vesting
    data = encode_claim_vesting()
    accounts = [
        AccountMeta(beneficiary, True, False),
        AccountMeta(vesting, False, True),
        AccountMeta(vest_vault, False, True),
        AccountMeta(vest_vault_authority, False, False),
        AccountMeta(beneficiary_ata, False, True),
        AccountMeta(TOKEN_PROGRAM_ID, False, False),
    ]
    return Instruction(SEED_SALE_PROGRAM_ID, data, accounts)


def encode_cancel_listing() -> bytes:
    return sighash("cancel_listing")


def encode_fill_listing() -> bytes:
    return sighash("fill_listing")


def build_open_pack_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    currency: str,
    rarity_prices: List[int],
    client_seed_hash: bytes,
    user_currency_token: Optional[Pubkey] = None,
    vault_currency_token: Optional[Pubkey] = None,
) -> Instruction:
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
    ]
    accounts.extend(
        [
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
    )
    # For open_pack_start, only the 11 CardRecords are needed in remaining accounts.
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    if currency.lower() == "usdc" or currency.lower() == "token":
        if not user_currency_token or not vault_currency_token:
            raise ValueError("Token currency requires token accounts")
        accounts.append(AccountMeta(pubkey=user_currency_token, is_signer=False, is_writable=True))
        accounts.append(AccountMeta(pubkey=vault_currency_token, is_signer=False, is_writable=True))
    data = encode_open_pack_start(currency, client_seed_hash, rarity_prices)
    return Instruction(program_id=PROGRAM_ID, data=data, accounts=accounts)

def build_open_pack_v2_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    reward_mint: Pubkey,
    reward_vault: Pubkey,
    user_token_account: Pubkey,
    rare_card_records: List[Pubkey],
    currency: str,
    client_seed_hash: bytes,
    rare_templates: List[int],
    user_currency_token: Optional[Pubkey] = None,
    vault_currency_token: Optional[Pubkey] = None,
) -> Instruction:
    # Enforce on-chain account order from the deployed program; positional list only.
    named_accounts: List[Tuple[str, AccountMeta]] = [
        ("user", AccountMeta(pubkey=user, is_signer=True, is_writable=True)),
        ("vault_state", AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True)),
        ("pack_session", AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True)),
        ("vault_authority", AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True)),
        ("vault_treasury", AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True)),
        ("reward_mint", AccountMeta(pubkey=reward_mint, is_signer=False, is_writable=True)),
        ("reward_vault", AccountMeta(pubkey=reward_vault, is_signer=False, is_writable=True)),
        ("token_program", AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False)),
        ("user_token_account", AccountMeta(pubkey=user_token_account, is_signer=False, is_writable=True)),
    ]
    named_accounts.extend(
        [
            (f"rare_card_record_{idx}", AccountMeta(pubkey=cr, is_signer=False, is_writable=True))
            for idx, cr in enumerate(rare_card_records)
        ]
    )
    if currency.lower() == "usdc" or currency.lower() == "token":
        if not user_currency_token or not vault_currency_token:
            raise ValueError("Token currency requires token accounts")
        named_accounts.append(
            ("user_currency_token", AccountMeta(pubkey=user_currency_token, is_signer=False, is_writable=True))
        )
        named_accounts.append(
            ("vault_currency_token", AccountMeta(pubkey=vault_currency_token, is_signer=False, is_writable=True))
        )
    # System program comes last (after remaining accounts) to match the deployed binary.
    named_accounts.append(("system_program", AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False)))
    accounts: List[AccountMeta] = [meta for _, meta in named_accounts]
    print("DEBUG open_pack_v2 accounts:")
    for idx, (name, meta) in enumerate(named_accounts):
        print(f"{idx}: {name} = {meta.pubkey}")
    data = encode_open_pack_v2(currency, client_seed_hash, rare_templates)
    return Instruction(program_id=PROGRAM_ID, data=data, accounts=accounts)


def build_claim_pack_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: List[Pubkey],
) -> Instruction:
    if len(card_records) != len(core_assets):
        raise ValueError("card_records/core_assets length mismatch")
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
    ]
    accounts.extend(
        [
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
    )
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    accounts.extend([AccountMeta(pubkey=asset, is_signer=False, is_writable=True) for asset in core_assets])
    return Instruction(program_id=PROGRAM_ID, data=encode_claim_pack(), accounts=accounts)

def build_claim_pack_v2_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: List[Pubkey],
) -> Instruction:
    if len(card_records) != len(core_assets):
        raise ValueError("card_records/core_assets length mismatch")
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
        AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    accounts.extend([AccountMeta(pubkey=asset, is_signer=False, is_writable=True) for asset in core_assets])
    return Instruction(program_id=PROGRAM_ID, data=encode_claim_pack_v2(), accounts=accounts)


def build_claim_batch_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: List[Pubkey],
) -> Instruction:
    if len(card_records) != len(core_assets):
        raise ValueError("card_records/core_assets length mismatch")
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
    ]
    accounts.extend(
        [
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
    )
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    accounts.extend([AccountMeta(pubkey=asset, is_signer=False, is_writable=True) for asset in core_assets])
    return Instruction(program_id=PROGRAM_ID, data=encode_claim_pack_batch(), accounts=accounts)


def build_claim_batch3_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: List[Pubkey],
) -> Instruction:
    if len(card_records) != 3 or len(core_assets) != 3:
        raise ValueError("claim_batch3 requires exactly 3 card_records/core_assets")
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
    ]
    accounts.extend(
        [
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
    )
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    accounts.extend([AccountMeta(pubkey=asset, is_signer=False, is_writable=True) for asset in core_assets])
    return Instruction(program_id=PROGRAM_ID, data=encode_claim_pack_batch3(), accounts=accounts)


def build_finalize_claim_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
) -> Instruction:
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
    ]
    return Instruction(program_id=PROGRAM_ID, data=encode_finalize_claim(), accounts=accounts)


def build_sellback_pack_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: List[Pubkey],
    user_currency_token: Optional[Pubkey] = None,
    vault_currency_token: Optional[Pubkey] = None,
) -> Instruction:
    if len(card_records) != len(core_assets):
        raise ValueError("card_records/core_assets length mismatch")
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
    ]
    accounts.extend(
        [
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
    )
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    accounts.extend([AccountMeta(pubkey=asset, is_signer=False, is_writable=True) for asset in core_assets])
    if user_currency_token and vault_currency_token:
        accounts.append(AccountMeta(pubkey=user_currency_token, is_signer=False, is_writable=True))
        accounts.append(AccountMeta(pubkey=vault_currency_token, is_signer=False, is_writable=True))
    return Instruction(program_id=PROGRAM_ID, data=encode_sellback_pack(), accounts=accounts)

def build_sellback_pack_v2_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: List[Pubkey],
    user_currency_token: Optional[Pubkey] = None,
    vault_currency_token: Optional[Pubkey] = None,
) -> Instruction:
    if len(card_records) != len(core_assets):
        raise ValueError("card_records/core_assets length mismatch")
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
        AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    accounts.extend([AccountMeta(pubkey=asset, is_signer=False, is_writable=True) for asset in core_assets])
    if user_currency_token and vault_currency_token:
        accounts.append(AccountMeta(pubkey=user_currency_token, is_signer=False, is_writable=True))
        accounts.append(AccountMeta(pubkey=vault_currency_token, is_signer=False, is_writable=True))
    return Instruction(program_id=PROGRAM_ID, data=encode_sellback_pack_v2(), accounts=accounts)


def build_expire_session_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: Optional[List[Pubkey]] = None,
) -> Instruction:
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
    ]
    accounts.extend(
        [
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
        ]
    )
    accounts.extend(
        [AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records]
    )
    return Instruction(program_id=PROGRAM_ID, data=encode_expire_session(), accounts=accounts)

def build_expire_session_v2_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
) -> Instruction:
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
        AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    accounts.extend([AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records])
    return Instruction(program_id=PROGRAM_ID, data=encode_expire_session_v2(), accounts=accounts)


def build_admin_force_expire_ix(
    admin: Pubkey,
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
    card_records: List[Pubkey],
    core_assets: Optional[List[Pubkey]] = None,
) -> Instruction:
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=admin, is_signer=True, is_writable=True),
        AccountMeta(pubkey=user, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    accounts.extend(
        [AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records]
    )
    if core_assets:
        accounts.extend(
            [AccountMeta(pubkey=asset, is_signer=False, is_writable=True) for asset in core_assets]
    )
    return Instruction(program_id=PROGRAM_ID, data=encode_admin_force_expire(), accounts=accounts)


def build_admin_reset_session_ix(
    admin: Pubkey,
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    card_records: Optional[List[Pubkey]] = None,
) -> Instruction:
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=admin, is_signer=True, is_writable=True),
        AccountMeta(pubkey=user, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
    ]
    if card_records:
        accounts.extend(
            [AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records]
        )
    return Instruction(program_id=PROGRAM_ID, data=encode_admin_reset_session(), accounts=accounts)


def build_admin_force_close_session_ix(
    admin: Pubkey,
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    card_records: list[Pubkey],
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=admin, is_signer=True, is_writable=True),
        AccountMeta(pubkey=user, is_signer=False, is_writable=False),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
    ]
    for cr in card_records:
        accounts.append(AccountMeta(pubkey=cr, is_signer=False, is_writable=True))
    return Instruction(program_id=PROGRAM_ID, data=encode_admin_force_close_session(), accounts=accounts)

def build_admin_force_close_v2_ix(
    admin: Pubkey,
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    card_records: list[Pubkey],
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=admin, is_signer=True, is_writable=True),
        AccountMeta(pubkey=user, is_signer=False, is_writable=False),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
    ]
    for cr in card_records:
        accounts.append(AccountMeta(pubkey=cr, is_signer=False, is_writable=True))
    return Instruction(program_id=PROGRAM_ID, data=encode_admin_force_close_v2(), accounts=accounts)


def build_set_reward_config_ix(
    admin: Pubkey,
    vault_state: Pubkey,
    vault_authority: Pubkey,
    mochi_mint: Pubkey,
    reward_per_pack: int,
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=admin, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    data = encode_set_reward_config(mochi_mint, reward_per_pack)
    return Instruction(program_id=PROGRAM_ID, data=data, accounts=accounts)

def build_admin_force_cancel_listing_ix(
    admin: Pubkey,
    vault_state: Pubkey,
    card_record: Pubkey,
    core_asset: Pubkey,
    listing: Pubkey,
    vault_authority: Pubkey,
    seller: Pubkey,
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=admin, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=card_record, is_signer=False, is_writable=True),
        AccountMeta(pubkey=core_asset, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=seller, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    return Instruction(program_id=PROGRAM_ID, data=encode_admin_force_cancel_listing(), accounts=accounts)


def build_admin_prune_listing_ix(admin: Pubkey, vault_state: Pubkey, listing: Pubkey) -> Instruction:
    accounts = [
        AccountMeta(pubkey=admin, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
    ]
    return Instruction(program_id=PROGRAM_ID, data=encode_admin_prune_listing(), accounts=accounts)


def build_user_reset_session_ix(
    user: Pubkey,
    vault_state: Pubkey,
    pack_session: Pubkey,
    vault_authority: Pubkey,
    card_records: Optional[List[Pubkey]] = None,
) -> Instruction:
    accounts: List[AccountMeta] = [
        AccountMeta(pubkey=user, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=pack_session, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
    ]
    if card_records:
        accounts.extend(
            [AccountMeta(pubkey=cr, is_signer=False, is_writable=True) for cr in card_records]
        )
    return Instruction(program_id=PROGRAM_ID, data=encode_user_reset_session(), accounts=accounts)


def build_list_card_ix(
    seller: Pubkey,
    vault_state: Pubkey,
    card_record: Pubkey,
    core_asset: Pubkey,
    listing: Pubkey,
    vault_authority: Pubkey,
    price_lamports: int,
    currency_mint: Optional[str],
    template_id: int,
    rarity_tag: int,
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=seller, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=card_record, is_signer=False, is_writable=True),
        AccountMeta(pubkey=core_asset, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    data = encode_list_card(price_lamports, currency_mint, template_id, rarity_tag)
    return Instruction(program_id=PROGRAM_ID, data=data, accounts=accounts)


def build_cancel_listing_ix(
    seller: Pubkey,
    vault_state: Pubkey,
    card_record: Pubkey,
    core_asset: Pubkey,
    listing: Pubkey,
    vault_authority: Pubkey,
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=seller, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=card_record, is_signer=False, is_writable=True),
        AccountMeta(pubkey=core_asset, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    return Instruction(program_id=PROGRAM_ID, data=encode_cancel_listing(), accounts=accounts)

def build_system_transfer_ix(sender: Pubkey, recipient: Pubkey, lamports: int) -> Instruction:
    # SystemProgram transfer: instruction = 2 (u32 LE) + lamports (u64 LE)
    data = (2).to_bytes(4, "little") + lamports.to_bytes(8, "little")
    accounts = [
        AccountMeta(pubkey=sender, is_signer=True, is_writable=True),
        AccountMeta(pubkey=recipient, is_signer=False, is_writable=True),
    ]
    return Instruction(program_id=SYS_PROGRAM_ID, data=data, accounts=accounts)


def build_fill_listing_ix(
    buyer: Pubkey,
    seller: Pubkey,
    vault_state: Pubkey,
    card_record: Pubkey,
    core_asset: Pubkey,
    listing: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=buyer, is_signer=True, is_writable=True),
        AccountMeta(pubkey=seller, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=card_record, is_signer=False, is_writable=True),
        AccountMeta(pubkey=core_asset, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
        AccountMeta(pubkey=MPL_CORE_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    return Instruction(program_id=PROGRAM_ID, data=encode_fill_listing(), accounts=accounts)


def instruction_to_dict(ix: Instruction) -> dict:
    return {
        "program_id": str(ix.program_id),
        "keys": [
            {
                "pubkey": str(k.pubkey),
                "is_signer": k.is_signer,
                "is_writable": k.is_writable,
            }
            for k in ix.accounts
        ],
        "data": base64.b64encode(ix.data).decode(),
    }


def message_from_instructions(ixs: List[Instruction], payer: Pubkey, blockhash: str) -> str:
    message = MessageV0.try_compile(payer, ixs, [], Hash.from_string(blockhash))
    return base64.b64encode(bytes(message)).decode()


def versioned_tx_b64(payer: Pubkey, blockhash: str, ixs: List[Instruction]) -> str:
    message = MessageV0.try_compile(payer, ixs, [], Hash.from_string(blockhash))
    return base64.b64encode(bytes(message)).decode()
