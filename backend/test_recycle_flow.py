import base64
import json
import os
import sqlite3
import sys
from typing import Optional

import requests
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
BACKEND_URL = "http://127.0.0.1:4000"
DB_PATH = os.path.join(os.path.dirname(__file__), "mochi.db")
ASSOCIATED_TOKEN_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")


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


def derive_ata(owner: Pubkey, mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([bytes(owner), bytes(TOKEN_PROGRAM_ID), bytes(mint)], ASSOCIATED_TOKEN_PROGRAM_ID)[0]


def ensure_virtual_card(wallet: str, conn: sqlite3.Connection) -> Optional[dict]:
    cur = conn.cursor()
    tmpl_row = cur.execute("SELECT template_id, rarity FROM CardTemplate LIMIT 1").fetchone()
    if not tmpl_row:
        print("No CardTemplate rows available.")
        return None
    template_id, rarity = tmpl_row
    cur.execute(
        "INSERT OR IGNORE INTO VirtualCard (wallet, template_id, rarity, count) VALUES (?, ?, ?, 0)",
        (wallet, template_id, rarity),
    )
    cur.execute(
        "UPDATE VirtualCard SET count = count + 1 WHERE wallet = ? AND template_id = ?",
        (wallet, template_id),
    )
    conn.commit()
    return {"template_id": template_id, "rarity": rarity, "count": 1}


def main():
    env = load_env(ENV_PATH)
    mint_addr = env.get("MOCHI_TOKEN_MINT")
    if not mint_addr:
        print("MOCHI_TOKEN_MINT missing in .env")
        sys.exit(1)
    mint_pub = Pubkey.from_string(mint_addr)

    user = Keypair()
    wallet_str = str(user.pubkey())
    print(f"Using temp user wallet: {wallet_str}")

    conn = sqlite3.connect(DB_PATH)
    item = ensure_virtual_card(wallet_str, conn)
    if not item:
        return
    items = [item]
    user_token_account = derive_ata(user.pubkey(), mint_pub)

    try:
        build_resp = requests.post(
            f"{BACKEND_URL}/profile/recycle/build",
            json={
                "wallet": wallet_str,
                "items": items,
                "user_token_account": str(user_token_account),
            },
            timeout=15,
        )
    except Exception as exc:
        print(f"HTTP error calling recycle/build: {exc}")
        return

    if build_resp.status_code != 200:
        print(f"/recycle/build failed {build_resp.status_code}: {build_resp.text}")
        return

    data = build_resp.json()
    msg_b64 = data.get("message_b64")
    if not msg_b64:
        print(f"/recycle/build missing message_b64: {data}")
        return

    message = MessageV0.from_bytes(base64.b64decode(msg_b64))
    signer_keys = list(message.account_keys)
    required = message.header.num_required_signatures
    try:
        user_index = signer_keys.index(user.pubkey())
    except ValueError:
        print("User pubkey not found in message signers")
        return

    sigs = [Signature.default() for _ in range(required)]
    sigs[user_index] = user.sign_message(bytes(message))
    signed_tx = VersionedTransaction.populate(message, sigs)
    signed_b64 = base64.b64encode(bytes(signed_tx)).decode()

    try:
        submit_resp = requests.post(
            f"{BACKEND_URL}/profile/recycle/submit",
            json={
                "wallet": wallet_str,
                "signed_tx_b64": signed_b64,
                "items": items,
            },
            timeout=30,
        )
    except Exception as exc:
        print(f"HTTP error calling recycle/submit: {exc}")
        return

    print(f"Submit status: {submit_resp.status_code}")
    try:
        print(submit_resp.json())
    except Exception:
        print(submit_resp.text)


if __name__ == "__main__":
    main()
