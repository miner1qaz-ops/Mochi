# Mochi v2 – Agent Guide

This is a clean rebuild of the Mochi real‑world‑asset Pokémon card platform for Solana devnet. Use this guide as the orientation doc for future agents.

## High-level architecture
- **On-chain (Anchor):** `mochi_v2_vault` program manages vault state, card records, pack sessions, and marketplace listings. NFTs use Metaplex Core assets. Treasury & escrow are owned by a PDA `vault_authority`.
- **Backend (FastAPI):** Transaction builder + provably-fair RNG service + DB mirror (SQLite/Postgres). Uses Helius DAS for reads. Scripts live in `/scripts`.
- **Frontend (Next.js App Router):** Wallet adapter + animated UI for gacha, marketplace, profiles, admin. Calls backend for previews/tx builders.
- **Data:** Card templates loaded from CSV into the DB; mint records mirror Core assets in custody.

## Key flows
- **Pack opening:**
  1) Frontend calls `/program/open/preview` with client seed to show rarities.
  2) `/program/open/build` selects specific assets (DB/Helius), builds `open_pack_start` tx.
  3) User signs; decision window = 1 hour. `claim_pack` or `sellback_pack` txs are built by backend.
- **Marketplace:** Listings stored on-chain via `Listing` PDA; backend provides tx builders; frontend renders grid & actions.
- **Profiles:** Read holdings via Helius DAS filtered by Core collection; enrich with CSV template metadata.
- **Admin:** Inventory by rarity, session mirrors, cleanup/settle helpers.

## Seeds / PDAs
- `vault_state`: [`"vault_state"`]
- `vault_authority`: [`"vault_authority"`, vault_state]
- `card_record`: [`"card_record"`, vault_state, core_asset]
- `pack_session`: [`"pack_session"`, vault_state, user]
- `listing`: [`"listing"`, vault_state, core_asset]

## Environment
- Devnet-first. RPC via Helius (set `HELIUS_RPC_URL`).
- Wallets: generated keypairs live in `anchor-program/keys/`. `passkey.json` is the authority key; `program-id.json` is the program deploy key.
- Treasury: set `TREASURY_WALLET` (defaults to `PLATFORM_WALLET`) for marketplace fees/buyback payouts.
- Backend tx builders return message base64 (`tx_b64`), unsigned v0 tx (`tx_v0_b64`), instruction metadata, and `recent_blockhash` for client signing.
- RNG provably-fair: `server_seed_hash` (commit), `server_nonce = sha256(server_seed_hash:client_seed)[:16]`, entropy = `sha256(server_seed:client_seed:server_nonce)`. Preview/build return `server_seed_hash`, `server_nonce`, and `entropy_proof` so users can verify slot lineups.
- Timekeeping: prefer ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`). Install MCP time server (`pip install mcp-server-time` or `uvx mcp-server-time`) to keep logs accurate; see `docs/mcp_time.md`.
- Devnet defaults (generated): CORE_AUTHORITY/VAULT wallet `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs`, USDC mint `GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu`. Secrets in `anchor-program/keys/dev-authority.json` and `dev-usdc-mint.json`.

## Repos & folders
```
/mochi
  anchor-program   (Anchor code + IDL + keys)
  backend          (FastAPI + models + tx builders)
  frontend         (Next.js/Tailwind/Framer/wallet adapter)
  scripts          (CSV importer, mint + deposit helpers)
  docs             (this guide and per-surface docs)
```

## Dev conventions
- Use devnet program id `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`.
- Keep docs in `/docs` updated whenever you change code or flows.
- Prefer Helius DAS for reads; Anchor RPC for writes.
- Provably-fair RNG = `sha256(server_seed:client_seed)` → deterministic RNG; store `server_seed_hash` in responses.

## Useful commands
- Backend dev: `cd backend && uvicorn main:app --reload --port 8000`
- Frontend dev: `cd frontend && npm install && npm run dev`
- Import templates: `python scripts/import_card_templates.py path/to/meg_web_expanded.csv`
- Mint placeholders: `python scripts/mint_core_from_csv.py path/to/meg_web_expanded.csv`
- Deposit assets: `python scripts/deposit_core_assets.py`

## Contact points
- Admin address: set via env `ADMIN_ADDRESS` / `NEXT_PUBLIC_ADMIN_ADDRESS`.
- Core collection: set via env `CORE_COLLECTION_ADDRESS`.

Keep this guide current as the stack evolves and when adding VRF, payments, or redemption flows.
