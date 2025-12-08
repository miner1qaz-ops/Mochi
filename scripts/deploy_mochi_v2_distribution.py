#!/usr/bin/env python3
"""
Mochi V2 Token Generation Event (TGE)

- Mints 1,000,000,000 MOCHI V2 tokens to a temporary master key.
- Generates allocation keypairs under keys/allocation/ and distributes:
  * team_locked.json:         300,000,000
  * community_master.json:    400,000,000
  * presale_distributor.json: 100,000,000
  * liquidity_reserve.json:   100,000,000
  * treasury_reserve.json:    100,000,000
- Transfers 10,000,000 from community_master.json to the server admin keypair
  (ADMIN_KEYPAIR_PATH or anchor-program/keys/dev-authority.json) to fund recycle ops.

Default cluster: devnet (override with SOLANA_RPC / SOLANA_DEVNET_RPC / HELIUS_RPC_URL).
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import base64

from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from solana.transaction import Transaction
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.rpc.responses import SendTransactionResp
from solders.signature import Signature
from spl.token.client import Token
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token._layouts import ACCOUNT_LAYOUT
from spl.token.instructions import (
    MintToParams,
    TransferCheckedParams,
    create_associated_token_account,
    get_associated_token_address,
    mint_to as spl_mint_to,
    transfer_checked,
)

LAMPORTS_PER_SOL = 1_000_000_000
TOTAL_SUPPLY = 1_000_000_000
ALLOCATION_DIR = Path("keys/allocation")
MASTER_KEY_PATH = ALLOCATION_DIR / "mochi_v2_master.json"
DEFAULT_ADMIN_KEY_PATH = Path("anchor-program/keys/dev-authority.json")
DEFAULT_RPC = "https://api.devnet.solana.com"

ALLOCATION_BUCKETS: List[Tuple[str, int]] = [
    ("team_locked.json", 300_000_000),
    ("community_master.json", 400_000_000),
    ("presale_distributor.json", 100_000_000),
    ("liquidity_reserve.json", 100_000_000),
    ("treasury_reserve.json", 100_000_000),
]


@dataclass
class AllocationResult:
    name: str
    pubkey: Pubkey
    ata: Pubkey
    amount: int
    signature: str
    final_raw: int
    transferred_raw: int


def load_keypair(path: Path) -> Keypair:
    if not path.exists():
        raise FileNotFoundError(f"Missing keypair at {path}")
    data = json.loads(path.read_text())
    return Keypair.from_bytes(bytes(data))


def load_or_create_keypair(path: Path) -> Keypair:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return load_keypair(path)
    kp = Keypair()
    path.write_text(json.dumps(list(bytes(kp))))
    os.chmod(path, 0o600)
    return kp


def ensure_airdrop(client: Client, owner: Pubkey, min_sol: float = 1.5) -> None:
    """
    Ensure the payer has enough SOL for rent/fees. Best-effort devnet airdrop.
    """
    balance = client.get_balance(owner, commitment=Confirmed).value
    if balance >= int(min_sol * LAMPORTS_PER_SOL):
        return
    try:
        sig = client.request_airdrop(owner, int(max(min_sol, 1.0) * LAMPORTS_PER_SOL)).value
        confirm_signature(client, sig)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  Airdrop failed or unsupported: {exc}", file=sys.stderr)
    post_balance = client.get_balance(owner, commitment=Confirmed).value
    if post_balance < int(min_sol * LAMPORTS_PER_SOL):
        raise RuntimeError("Admin keypair lacks SOL; top up funds before rerunning.")


def ensure_ata(client: Client, mint: Pubkey, owner: Pubkey, payer: Keypair) -> Pubkey:
    ata = get_associated_token_address(owner, mint)
    info = client.get_account_info(ata, commitment=Confirmed)
    if info.value is None:
        tx = Transaction(fee_payer=payer.pubkey())
        tx.add(create_associated_token_account(payer=payer.pubkey(), owner=owner, mint=mint))
        resp = client.send_transaction(
            tx,
            payer,
            opts=TxOpts(skip_confirmation=False, skip_preflight=False, preflight_commitment=Confirmed),
        )
        confirm_signature(client, extract_sig(resp))
    return ata


def ata_amount(client: Client, ata: Pubkey, expected_mint: Optional[Pubkey] = None) -> int:
    info = client.get_account_info(ata, commitment=Confirmed).value
    if info is None:
        return 0
    data = info.data
    if isinstance(data, (list, tuple)):
        raw = data[0] if data else b""
        data_bytes = base64.b64decode(raw) if not isinstance(raw, (bytes, bytearray)) else bytes(raw)
    else:
        data_bytes = bytes(data)
    parsed = ACCOUNT_LAYOUT.parse(data_bytes)
    mint_in_account = Pubkey(parsed.mint)
    if expected_mint and mint_in_account != expected_mint:
        raise RuntimeError(f"ATA {ata} mint mismatch: {mint_in_account} != {expected_mint}")
    return parsed.amount


def extract_sig(resp: SendTransactionResp | dict | str | None) -> str:
    if isinstance(resp, SendTransactionResp):
        return str(resp.value)
    if isinstance(resp, dict):
        return str(resp.get("result") or resp.get("value") or "")
    if resp is None:
        return ""
    return str(resp)


def to_signature(sig: str | Signature | None) -> Signature | None:
    if isinstance(sig, Signature):
        return sig
    if isinstance(sig, str) and sig:
        try:
            return Signature.from_string(sig)
        except Exception:
            return None
    return None


def confirm_signature(client: Client, sig: str | Signature | None) -> None:
    sig_obj = to_signature(sig)
    if sig_obj:
        client.confirm_transaction(sig_obj, commitment="confirmed")


def send_token_tx(client: Client, payer: Keypair, signers: List[Keypair], *ixs) -> str:
    """
    Build and send a transaction with the given payer and signers.
    """
    tx = Transaction(fee_payer=payer.pubkey())
    for ix in ixs:
        tx.add(ix)
    resp = client.send_transaction(
        tx,
        payer,
        *signers,
        opts=TxOpts(skip_confirmation=False, skip_preflight=False, preflight_commitment=Confirmed),
    )
    sig = extract_sig(resp)
    confirm_signature(client, sig)
    return sig


def main() -> None:
    base = Path(__file__).resolve().parents[1]
    rpc_url = (
        os.environ.get("SOLANA_RPC")
        or os.environ.get("SOLANA_DEVNET_RPC")
        or os.environ.get("HELIUS_RPC_URL")
        or DEFAULT_RPC
    )
    decimals = int(os.environ.get("MOCHI_TOKEN_DECIMALS", "6"))
    power = 10**decimals
    admin_path = Path(os.environ.get("ADMIN_KEYPAIR_PATH") or base / DEFAULT_ADMIN_KEY_PATH)
    admin_kp = load_keypair(admin_path)
    client = Client(rpc_url, commitment=Confirmed, timeout=30)
    ensure_airdrop(client, admin_kp.pubkey(), min_sol=2.0)

    master_kp = load_or_create_keypair(base / MASTER_KEY_PATH)
    existing_mint_str = os.environ.get("MOCHI_V2_MINT") or os.environ.get("MOCHI_MINT_ADDRESS")
    print(f"Using RPC: {rpc_url}")
    print(f"Admin (payer): {admin_kp.pubkey()}")
    print(f"Master (mint authority): {master_kp.pubkey()}")

    mint_sig = None
    if existing_mint_str:
        mint = Pubkey.from_string(existing_mint_str)
        token = Token(client, mint, TOKEN_PROGRAM_ID, admin_kp)
        print(f"Reusing existing mint {mint}")
    else:
        token = Token.create_mint(
            client,
            payer=admin_kp,
            mint_authority=master_kp.pubkey(),
            decimals=decimals,
            program_id=TOKEN_PROGRAM_ID,
            freeze_authority=master_kp.pubkey(),
            skip_confirmation=False,
        )
        mint = token.pubkey
        print(f"Created new mint {mint}")

    master_ata = ensure_ata(client, mint, master_kp.pubkey(), admin_kp)
    raw_total = TOTAL_SUPPLY * power
    if not existing_mint_str:
        mint_sig = send_token_tx(
            client,
            admin_kp,
            [master_kp],
            spl_mint_to(
                MintToParams(
                    program_id=TOKEN_PROGRAM_ID,
                    mint=mint,
                    dest=master_ata,
                    mint_authority=master_kp.pubkey(),
                    amount=raw_total,
                    signers=[],
                )
            ),
        )
        print(f"Minted {TOTAL_SUPPLY} MOCHI (raw {raw_total}) to master ATA {master_ata}")
    else:
        print(f"Skipping mint; existing mint {mint} will be used for allocations.")

    allocation_results: List[AllocationResult] = []
    kp_map: Dict[str, Keypair] = {}
    master_balance = ata_amount(client, master_ata, mint)
    for name, amount in ALLOCATION_BUCKETS:
        kp = load_or_create_keypair(base / ALLOCATION_DIR / name)
        kp_map[name] = kp
        ata = ensure_ata(client, mint, kp.pubkey(), admin_kp)
        raw_amount = amount * power
        current_raw = ata_amount(client, ata, mint)
        transferred = 0
        sig = ""
        if current_raw < raw_amount:
            needed = raw_amount - current_raw
            if master_balance < needed:
                raise RuntimeError(f"Master balance {master_balance} too low for {name} (needs {needed})")
            sig_val = send_token_tx(
                client,
                admin_kp,
                [master_kp],
                transfer_checked(
                    TransferCheckedParams(
                        program_id=TOKEN_PROGRAM_ID,
                        source=master_ata,
                        mint=mint,
                        dest=ata,
                        owner=master_kp.pubkey(),
                        amount=needed,
                        decimals=decimals,
                        signers=[],
                    )
                ),
            )
            sig = extract_sig(sig_val)
            transferred = needed
            master_balance -= needed
            current_raw += needed
            print(f"Allocated {amount} to {name} ({kp.pubkey()}) → {ata}")
        else:
            print(f"Skipped {name}; already has {current_raw / power} tokens (target {amount}).")
        allocation_results.append(
            AllocationResult(
                name=name,
                pubkey=kp.pubkey(),
                ata=ata,
                amount=amount,
                signature=sig,
                final_raw=current_raw,
                transferred_raw=transferred,
            )
        )

    community = next(a for a in allocation_results if a.name == "community_master.json")
    admin_ata = ensure_ata(client, mint, admin_kp.pubkey(), admin_kp)
    ops_amount = 10_000_000 * power
    admin_balance = ata_amount(client, admin_ata, mint)
    community_balance = ata_amount(client, community.ata, mint)
    ops_sig = ""
    if admin_balance < ops_amount:
        needed = ops_amount - admin_balance
        if community_balance < needed:
            raise RuntimeError("Community bucket lacks funds to cover admin ops transfer")
        sig_val = send_token_tx(
            client,
            admin_kp,
            [kp_map["community_master.json"]],
            transfer_checked(
                TransferCheckedParams(
                    program_id=TOKEN_PROGRAM_ID,
                    source=community.ata,
                    mint=mint,
                    dest=admin_ata,
                    owner=kp_map["community_master.json"].pubkey(),
                    amount=needed,
                    decimals=decimals,
                    signers=[],
                )
            ),
        )
        ops_sig = extract_sig(sig_val)
        admin_balance += needed
        community_balance -= needed
        print(f"Funded admin treasury with {needed / power} from community_master.json → {admin_ata}")
    else:
        print(f"Admin already funded with {admin_balance / power} tokens; skipping ops transfer.")

    # Reflect updated community balance in results
    for idx, res in enumerate(allocation_results):
        if res.name == "community_master.json":
            allocation_results[idx].final_raw = community_balance
            break

    mint_info = token.get_mint_info()
    master_balance_final = ata_amount(client, master_ata, mint)
    summary: Dict[str, object] = {
        "mint": str(mint),
        "decimals": decimals,
        "total_supply_raw": raw_total,
        "master": {
            "pubkey": str(master_kp.pubkey()),
            "ata": str(master_ata),
            "mint_sig": extract_sig(mint_sig) if mint_sig else "",
            "balance_raw": master_balance_final,
        },
        "allocations": [
            {
                "bucket": res.name,
                "pubkey": str(res.pubkey),
                "ata": str(res.ata),
                "amount": res.amount,
                "signature": res.signature,
                "final_balance_raw": res.final_raw,
                "final_balance_tokens": res.final_raw / power,
                "transferred_raw": res.transferred_raw,
            }
            for res in allocation_results
        ],
        "operations_funding": {
            "amount": 10_000_000,
            "admin_ata": str(admin_ata),
            "signature": extract_sig(ops_sig) if ops_sig else "",
            "final_admin_balance_raw": admin_balance,
            "final_admin_balance_tokens": admin_balance / power,
        },
        "mint_info": {
            "supply": mint_info.supply,
            "decimals": mint_info.decimals,
            "mint_authority": str(mint_info.mint_authority),
            "freeze_authority": str(mint_info.freeze_authority),
        },
    }
    output_path = base / "scripts" / "deploy_mochi_v2_distribution.latest.json"
    output_path.write_text(json.dumps(summary, indent=2))
    print("\n=== Distribution Summary ===")
    print(json.dumps(summary, indent=2))
    print(f"\nSaved summary to {output_path}")


if __name__ == "__main__":
    main()
