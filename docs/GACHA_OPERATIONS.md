# Gacha Operations Guide

This doc explains how the pack (gacha) flow works, what needs to be configured, and how to troubleshoot inventory/reward issues.

## High-level flow
1) Frontend calls `POST /program/v2/open/build` to build the open transaction.
2) User signs and sends the open transaction (payment + session creation + on-chain MOCHI reward mint).
3) Frontend calls `POST /program/v2/open/confirm` with the signature; backend mirrors on-chain session to DB (legacy off-chain reward hook also runs but is now redundant).
4) User reveals cards, then either:
   - Claim: `POST /program/v2/claim/build` → sign/send → `POST /program/v2/claim/confirm`
   - Sellback: `POST /program/v2/sellback/build` → sign/send → `POST /program/v2/sellback/confirm`
   - Expire: `POST /program/v2/expire/build` → sign/send → `POST /program/v2/expire/confirm`

## On-chain program (Anchor: `anchor-program/programs/mochi_v2_vault/src/lib.rs`)
- `open_pack` (v2):
  - Checks payment (SOL or USDC).
  - Reserves rare CardRecords (remaining accounts).
  - Writes PackSessionV2.
  - Mints MOCHI reward via CPI `token::mint_to` to user’s MOCHI ATA if `VaultState.reward_per_pack > 0` and `mochi_mint` is set. Uses vault authority PDA as mint signer.
- `claim_pack_v2`: Transfers rare+ assets (Metaplex Core) to user, marks CardRecord `UserOwned`, session `Accepted`.
- `sellback_pack_v2`: Refunds buyback %, frees CardRecords, marks session `Rejected`.
- `expire_session_v2`: Frees CardRecords after window, marks session `Expired`.
- Admin: `set_reward_config`, reset/force_close sessions, initialize vault, etc.

## Backend (FastAPI: `backend/main.py`)
- `/program/v2/open/build`: RNG + lineup, picks rare assets, constructs `open_pack_v2` ix including MOCHI mint/ATA accounts. Prepends MOCHI ATA creation if missing; adds compute budget ix.
- `/program/v2/open/confirm`: Waits for tx confirmation, mirrors session + CardRecords to DB. (Legacy off-chain reward hook still runs but on-chain reward is authoritative.)
- `/program/v2/claim/build` / `.../confirm`: Builds and finalizes claim; updates DB `MintRecord` to `user_owned`.
- Inventory sync: `/admin/inventory/refresh` pulls vault-owned assets via Helius and upserts into `MintRecord` as `available`.
- Admin reward config: `/admin/reward/config` calls on-chain `set_reward_config` to set `mochi_mint` and `reward_per_pack`.

## Frontend (Next.js: `frontend/app/gacha/page.tsx`)
- Uses `buildV0Tx` with instructions returned from backend.
- Open flow: `/program/v2/open/build` → sign/send → `/program/v2/open/confirm`.
- Claim/sellback/expire flows as above.
- Must pass user MOCHI ATA; backend will create it in the open tx if missing.

## Configuration (backend `.env` under `backend/`)
- `SOLANA_RPC`, `HELIUS_RPC_URL` (required for inventory refresh).
- `ADMIN_ADDRESS`, `ADMIN_KEYPAIR_PATH` (must match; used for admin endpoints and legacy reward hook).
- `MOCHI_TOKEN_MINT`, `MOCHI_TOKEN_DECIMALS`, `MOCHI_PACK_REWARD` (legacy).
- `USDC_MINT`, `PLATFORM_WALLET`, `TREASURY_WALLET`.
- `DATABASE_URL` (SQLite by default).

## On-chain reward setup
1) Ensure MOCHI mint authority is the vault authority PDA.
2) Set reward config on-chain:
   ```
   POST /admin/reward/config
   {
     "mochi_mint": "<MOCHI_MINT>",
     "reward_per_pack": 100  // whole tokens; raw_amount (smallest units) also supported
   }
   ```
3) Open tx will mint `reward_per_pack` in the same transaction to user’s MOCHI ATA.

## Inventory
- On-chain PDAs: CardRecord per core asset (`["card_record", vault_state, core_asset]`), must exist and be `Available` for rare slots.
- Backend mirrors: `MintRecord` (status: available/reserved/user_owned), `CardTemplate` (rarity lookup).
- Sync from chain: set `HELIUS_RPC_URL` and run:
  - `POST /admin/inventory/refresh`, or
  - `source .venv/bin/activate && HELIUS_RPC_URL=... python3 scripts/refresh_inventory.py`
- Templates: ensure `CardTemplate` has entries for the template_ids you expect. If URI parsing fails, rarity defaults to `unknown` in the DB; update templates to correct rarities.

## Troubleshooting
- Low stock / open fails: run inventory sync; check `GET /admin/inventory/rarity`. If still low, deposit/mint more CardRecords on-chain and rerun sync; ensure templates exist.
- Reward missing: verify MOCHI mint authority = vault authority PDA; `VaultState.mochi_mint` and `reward_per_pack` are set (use `/admin/reward/config`); open tx logs should show `mint_to` success.
- Claim not transferring: check claim tx logs for Metaplex Core `Transfer`; inspect CardRecord status/owner on-chain; ensure rare assets passed in remaining accounts.
- Session stuck: admin endpoints for reset/force_close; legacy `/admin/reward/retry` for off-chain reward replay.
- Helius issues: ensure `HELIUS_RPC_URL` set; rerun refresh; verify vault PDA actually owns the assets.
