import base64
import hashlib
from typing import List, Optional

from borsh_construct import CStruct, Enum, Option, U16, U64, U8, Vec
from solders.instruction import AccountMeta, Instruction
from solders.message import MessageV0
from solders.hash import Hash
from solders.transaction import VersionedTransaction
from solders.pubkey import Pubkey

PROGRAM_ID = Pubkey.from_string("Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx")
SYS_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
MPL_CORE_PROGRAM_ID = Pubkey.from_string("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d")


CurrencyLayout = Enum("Sol" / CStruct(), "Token" / CStruct(), enum_name="Currency")
OpenPackStartLayout = CStruct(
    "currency" / CurrencyLayout,
    "client_seed_hash" / U8[32],
    "rarity_prices" / Vec(U64),
)
ListCardLayout = CStruct("price_lamports" / U64, "currency_mint" / Option(U8[32]))


def sighash(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]


def to_pubkey(value: str) -> Pubkey:
    return Pubkey.from_string(value)


def vault_state_pda() -> Pubkey:
    return Pubkey.find_program_address([b"vault_state"], PROGRAM_ID)[0]


def vault_authority_pda(vault_state: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"vault_authority", bytes(vault_state)], PROGRAM_ID)[0]


def card_record_pda(vault_state: Pubkey, core_asset: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"card_record", bytes(vault_state), bytes(core_asset)], PROGRAM_ID
    )[0]


def pack_session_pda(vault_state: Pubkey, user: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"pack_session", bytes(vault_state), bytes(user)], PROGRAM_ID
    )[0]


def listing_pda(vault_state: Pubkey, core_asset: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"listing", bytes(vault_state), bytes(core_asset)], PROGRAM_ID
    )[0]


def encode_currency_tag(currency: str):
    if currency.lower() == "sol":
        return CurrencyLayout.enum.Sol()
    return CurrencyLayout.enum.Token()


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


def encode_claim_pack() -> bytes:
    return sighash("claim_pack")


def encode_claim_pack_batch() -> bytes:
    return sighash("claim_pack_batch")


def encode_claim_pack_batch3() -> bytes:
    return sighash("claim_pack_batch3")


def encode_finalize_claim() -> bytes:
    return sighash("finalize_claim")


def encode_sellback_pack() -> bytes:
    return sighash("sellback_pack")


def encode_expire_session() -> bytes:
    return sighash("expire_session")


def encode_admin_force_expire() -> bytes:
    return sighash("admin_force_expire")


def encode_admin_reset_session() -> bytes:
    return sighash("admin_reset_session")


def encode_admin_force_close_session() -> bytes:
    return sighash("admin_force_close_session")


def encode_user_reset_session() -> bytes:
    return sighash("user_reset_session")


def encode_list_card(price_lamports: int, currency_mint: Optional[str]) -> bytes:
    currency_bytes = None if not currency_mint else list(Pubkey.from_string(currency_mint).to_bytes())
    data = ListCardLayout.build({"price_lamports": price_lamports, "currency_mint": currency_bytes})
    return sighash("list_card") + data


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
    listing: Pubkey,
    vault_authority: Pubkey,
    price_lamports: int,
    currency_mint: Optional[str],
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=seller, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=card_record, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=False),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    data = encode_list_card(price_lamports, currency_mint)
    return Instruction(program_id=PROGRAM_ID, data=data, accounts=accounts)


def build_cancel_listing_ix(
    seller: Pubkey,
    vault_state: Pubkey,
    card_record: Pubkey,
    listing: Pubkey,
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=seller, is_signer=True, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=card_record, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
    ]
    return Instruction(program_id=PROGRAM_ID, data=encode_cancel_listing(), accounts=accounts)


def build_fill_listing_ix(
    buyer: Pubkey,
    seller: Pubkey,
    vault_state: Pubkey,
    card_record: Pubkey,
    listing: Pubkey,
    vault_authority: Pubkey,
    vault_treasury: Pubkey,
) -> Instruction:
    accounts = [
        AccountMeta(pubkey=buyer, is_signer=True, is_writable=True),
        AccountMeta(pubkey=seller, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_state, is_signer=False, is_writable=True),
        AccountMeta(pubkey=card_record, is_signer=False, is_writable=True),
        AccountMeta(pubkey=listing, is_signer=False, is_writable=True),
        AccountMeta(pubkey=vault_authority, is_signer=False, is_writable=False),
        AccountMeta(pubkey=vault_treasury, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
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
