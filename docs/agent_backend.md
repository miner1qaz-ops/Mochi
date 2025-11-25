# Backend – FastAPI
Path: `backend/main.py`

## Environment
- `SOLANA_RPC`, `SOLANA_DEVNET_RPC` (devnet default)
- `HELIUS_RPC_URL` (DAS endpoint)
- `ADMIN_ADDRESS`, `PLATFORM_WALLET`, `CORE_COLLECTION_ADDRESS`
- `TREASURY_WALLET` (fallback to `PLATFORM_WALLET`)
- `USDC_MINT` (optional; required for token currency flows)
- `SERVER_SEED` (provably-fair secret)
- `DATABASE_URL` (default sqlite:///./mochi.db)

## Models (SQLModel)
- `CardTemplate`: template_id, index, card_name, rarity, variant, set_code, set_name, is_energy, energy_type, image_url
- `MintRecord`: asset_id, template_id, rarity, status, owner, updated_at
- `SessionMirror`: session_id, user, rarities(csv), asset_ids(csv), state, created_at, expires_at

## RNG / odds
- Provably-fair: `server_seed_hash = sha256(server_seed)`, `server_nonce = sha256(server_seed_hash:client_seed)[:16]`, entropy = `sha256(server_seed:client_seed:server_nonce)` feeds RNG. Preview/build return `server_seed_hash`, `server_nonce`, `entropy_proof` for verification.
- Slot recipe: 4x Common, 3x Uncommon, 1x flex (40%C/35%U/25%R), 1x reverse slot (MHR 0.04%, SIR 0.99%, IR 10.89%, Ultra 3.5%, Double 8%, Rare 15%, Uncommon 28%, Common 33.58%), 1x rare slot (MHR 0.0758%, SIR 0.8333%, IR 9.0909%, Ultra 7.1429%, Double 16.6667%, Rare 66.1905%), 1x Energy.

## Endpoints
- `GET /health`
- `POST /program/open/preview` → returns server_seed_hash + 11 slot rarities/template ids.
- `POST /program/open/build` → selects assets (DB), reserves MintRecords, persists SessionMirror, returns `tx_b64` (message), `tx_v0_b64` (unsigned v0 tx), `recent_blockhash`, instruction metadata, and provably_fair payload. Token currency path requires user/vault token accounts + currency_mint/USDC_MINT.
- `POST /program/claim/build` → builds claim instruction, marks MintRecords user_owned; returns `tx_b64` + `tx_v0_b64` + `recent_blockhash`. Optional token accounts accepted.
- `POST /program/sellback/build` → builds sellback instruction, resets MintRecords to available; returns `tx_b64` + `tx_v0_b64` + `recent_blockhash`. Optional token accounts accepted.
- `GET /profile/{wallet}` → Helius `getAssetsByOwner` with optional collection filter.
- Marketplace: `GET /marketplace/listings`, `POST /marketplace/list/build`, `POST /marketplace/fill/build`, `POST /marketplace/cancel/build` (tx placeholders).
- Admin: `GET /admin/inventory/rarity`, `GET /admin/sessions`, `POST /admin/session/settle`.
- `GET /pricing/rarity` → returns static rarity -> lamports mapping.

## Scripts
- `scripts/import_card_templates.py` – load CSV to DB.
- `scripts/mint_core_from_csv.py` – create placeholder MintRecords; replace with real Metaplex Core mint flow later.
- `scripts/deposit_core_assets.py` – anchorpy skeleton to call `deposit_card` per MintRecord.

## TODOs / extensions
- SPL/USDC path and price feeds remain TODO; RPC validations added for CardRecord and Listing seller discovery.
- Persist server_seed rotation + history for audits.
- Add auth for admin endpoints and session settlement.
- Add oracles/pricing for rarity values and SOL/USDC splits.
- Return fully assembled VersionedTransaction with blockhash fetched server-side once signing strategy is finalized.
