"""
Batch-deposit Core assets recorded in MintRecord into the on-chain program.
Requires: anchorpy, solders; RPC with Helius recommended.
"""
import asyncio
from pathlib import Path

from anchorpy import Program, Provider, Wallet, Context
from anchorpy import Idl
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solana.rpc.async_api import AsyncClient
from sqlmodel import Session, SQLModel, create_engine, select

import json
import os

# Local imports
import sys
sys.path.append(str(Path(__file__).resolve().parents[1] / "backend"))
from main import MintRecord, auth_settings  # type: ignore

PROGRAM_ID = Pubkey.from_string("Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx")
IDL_PATH = Path(__file__).resolve().parents[1] / "anchor-program" / "idl" / "mochi_v2_vault.json"
KEY_PATH = Path(__file__).resolve().parents[1] / "anchor-program" / "keys" / "passkey.json"


def load_idl() -> Idl:
    with open(IDL_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return Idl.from_json(raw)


def load_wallet() -> Wallet:
    secret = json.loads(KEY_PATH.read_text())
    kp = Keypair.from_bytes(bytes(secret))
    return Wallet(kp)


async def deposit_one(program: Program, mint: MintRecord, vault_state: Pubkey):
    core_asset = Pubkey.from_string(mint.asset_id)
    card_record, _bump = Pubkey.find_program_address(
        [b"card_record", bytes(vault_state), bytes(core_asset)], program.program_id
    )
    vault_authority, _ = Pubkey.find_program_address([b"vault_authority", bytes(vault_state)], program.program_id)
    admin = program.provider.wallet.payer
    ctx = Context(
        accounts={
            "admin": admin,
            "vault_state": vault_state,
            "core_asset": core_asset,
            "card_record": card_record,
            "vault_authority": vault_authority,
            "system_program": Pubkey.from_string("11111111111111111111111111111111"),
        }
    )
    await program.rpc["deposit_card"](mint.template_id, mint.rarity, ctx=ctx)


async def main():
    idl = load_idl()
    wallet = load_wallet()
    client = AsyncClient(auth_settings.solana_rpc)
    provider = Provider(client, wallet)
    program = Program(idl, PROGRAM_ID, provider)

    vault_state = Pubkey.find_program_address([b"vault_state"], PROGRAM_ID)[0]
    engine = create_engine(auth_settings.database_url)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        stmt = select(MintRecord).where(MintRecord.status == "available")
        rows = session.exec(stmt).all()
    print(f"Depositing {len(rows)} assets into vault...")
    for mint in rows:
        await deposit_one(program, mint, vault_state)
    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
