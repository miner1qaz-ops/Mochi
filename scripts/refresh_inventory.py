"""
Sync vault inventory from Helius into the local DB.

Requirements:
- HELIUS_RPC_URL set in the environment.
- Uses backend Settings/engine to find DB and vault PDAs.
"""

from __future__ import annotations

import pathlib
import sys
import time

from sqlmodel import Session

# Add backend module path
ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.append(str(ROOT))
sys.path.append(str(BACKEND))

from main import (  # type: ignore  # noqa: E402
    Settings,
    CardTemplate,
    MintRecord,
    engine,
    helius_get_assets,
    template_id_from_uri,
    vault_authority_pda,
    vault_state_pda,
)


def sync_inventory() -> dict:
    settings = Settings()
    if not settings.helius_rpc_url:
        raise SystemExit("HELIUS_RPC_URL not configured")
    vault_state = vault_state_pda()
    vault_authority = vault_authority_pda(vault_state)
    assets = helius_get_assets(str(vault_authority), settings.core_collection_address)
    updated: list[str] = []
    now = time.time()
    with Session(engine) as db:
        for item in assets:
            asset_id = item.get("id")
            if not asset_id:
                continue
            content = item.get("content", {}) or {}
            uri = content.get("json_uri") or content.get("links", {}).get("json")
            tmpl_id = template_id_from_uri(uri or "")
            template_row = db.get(CardTemplate, tmpl_id) if tmpl_id else None
            rarity = template_row.rarity if template_row else "unknown"
            existing = db.get(MintRecord, asset_id)
            if existing:
                existing.owner = str(vault_authority)
                existing.status = "available"
                existing.updated_at = now
                db.add(existing)
            else:
                db.add(
                    MintRecord(
                        asset_id=asset_id,
                        template_id=tmpl_id or 0,
                        rarity=rarity,
                        status="available",
                        owner=str(vault_authority),
                        updated_at=now,
                    )
                )
            updated.append(asset_id)
        db.commit()
    return {"vault_authority": str(vault_authority), "synced": len(updated)}


if __name__ == "__main__":
    result = sync_inventory()
    print(f"Synced {result['synced']} assets for vault {result['vault_authority']}")
