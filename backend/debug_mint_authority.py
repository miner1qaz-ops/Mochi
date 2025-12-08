import base64
import json
import os
import struct
from typing import Optional

from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.pubkey import Pubkey

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


def load_env(path: str) -> dict:
    data = {}
    if not os.path.exists(path):
        return data
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip()
    return data


def load_keypair(path: str) -> Keypair:
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    if isinstance(raw, list):
        secret = bytes(raw)
    elif isinstance(raw, dict) and "secretKey" in raw:
        secret = bytes(raw["secretKey"])
    else:
        raise ValueError("Unsupported keypair file format")
    return Keypair.from_bytes(secret)


def parse_mint(data: bytes) -> dict:
    # SPL Mint layout: https://github.com/solana-labs/solana-program-library/blob/master/token/program/src/state.rs#L20
    if len(data) < 82:
        raise ValueError(f"Mint account too short: {len(data)} bytes")
    o = 0
    mint_auth_opt = struct.unpack_from("<I", data, o)[0]; o += 4
    mint_auth: Optional[Pubkey] = None
    if mint_auth_opt != 0:
        mint_auth = Pubkey.from_bytes(data[o:o+32]); o += 32
    else:
        o += 32
    supply = struct.unpack_from("<Q", data, o)[0]; o += 8
    decimals = data[o]; o += 1
    is_init = data[o] == 1; o += 1
    freeze_opt = struct.unpack_from("<I", data, o)[0]; o += 4
    freeze_auth: Optional[Pubkey] = None
    if freeze_opt != 0:
        freeze_auth = Pubkey.from_bytes(data[o:o+32])
    return {
        "mint_authority": mint_auth,
        "freeze_authority": freeze_auth,
        "supply": supply,
        "decimals": decimals,
        "is_initialized": is_init,
    }


def main():
    env = load_env(ENV_PATH)
    mint_addr = env.get("MOCHI_TOKEN_MINT")
    admin_path = env.get("ADMIN_KEYPAIR_PATH")
    rpc = env.get("HELIUS_RPC_URL") or env.get("SOLANA_RPC") or "https://api.devnet.solana.com"
    if not mint_addr or not admin_path:
        print("Missing MOCHI_TOKEN_MINT or ADMIN_KEYPAIR_PATH in .env")
        return

    admin_kp = load_keypair(admin_path)
    admin_pub = admin_kp.pubkey()
    mint_pub = Pubkey.from_string(mint_addr)

    print(f"Configured Mint: {mint_pub}")
    print(f"Derived Admin Pubkey: {admin_pub}")
    print(f"RPC: {rpc}")

    client = Client(rpc)
    resp = client.get_account_info(mint_pub)
    if getattr(resp, "error", None):
        print(f"RPC error fetching mint: {resp.error}")
        return
    value = resp.value
    if value is None or value.data is None:
        print("Mint account not found on-chain or has no data")
        return
    raw_data = value.data
    if isinstance(raw_data, (bytes, bytearray)):
        raw = bytes(raw_data)
    else:
        # handle (data, encoding) tuple/list shape
        data_b64 = raw_data[0] if isinstance(raw_data, (list, tuple)) else raw_data
        raw = base64.b64decode(data_b64)
    parsed = parse_mint(raw)
    onchain_auth = parsed["mint_authority"]
    print(f"On-chain Mint Authority: {onchain_auth}")
    print(f"On-chain Decimals: {parsed['decimals']} Supply: {parsed['supply']} Initialized: {parsed['is_initialized']}")

    if onchain_auth is None:
        print("Mint authority is None (mint is frozen/immutable)")
        return
    if onchain_auth != admin_pub:
        print(
            f"CONFIGURATION ERROR: Admin Key {admin_pub} is not the owner of Mint {mint_pub}. On-chain authority is {onchain_auth}."
        )
    else:
        print("Configuration OK: Admin key matches on-chain mint authority.")


if __name__ == "__main__":
    main()
