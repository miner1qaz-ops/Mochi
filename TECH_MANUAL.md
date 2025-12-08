# TECH_MANUAL

## Frontend Architecture
- Stack: Next.js 14 App Router + TypeScript, TailwindCSS (custom palette), Framer Motion, Solana wallet adapter, Phaser mini-games under `frontend/stadium/`.
- Route highlights: `/` hero + style guide; `/gacha` pack flow with provably-fair panel, buy/claim/sell/expire controls, active session hydrate/resume; `/market` grid + `/market/card/[id]` detail (listings + pricing); `/profile/[address]` NFTs + virtual inventory + recycle UI; `/admin` inventory/sessions/rescue actions (wallet gate temporarily disabled); `/stadium/*` mini-games; `/pricing` redirects to `/market`.
- Tx helper: `frontend/lib/tx.ts` builds v0 transactions from backend instruction metadata + `recent_blockhash`; all wallet actions (gacha, marketplace, seed sale) should reuse it.
- Env wiring: requires `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_VAULT_AUTHORITY`, `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_BACKEND_URL` (or proxy), `NEXT_PUBLIC_MOCHI_TOKEN_MINT`, seed sale IDs (`NEXT_PUBLIC_SEED_SALE_PROGRAM_ID`, `NEXT_PUBLIC_SEED_VAULT_TOKEN_ACCOUNT`).
- UI rules (gacha): two reveal modes (grid + 1-card modal). First click/swipe flips, next advances; last closes. Keep both modes and touch/desktop parity. Error/status copy near buy controls; countdown shows active session with expire button at zero.

## Backend Architecture
- Framework: FastAPI (`backend/main.py`) with SQLModel/SQLite. Solana RPC via `solders` + `solana`; tx encoding via Borsh (`tx_builder.py`).
- Core models/tables: `CardTemplate`, `MintRecord`, `SessionMirror`, `VirtualCard`, `RecycleLog`, `PackRewardLog`, `PriceSnapshot`.
- Key endpoints (V2 only unless noted):
  - Packs: `/program/v2/open/build`, `/program/v2/open/confirm`, `/program/v2/session/pending`, `/program/v2/claim/build`, `/program/v2/claim/confirm`, `/program/v2/sellback/build|confirm`, `/program/v2/expire/build|confirm`, `/program/v2/claim/cleanup`.
  - Rewards/admin: `/admin/reward/config`, `/admin/reward/retry`.
  - Marketplace: `/marketplace/list/build`, `/marketplace/fill/build`, `/marketplace/cancel/build`, `/marketplace/listings`, `/admin/marketplace/force_cancel`, `/admin/marketplace/garbage`.
  - Inventory/admin: `/admin/inventory/refresh`, `/admin/inventory/rarity|assets|reserved`, `/admin/inventory/unreserve`, `/admin/sessions`, `/admin/sessions/force_expire|force_close`, `/admin/sessions/diagnostic`, `/admin/session/settle`.
  - Pricing/market: `/market/cards`, `/market/card/{template_id}`, `/pricing/stats|portfolio|card/{id}|history|sparklines|sets|set|search`, `/pricing/rarity`.
  - Seed sale: `/seed_sale/state`, `/seed_sale/contribute/build`, `/seed_sale/claim/build`.
  - Profile/virtual: `/profile/{wallet}`, `/profile/{wallet}/virtual`, recycle `/profile/recycle/build|confirm|submit`.
- Services: uses Helius DAS for inventory refresh; `maybe_spawn_pack_reward` transfers pack rewards from admin treasury ATA; recycle uses treasury SPL transfer; provably-fair RNG via `SERVER_SEED`.
- Configuration: env values in `Settings` (`backend/main.py`); tx builder loads `PROGRAM_ID`/`SEED_SALE_PROGRAM_ID` from env and derives PDAs for vault/marketplace.
- Metadata/Images:
  - CRITICAL: All metadata must be served from `https://getmochi.fun` (set via env; do not use legacy domains).
  - Profile must fall back to local pack art if metadata URLs fail.

## Solana Program (Anchor: `mochi_v2_vault`)
- Program ID: `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`.
- PDAs: `vault_state` / `vault_authority`; `market_vault_state` / `market_vault_authority`; `card_record` (vault_state + core_asset); `listing` (market_vault_state + core_asset); `pack_session` (v1) and `pack_session_v2` (v2).
- Core instructions: `open_pack` (v2, rare+ reservations), `claim_pack_v2`, `sellback_pack_v2`, `expire_session_v2`, `admin_force_close_v2`; admin `force_expire`, `force_close_session`, `set_reward_config`; marketplace `list_card`, `cancel_listing`, `fill_listing`; batch claims (`claim_pack_batch`, `claim_pack_batch3`), `finalize_claim`; legacy `open_pack_start`/`claim_pack` still exist but deprecated.
- Custody expectations: open_pack_v2 remaining accounts = rare CardRecords; claim/sellback/expire use rare CardRecords + Core asset accounts; marketplace instructions include MPL Core program and derive listing PDAs off `market_vault_state`.
- Known gaps: mainnet allowlist/collection checks not enforced; Metaplex Core burn/redeem still TODO in program.

## Workflows
### Pack Opening (V2, treasury reward)
1) Frontend `/program/v2/open/build` with `pack_type`, `client_seed`, `currency`, optional token ATAs. Backend validates vault authority, checks no pending session, picks rarities/templates (slot odds), selects rare assets, derives PDAs, ensures user MOCHI ATA exists, prepends compute budget ix, returns instructions/message + provably-fair payload and `session_id`.
2) Wallet signs/sends open tx. Frontend polls `/program/v2/open/confirm` with signature; backend waits for confirmation, mirrors on-chain session, reserves rare assets in DB, adds low-tier `VirtualCard` rows, triggers `maybe_spawn_pack_reward` (treasury transfer of `MOCHI_PACK_REWARD` from admin ATA to user ATA; auto-creates ATA if needed), logs PackRewardLog.
3) Reveal: UI uses returned rarities/templates; virtual slots flagged vs NFT slots.
4) Claim: `/program/v2/claim/build` returns claim ix over rare CardRecords/Core assets + compute budget; wallet signs/sends; `/program/v2/claim/confirm` verifies state=accepted, updates `MintRecord` owners, removes virtual cards.
5) Sellback: `/program/v2/sellback/build` → sign/send → `/program/v2/sellback/confirm`; frees CardRecords, removes virtual cards, session state `rejected`.
6) Expire: after window, `/program/v2/expire/build` → sign/send → `/program/v2/expire/confirm`; frees assets and removes virtual cards. Admin fallbacks: `force_expire`/`force_close`.
7) Resume: `/program/v2/session/pending` rehydrates from on-chain session + mirrors (404 if none), used on page load to avoid lost sessions.

### Recycle (treasury SPL transfer)
1) Frontend shows `VirtualCard` holdings from `/profile/{wallet}/virtual`.
2) User selects items; call `/profile/recycle/build` with wallet, items, and user ATA. Backend validates counts, checks admin treasury balance, optionally inserts create-ATA ix, builds SPL transfer from admin ATA to user ATA; returns unsigned v0 message + instruction metadata.
3) Wallet signs/sends; `/profile/recycle/confirm` verifies signature, deducts virtual counts, logs `RecycleLog`; `/profile/recycle/submit` accepts signed tx if needed. Reward amount = `count * 10^MOCHI_TOKEN_DECIMALS`.
4) Treasury funding is critical; if admin ATA < amount, backend returns an error and nothing is deducted.
