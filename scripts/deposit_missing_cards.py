import asyncio
import json
from pathlib import Path
from typing import List, Tuple

from anchorpy import Context, Idl, Program, Provider, Wallet
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solders.keypair import Keypair
from solders.pubkey import Pubkey
SYS_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")

PROGRAM_ID = Pubkey.from_string("Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx")
RPC_URL = "https://api.devnet.solana.com"
KEYPAIR_PATH = Path("/root/mochi/anchor-program/keys/passkey.json")
IDL_PATH = Path("/root/mochi/anchor-program/target/idl/mochi_v2_vault.json")

MISSING: List[Tuple[str, int, str]] = [
    ("BvF65aJmPZ9yh12iiXVgLpqBod7fP6FeifTdaKGnRqSe", 77, "DoubleRare"),
    ("9TLDuw79rAdqAp49tQNLiWWMsrXLSZe5uLJiK9FBpBA2", 152, "IllustrationRare"),
    ("4AELiJuZutCeY24wsbQDBcSQt396LWFo1MndrtMbxHZB", 41, "Uncommon"),
]

RARITY_VARIANTS = {
    "Common": "common",
    "Uncommon": "uncommon",
    "Rare": "rare",
    "DoubleRare": "double_rare",
    "UltraRare": "ultra_rare",
    "IllustrationRare": "illustration_rare",
    "SpecialIllustrationRare": "special_illustration_rare",
    "MegaHyperRare": "mega_hyper_rare",
    "Energy": "energy",
}


def load_keypair(path: Path) -> Keypair:
    data = json.loads(path.read_text())
    return Keypair.from_bytes(bytes(data))


def rarity_variant(name: str) -> dict:
    key = RARITY_VARIANTS.get(name)
    if not key:
        raise ValueError(f"Unsupported rarity {name}")
    return {key: {}}


def vault_state_pda() -> Pubkey:
    return Pubkey.find_program_address([b"vault_state"], PROGRAM_ID)[0]


def card_record_pda(vault_state: Pubkey, asset: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"card_record", bytes(vault_state), bytes(asset)], PROGRAM_ID
    )[0]


def vault_authority_pda(vault_state: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"vault_authority", bytes(vault_state)], PROGRAM_ID)[0]


def load_idl() -> Idl:
    data = json.loads(IDL_PATH.read_text())
    return Idl.from_json(json.dumps(data))


async def main() -> None:
    kp = load_keypair(KEYPAIR_PATH)
    wallet = Wallet(kp)
    client = AsyncClient(RPC_URL, commitment=Confirmed)
    provider = Provider(client, wallet)
    idl = load_idl()
    program = Program(idl, PROGRAM_ID, provider)

    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)

    for asset_str, template_id, rarity in MISSING:
        asset = Pubkey.from_string(asset_str)
        card_record = card_record_pda(vault_state, asset)
        info = await client.get_account_info(card_record)
        if info.value is not None:
            print(f"CardRecord already exists for {asset_str}, skipping")
            continue
        print(f"Depositing template {template_id} ({rarity}) for asset {asset_str}")
        accounts = {
            "admin": wallet.public_key,
            "vault_state": vault_state,
            "core_asset": asset,
            "card_record": card_record,
            "vault_authority": vault_authority,
            "system_program": SYS_PROGRAM_ID,
        }
        sig = await program.rpc["deposit_card"](template_id, rarity_variant(rarity), ctx=Context(accounts=accounts))
        print(f" -> tx {sig}")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
