# DOC_DELETION_ARCHIVE
Collected full contents of deprecated docs prior to deletion.

## agent.md (agent.md)
```markdown
# Agent Notes
- V1 is deprecated. All features now use V2 via Treasury Transfer.
- Mochi V2 mint: `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv` (decimals=6). Rewards/recycle draw from the admin treasury ATA `831fnahUncbMNznw79BtqAbsKGvvDZ2HefEhmQrv8CqW` (seeded 10M).
- Distribution breakdown and funding signatures: see `docs/MIGRATION_V2.md` and `scripts/deploy_mochi_v2_distribution.latest.json`.
```

## gacha.md (docs/gacha.md)
```markdown
# Mochi Gacha: Multi-pack Guide

## Register a pack
- Add an entry to `PACK_REGISTRY` in `backend/main.py` with `id`, `name`, `csv_path`, `pack_image`, `set_code`, and `template_offset` (use offsets to avoid template_id collisions across sets). `set_code` should match the `pack_id` you pass through the UI/API and what you stamp onto `CardTemplate.set_code`.
- Expose the pack in the UI selector (`frontend/app/gacha/page.tsx`) by adding to `packOptions` and updating `PACK_TEMPLATE_OFFSETS` (keep the same offset used in the backend).
- Store pack art in `frontend/public/img/` (e.g., `/img/ptcg-pfl-bp.png`) and the CSV in `frontend/public/data/<pack_id>.csv`. Card art can live under `frontend/public/img/<pack_id>/`.

## CSV format
- Columns consumed: `template_id` (or `serial_number`/`Number`), `name`, `rarity`, and optional `variant`/`holo_type`, `image_url`.
- Every row (Name + PrintType) is treated as a unique template. If `template_id` is missing, the ingestion script derives one from `template_offset + row_index` (for Phantasmal Flames this is offset `2000`).

## Supply ingestion
- Run `python scripts/mint_core_from_csv.py <path/to/csv> <pack_id>` to create/refresh `CardTemplate` rows and mint `MintRecord` placeholders.
- Supply rules (Phantasmal Flames):
  - `Common` / `Uncommon`: **virtual only** (no MintRecords created).
  - `Rare`, `Double Rare`, `Ultra Rare`, `Illustration Rare`, `Promo`: **6** MintRecords each.
  - `Special Illustration Rare`, `Mega Hyper Rare`: **1** MintRecord each.
- The script skips creating extra records when the cap is already met.

## Frontend behavior
- Pack selector passes `pack_type` into all pack calls (`preview`, `build`, inventory fetches). Stock widgets use `/admin/inventory/rarity?pack_type=...` and `/admin/inventory/pack_stock?pack_type=...` and only show the selected pack.
- Template art is loaded from CSVs per-pack. For Phantasmal Flames, images are mapped to `/img/phantasmal_flames/<serial>-<slug>.jpg`.
- MOCHI rewards remain universal; no additional work is required per pack once the registry entry exists.
```

## UX_CHANGES.md (docs/UX_CHANGES.md)
```markdown
# UX Change Log

## 2025-11-26T04:46:00Z – Codex
- Homepage hero rebuilt to match Rip1/Rip2 inspiration: centered glass desk with fanned `meg_web` card backs, hover tilt/lift, neon glow, and responsive rail on mobile. CTA buttons now glow/bloom with glass outlines for secondary actions.
- Added reusable styles in `frontend/app/globals.css`: `cta-primary`/`cta-ghost` (with `data-tone` accents), `glass-surface`, `glass-chip`, and `hero-card` hover variables (`--rz`, `--tx-base`, `--ty-base`, `--rx`, `--ry`, `--tx`, `--ty`, `--lift`, `data-glow`).
- Homepage includes an embedded style guide section listing hover/glow classes and props for cards and CTAs.
- Placeholder art stays pointed at `public/card_back.png` (meg_web backs) until final art is ready; text callout added in hero to note this.

## 2025-11-26T05:10:00Z – Codex
- Trimmed hero copy badges and bottom pills (“Collect/Rip/Redeem/Repeat”) for a cleaner hero; removed placeholder caption under the card fan to keep focus on the deck.
```

## FRONTEND_GACHA_GUIDE.md (docs/FRONTEND_GACHA_GUIDE.md)
```markdown
# Mochi Gacha Frontend – Agent / Team Guide

## 1) Purpose & Scope
This defines how the “Gacha / Pack Opening” UI should behave and how code should be maintained. It is for developers, AI agents, and reviewers working on:
- Pack purchase / build / preview / open.
- Two reveal modes: grid (fast) and 1-card modal (swipe/tap).
- Frontend logic; avoid touching backend/RNG unless explicitly requested.

## 2) Reveal UX Specification
### Reveal Modes
- **Grid (fast)** (default after purchase/preview or when user selects fast mode): all cards in a grid. Click any card to flip back → front independently. No order, no swipe.
- **1-card (modal)** (user selects “1-card mode (swipe/tap)”; modal opens after pack build/test):
  - One card at a time, starts face-down (card back).
  - First swipe or click: flip current card back → front (no advance).
  - Second swipe/click (or subsequent) when current card is revealed: advance to next card (starts face-down).
  - Last card swipe/click closes modal.
  - Swipe/drag must work on touch; click must behave the same for desktop.

### Grid Mode Rules
- Clicking any card flips that card; independent order.

## 3) Code Conventions (React/TSX)
- Functional components + hooks; no classes.
- Separate UI/presentation from logic/API where practical.
- Keep API/tx/RNG logic untouched unless explicitly requested.
- Maintain readability; immutable state updates; no hooks in loops/conditions.
- Document any UI-behaviour change (comment or markdown) when altering reveal logic.

## 4) Agent Prompt Template (for Codex/LLM)
When editing the gacha UI, instruct the agent:
- Two reveal modes; do not remove either.
- 1-card modal interactions:
  - First drag/click flips current card; next drag/click advances; last closes.
  - Swipe/drag must remain; click treated like swipe.
- Do not change backend API/tx/RNG unless asked.
- Keep components functional, organized, and readable.
- Return minimal diffs; if adding behaviour, explain briefly.

## 5) Process
- For notable UI changes, add a short design/behaviour note (in PR or docs).
- Prefer a living style guide (Storybook or similar) if the surface grows.
```

## AGENT_UPDATE_LOG.md (docs/AGENT_UPDATE_LOG.md)
```markdown
## 2024-11-20 – Codex
- Created Mochi v2 repository scaffold with anchor program, backend FastAPI service, Next.js frontend, and helper scripts.
- Generated new keypairs (`anchor-program/keys/passkey.json` for authority, `program-id.json` for program ID) and set devnet program id.
- Implemented Anchor PDAs/instructions (vault, card records, pack sessions, listings) and authored IDL.
- Built backend endpoints for pack preview/build, claim/sellback, marketplace, profile, and admin inventory; added provably-fair RNG with legacy odds.
- Scaffolded frontend routes (home, gacha, marketplace, profile, admin) with wallet adapter + Tailwind/Framer styling.
- Added docs covering system overview, anchor, backend, frontend, and scripts; provided env examples.

Next steps:
- Wire real Metaplex Core CPI transfers + SPL token path in the program; add tests.
- Replace placeholder tx builders with anchorpy signing + Helius asset selection.
- Connect frontend actions to real transactions and render metadata/images from templates.
- Add VRF fallback and redemption (burn + shipment) flow.

## 2024-11-21 – Codex
- Added backend `tx_builder` (borsh-based) to emit real instruction payloads and v0 message base64 for pack/claim/sellback/list/fill/cancel flows; integrated CardRecord PDAs and treasury env.
- Backend now reserves MintRecords during pack build, stores asset_ids in SessionMirror, and updates statuses on claim/sellback/list/fill/cancel.
- Extended response schemas to return instruction metadata; added `TREASURY_WALLET` env sample and rarity lamport values for payout math.
- Frontend API types updated to include instruction metadata in responses.

Next steps:
- Fetch seller from on-chain Listing account instead of DB placeholder during fill_listing builds.
- Add validation that CardRecord PDAs exist on-chain and wire USDC token accounts in builders.
- Bubble instruction/message building into a signed transaction flow (fetch blockhash + partial signatures).

## 2024-11-22 – Codex
- Upgraded provably-fair RNG to deterministic nonce: `server_nonce = sha256(server_seed_hash:client_seed)[:16]`, entropy = `sha256(server_seed:client_seed:server_nonce)`; preview/build return `server_seed_hash`, `server_nonce`, `entropy_proof`.
- SessionMirror stores seed hash/nonce; backend preview/build aligned; frontend gacha displays proof payload.
- Docs updated for new RNG flow; env unchanged.

## 2025-11-25 – Codex
- Added MCP time server setup notes (`docs/mcp_time.md`) and standardized ISO-8601 timestamp guidance (latest timestamp from system clock: 2025-11-25T00:14:10+00:00).
- Enhanced gacha page with a provably-fair dashboard showing server_seed_hash, server_nonce, client_seed, and entropy_proof plus verification steps.
- Kept doc timestamps consistent; pending: wire time MCP tool once pip/uv is available on host.
- Backend tx builders now include `recent_blockhash` in responses for pack/claim/sellback/list/fill/cancel to ease client-side transaction assembly.
- Added frontend tx helper `lib/tx.ts` and wired gacha claim/sellback buttons to build v0 transactions using backend instructions + blockhash for wallet signing.
- Pack purchase flow now also signs/sends using the same tx helper with returned instructions + blockhash.
- Marketplace page now lists assets with a basic form (asset + price) and wires buy/cancel/list actions to backend builders + wallet signing via `lib/tx.ts`.
- Removed failing monarx apt repo, installed python3-pip and python3.13-venv, created venv `~/.venvs/mcp-time`, and installed `mcp-server-time` inside it; updated docs with venv install/run steps.
- Backend now checks CardRecord PDA existence before pack/list/fill/claim/sellback and reads seller from on-chain Listing PDA when available; solana client added via venv for RPC validation.
- Added token-path request fields (user/vault token accounts, currency_mint/USDC_MINT), return unsigned v0 tx (`tx_v0_b64`), and a rarity pricing endpoint; docs updated. Frontend types accept the new fields (not yet wired in UI).
- Generated unified devnet authority/treasury key `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs` (secret at `anchor-program/keys/dev-authority.json`) and dev USDC mint `GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu` (secret at `anchor-program/keys/dev-usdc-mint.json`); env samples updated.
- Added placeholder Core CPI guard (`CoreCpiNotImplemented`) to signal custody paths still need wiring.
- Cleaned Anchor program custody helpers to a single set of TransferV1/BurnV1 invoke_signed; updated contexts to include mpl_core_program and core_asset where needed; pack flows now expect remaining accounts as 11 CardRecords + 11 Core assets. IDL regenerated accordingly. Anchor CLI not available here; build not run.

## 2025-11-25T09:26:00Z – Codex
- System clock currently reports 2025-11-25T09:26:09+00:00 (SGT = 2025-11-25T17:26:09+08:00). Agent log timestamps now use this clock.
- Anchor program build and IDL generation succeed (`target/idl/mochi_v2_vault.json`, `target/deploy/mochi_v2_vault.so`).
- Deployment to devnet still blocked by DNS/egress; `/etc` is read-only so resolver cannot be updated from inside this environment. Need host-level DNS fix to reach `api.devnet.solana.com`/Helius before `anchor deploy`.
- No code changes since last build; artifacts remain ready. Next step once DNS works: `PATH="$HOME/.local/share/agave/install/active_release/bin:$HOME/.cargo/bin:$PATH" anchor deploy`.

## 2025-11-25T10:03:46Z – Codex
- DNS/egress restored; ran `anchor deploy` to devnet successfully.
- New devnet program id: `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx` (updated in `anchor-program/Anchor.toml`).
- Deployment signature: `32T4fmbZx97MSQfkcDH8D2ekWvivHnRYw6FcUBfxXqEsAQXKogqwj2yowK9KrVf78azX9BsYK2HjqojxrUn2re4A`.
- No code changes; artifacts remain in `anchor-program/target/deploy` and IDL in `anchor-program/target/idl/mochi_v2_vault.json`.

## 2025-11-25T10:11:17Z – Codex
- Propagated new program id `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx` across backend (`backend/tx_builder.py`), scripts (`scripts/deposit_core_assets.py`), frontend gacha page, and Anchor `declare_id!`.
- Regenerated Anchor build and IDL so `target/idl/mochi_v2_vault.json` and `target/types/mochi_v2_vault.ts` now carry the new address.
- Updated docs references: `docs/commands_devnet_setup.md`, `docs/AGENT_GUIDE.md`, `docs/agent_anchor.md`.
- Added ready-to-run env files: `backend/.env` and `frontend/.env.local` with devnet RPC, unified admin/treasury key `CKjhhqf…`, USDC mint, and program id.

## 2025-11-25T12:10:27Z – Codex
- Backend deps resolved: pinned `solders==0.18.1` (compatible with `solana==0.30.2`/`anchorpy==0.18.0`), pip install now succeeds in `.venv`.
- Frontend deps pinned to registry-available set: `@solana/wallet-adapter-react@0.15.39`, `react-ui@0.9.39`, `wallets@0.19.37`, `@solana/web3.js@1.98.0`; `npm install` now completes.

## 2025-11-25T15:03:33Z – Codex
- Nginx installed and configured `/etc/nginx/sites-available/mochi` to proxy `getmochi.fun`/`www` to frontend (127.0.0.1:3000) and `/api/` to backend (0.0.0.0:4000); config enabled and reloaded.
- Added systemd services:
  - `mochi-backend.service` (uvicorn on 0.0.0.0:4000, uses `backend/.env`).
  - `mochi-frontend.service` (Next.js start on 127.0.0.1:3000, uses `frontend/.env.local`).
  Both are enabled to start on boot; frontend binding conflicts resolved and service now active.
- Frontend manual process replaced by systemd-managed instance; backend previously running manually now managed by systemd.

## 2025-11-25T15:08:00Z – Codex
- Home page refreshed with richer hero, stats, callouts, and live feed styling to reduce “blank” feel.
- Gacha page UI improved: session/price panels, clearer timer/session display, and status message polish.

## 2025-11-25T16:00:04Z – Codex
- Frontend UX pass: header logo placement, simplified RWA flow copy, card fan hero grid, featured marketplace panel with filters/badges, admin summary cards, and gacha demo button labeled as no-deduction.
- Gacha test mode now includes pack animation (swing/tear/reveal), template-aware card placeholders, and demo-only “Test Pack” flow.
- Assets wired from `public/data/meg_web_expanded.csv` with fallback art; placeholders remain until real images are ready.
- Rebuilt and restarted frontend service (systemd) to deploy changes.

## 2025-11-25T16:05:00Z – Codex
- Added scaffold script `scripts/mint_and_deposit.ts` to mint Metaplex Core assets to the vault_authority PDA and call `deposit_card` for CardRecords (reads `public/data/meg_web_expanded.csv`). Uses dev authority key and MPL Core CPI; install deps before running.
## 2025-01-30 – Codex
- Fixed Anchor program compilation errors (lifetimes, account contexts, system_program types) and added required `idl-build` feature to `programs/mochi_v2_vault/Cargo.toml`; `anchor build` now succeeds.
- `anchor idl build` still blocked by DNS failures fetching nightly toolchain (GitHub/rust-lang unreachable); SBF binary built successfully. Pending: rerun `anchor idl build --program-name mochi_v2_vault` once DNS is available to emit `target/idl/mochi_v2_vault.json`.

## 2025-01-31 – Codex
- Patched local `anchor-syn` (under `patches/anchor-syn`) to avoid `Span::source_file()` and use `CARGO_MANIFEST_DIR`, and pinned `proc-macro2 = 1.0.86` with `span-locations`; idl-build now works.
- Ran `anchor build` and `anchor idl build --program-name mochi_v2_vault` successfully; artifacts: `target/deploy/mochi_v2_vault.so`, `mochi_v2_vault-keypair.json`, `target/idl/mochi_v2_vault.json`.

## 2025-11-25 – Codex
- Nginx HTTPS enabled via Certbot (`certbot --nginx -d getmochi.fun -d www.getmochi.fun`); HTTP now redirects to HTTPS. Cert/key at `/etc/letsencrypt/live/getmochi.fun/`; auto-renew via systemd timer.
- Git repo initialized in `~/mochi`; branch renamed to `main`; remote set to `git@github.com:miner1qaz-ops/Mochi.git`.
- `.gitignore` expanded to exclude env files, build artifacts, Python venvs, `.anchor/`, `target/`, and `anchor-program/keys/` (key JSONs left untracked). Two commits: `Initial commit`, `Add key directory to gitignore`.
- Git identity set locally to `user.name=miner1qaz`, `user.email=miner1qaz@gmail.com`.
- GitHub SSH key to authorize (public): `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEu4UWIk36y7OeNFcen61lb8+KiRQFEbvyCBv+AyqtV3 miner1qaz@gmail.com`. Add in GitHub Settings → SSH keys, then push with:
  ```
  cd ~/mochi
  ssh -T git@github.com          # should succeed after key is added
  git push -u origin main
  ```
- Current services: Next prod server on 127.0.0.1:3000, FastAPI on 0.0.0.0:4000, nginx proxying `/` → 3000 and `/api/` → 4000.

## 2025-11-26T04:46:00Z – Codex
- Homepage hero rebuilt with a glass desk + fanned meg_web card backs, hover tilt/rotation with pointer tracking, and mobile rail layout; CTA buttons now glow with neon bloom and glass outlines.
- Added reusable styles in `frontend/app/globals.css` (`cta-primary`, `cta-ghost`, `glass-surface`, `glass-chip`, `hero-card` hover variables) plus an on-page style guide listing classes/props for card hover and CTA glow.
- Logged UX changes in `docs/UX_CHANGES.md`; hero note clarifies placeholder art stays on `public/card_back.png` until final assets are ready.

## 2025-11-26T13:33:13+08:00 – Codex
- Fixed the mint/deposit toolchain: corrected Anchor client init, pinned IDL usage, and switched Core minting to Umi `createV1` (proper signer wiring).
- Ran `scripts/mint_and_deposit.ts` against devnet (program `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`), seeding 5 Core assets to `vault_authority` PDA `FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g` with CardRecords.
- Minted asset IDs: `9stz7SjNZ9x3cbAnzxXiQU6Lm2Sy9pLn2o23N5LKDDH`, `3Z34WbismuWCT62gfSMk2HxtQXdmUnXMBNVAeHtZbB7d`, `CoKncBYTBAviBEQH6BwbMUqM7pPzaQYL5mt2d9kYds5m`, `EcBW3xZP3wQDeS7ALxneQ1GKgivF7fBcx2gfPCSZnduE`, `2jkQE5pCFEGVvs8q6yrzz5sT8KszJpwKGMYuLkTFtrbB` (metadata hosted at `https://getmochi.fun/assets/meg_web/<id>.json`).
- Script now reads templates from `frontend/public/data/meg_web_expanded.csv`; rerun with `TS_NODE_TRANSPILE_ONLY=1 npx ts-node -P tsconfig.scripts.json scripts/mint_and_deposit.ts` (env: `SOLANA_RPC`, optional `USDC_MINT`).

## 2025-11-26T18:42:17Z – Codex
- Removed the frontend wallet gate on `/admin`; dashboard now loads for everyone while we’re on devnet. We’ll restore the `ADMIN_ADDRESS` check before mainnet migration.
- Admin panel still fetches live data via `/admin/inventory/rarity`, `/admin/sessions`, `/admin/inventory/assets`, and the Helius refresh endpoint, so team members can monitor inventory without connecting a wallet.

## 2025-11-26T19:45:00Z – Codex
- Added standalone `~/nft_pipeline` toolkit for NFT asset automation: fetch cards from a TCG API (`scripts/fetch_tcg.ts`), generate PNG/JSON pairs per `COLLECTION_SLUG`, upload to local or S3 hosting, emit a manifest enriched with `image_url` + `source_id`, and mint/update on-chain via Metaplex scripts.
- Metadata/images now live under `nft/{img|metadata}/{collection_slug}/{token_id}` so multiple drops can share the same repo.
- Upload script produces manifest entries (array of objects) and Solana scripts consume that manifest; README documents the full flow (fetch → generate → upload → update/mint) plus env variables for TCG + hosting.

## 2025-11-27T07:11:49+08:00 – Codex
- Served the new asset pipeline by adding an nginx alias for `/nft/` → `/var/www/mochi-assets/nft`; `https://getmochi.fun/nft/img|metadata/...` now resolves for wallets/explorers (Solscan caches will refresh automatically).
- Updated `scripts/mint_and_deposit.ts` to read the nft_pipeline CSV (`CORE_TEMPLATE_CSV`), point to the hosted metadata base, and support `CORE_TEMPLATE_OFFSET` / `CORE_TEMPLATE_LIMIT` batching. Ran it across devnet (in chunks) to mint & deposit the full Mega Evolution set (188 distinct templates, 196 Core assets because six templates have intentional doubles) into the vault PDA `FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g`.
- Imported the Mega Evolution CSV into `backend/mochi.db` via `scripts/import_card_templates.py` (now detects `token_id` columns and respects `DATABASE_URL`) so the admin UI can enrich cards with name/rarity.
- Refreshed backend inventory: `/admin/inventory/refresh` now paginates Helius `getAssetsByOwner`, infers template_id from the metadata URI, and stamps rarity/owner on MintRecords. Clearing/reloading MintRecords yields the current 196 Core assets (8 duplicates across templates 1/2/3/41/77/152).
- Docs updated (`agent_backend`, `agent_anchor`, `agent_frontend`, `AGENT_GUIDE`) to reflect the new nft_pipeline flow, nginx hosting path, mint/deposit script, and admin refresh behavior.

## 2025-11-27T08:06:00+08:00 – Codex
- Reran the full mint/deposit pipeline to seed a second copy of the entire Mega Evolution roster (4 × `CORE_TEMPLATE_OFFSET` batches covering 0–188). Result: vault PDA now holds **400** Pokémon cards (196 unique template IDs × 2 copies, including the earlier duplicates).
- Minted an additional Energy set (templates 189–196) so there are two of each basic Energy; metadata continues to live under `https://getmochi.fun/nft/metadata/mega-evolutions/189-196.json`.
- Refreshed backend inventory (`curl -X POST http://127.0.0.1:4000/admin/inventory/refresh`), which now reports `{"Energy":8}` per set and **400 total MintRecords** (`curl /admin/inventory/assets | jq 'length'`).
- Helius DAS verifies the holdings: `getAssetsByOwner(FKALjGX...)` now returns 400 items.

## 2025-11-27T08:12:00+08:00 – Codex
- Fixed `tx_builder.encode_currency_tag` to return the Enum variant object (`CurrencyLayout.enum.Sol()` / `.Token()`) instead of a dict. Construct was previously throwing `AttributeError: 'dict' object has no attribute 'index'` on `/program/open/build`.
- Restarted `mochi-backend.service`; gacha pack build now succeeds for both SOL and token modes.

## 2025-11-27T12:21:06+08:00 – Codex
- Gacha page now surfaces backend error payloads (e.g., “Active pack session already exists”) so users know why `/program/open/build` failed instead of a generic toast.
- Added wallet-status cues (“Awaiting wallet signature…”, “Submitting transaction…”) before/after `signTransaction`, plus consistent error parsing on claim/sellback actions.
- Documented the behavior in `docs/agent_frontend.md`.

## 2025-11-27T12:31:22+08:00 – Codex
- Added an inline Active Session panel + status ribbon near the buy controls on `/gacha` so users immediately see pending sessions/countdown and any backend error text (instead of having to scroll).
- Removed the duplicate status blurb near the card grid to keep messaging in one obvious location.
- Updated `docs/agent_frontend.md` to reflect the UI change.

## 2025-11-27T12:42:56+08:00 – Codex
- Added an on-chain `admin_force_expire` instruction, rebuilt the IDL, and redeployed `mochi_v2_vault` so the server admin can forcibly expire pack sessions without the original wallet.
- Backend now exposes `POST /admin/sessions/force_expire`, loads the admin keypair from `ADMIN_KEYPAIR_PATH`, sends the CPI, and resets MintRecords + SessionMirrors.
- Admin dashboard gained a “Force expire all” button hooked to that endpoint; success/error messages render inline above the sessions list.
- Updated docs to mention the new env var/endpoint and refreshed the frontend reference.

## 2025-02-XX – Codex
- Fixed `admin_prune_listing`: it now serializes the Listing once (no double discriminator) when force-cancelling malformed listings.
- Rebuilt and redeployed `mochi_v2_vault` to devnet (program `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`, deploy sig `2gasn8utmKUQVmzrFnpRc8iTtfARvK887dZHy465TgMLdZDSbqyyUZSzkKLfT2kHmSoCCaJDXHx5ynob2wKsbF2X`).
- Ran `admin_prune_listing` on 10 garbage listings in legacy vault `FgUMTovRTzDSnvKHPFe8AVy8ZfhXcj6B6iiiYvjrxQSP` (seller `3wYr8aMeN1EMU5pZUKc7iXXgjzs3rvr2eUnWoTA4QyKd`/`...ec6NCsNxkinb`), marking them `Cancelled` with zeroed seller/core so the UI stops showing them as Active.

## 2025-11-27T13:00:00+08:00 – Codex
- Added backend diagnostics endpoints (`GET /admin/sessions/diagnostic`, `GET /admin/inventory/reserved`) plus a repair endpoint `POST /admin/inventory/unreserve` that flips any non-available MintRecords back to the vault and marks pending/settled sessions as expired.
- Surfaced those diagnostics and a new “Unreserve all” button in the admin UI so you can inspect/clear stuck cards before retrying a pack buy.
- Restarted backend/frontends and updated docs accordingly.

## 2025-12-08 – Codex
- Executed Mochi V2 TGE via `scripts/deploy_mochi_v2_distribution.py` (summary in `scripts/deploy_mochi_v2_distribution.latest.json`). New mint `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv` (decimals=6); supply 1B distributed to allocation keys under `keys/allocation/` (team 300M, community 390M after ops, presale 100M, liquidity 100M, treasury reserve 100M). Admin treasury ATA `831fnahUncbMNznw79BtqAbsKGvvDZ2HefEhmQrv8CqW` funded with 10M for recycle/reward flows.
- Disabled on-chain pack rewards by setting `reward_per_pack = 0` via `set_reward_config` (sig `66vYeQwa8UKjHC7juUyqqBRviAUmvqt883QLvxX2KNqbt92igzT6p43RrgtiBTSFye5t4tX9tB56TUnmzeD3Kv79`); mochi_mint now points to the V2 mint.
- Backend `/program/v2/open/confirm` now treasury-transfers pack rewards from the admin wallet instead of minting via PDA; `MOCHI_PACK_REWARD` governs the whole-token amount (default 100). Reward flow reuses recycle-style SPL transfers and logs PackRewardLog entries.
- Env updates: backend `.env` and frontend `.env.local` switched to the V2 mint; profile page fallback mint updated. Added `agent.md` and `docs/MIGRATION_V2.md` to document V2 tokenomics and allocation transparency.

## 2025-11-27T13:55:00+08:00 – Codex
- Anchor pack instructions now slice `remaining_accounts` as `[11 CardRecords][11 Core assets][optional SPL token ATAs]`, so SOL purchases no longer provide dummy token accounts and sell-back only requires them when `currency == Token`.
- `backend/tx_builder.py` appends the MPL Core program, every core asset account, and optional SPL ATAs in that order for open/claim/sellback/admin-force instructions; claim/sellback builders now take both account vectors explicitly.
- `pick_template_ids` normalizes rarity strings (strip spaces/underscores + lowercase) so CSV entries like “Double rare” satisfy `DoubleRare` slot requests, fixing the “Missing asset for slot X” errors.
- Ran `anchor build && anchor deploy` (sig `5VxYb7KABreUGbZRyQNpw6gz49tDtcx7fs3MP17psYxXewcHyrFu5fMg1wnog3ausMYbLUZnsPhQmuYaX9S1sVWQ`) and regenerated `target/idl/mochi_v2_vault.json`.
- Restarted `mochi-backend.service` and confirmed `/program/open/build` for SOL now returns a tx + lineup (no more `AccountOwnedByWrongProgram`).

## 2025-11-27T14:25:00+08:00 – Codex
- Trimmed `open_pack_start` to accept only the 11 CardRecord PDAs (Core assets + SPL ATAs now live in the “extras” tail and are optional), while `claim_pack` / `sellback_pack` still enforce `[cards][assets]` so the Core CPI transfers have the accounts they need. Redeployed `mochi_v2_vault` again (sig `49p6UUntQVzYYAWfPmstTnKqetDXJoJgfSSpPiR8KXDy5XPZNs14LZwLAWoepaygyFLAm9gtzYkH9ZGENkrhdXfm`) and regenerated the IDL to capture the layout change.
- Updated `tx_builder.py` so SOL pack transactions now ship only 19 accounts (5 base + 11 CardRecords + programs) while claim/sell-back/admin-force still append the Core assets. Message size dropped to ~834 bytes, well below the 1232-byte raw limit that previously triggered `VersionedTransaction too large`.
- Restarted `mochi-backend.service` after the builder tweaks and reran the inventory repair endpoints (`/admin/inventory/refresh`, `/admin/inventory/unreserve`, `/admin/sessions/force_expire`) so pending sessions/cards were cleaned up before testing.

## 2025-11-27T18:05:00+08:00 – Codex
- Backend now blocks duplicate pack openings by checking the existing `pack_session` PDA before reserving cards and exposes `GET /program/session/pending` so the frontend can resume the card lineup/countdown via a simple wallet query.
- `/program/claim/build` already required the PDA; the new open guard plus resume endpoint mean cancelled Phantom approvals no longer yield confusing runtime errors. Docs updated accordingly.
- Gacha page now calls the resume endpoint on wallet connect, rehydrates slots/proof/countdown, and disables Buy/Claim/Sell buttons with loading states so users can’t spam-click into inconsistent states.
- Ran `npm run build` for the frontend, restarted `mochi-frontend.service`, and bounced `mochi-backend.service` to pick up the API changes.

## 2025-11-27T19:10:00+08:00 – Codex
- Added `GET /program/session/pending` plus a devnet RPC guard in `/program/open/build` so wallets can resume pending sessions and can’t start overlapping packs; claim builds already enforce the pack_session PDA.
- Admin `/admin/sessions` endpoint now accepts `page`/`page_size` and returns `{items,total,page,page_size}` when paginating; the dashboard uses Prev/Next controls so long histories don’t flood the UI.
- `/gacha` gets a dedicated “Resume pending pack” button and disables Buy/Claim/Sell buttons while RPC/wallet calls are in flight to prevent spam clicks; when no session exists it surfaces a clear toast.
- Rebuilt the frontend (`npm run build`) and restarted both `mochi-frontend` and `mochi-backend` services to apply the changes.

## 2025-11-27T19:40:00+08:00 – Codex
- Fixed the stuck-session loop: if a wallet still has a `pack_session` PDA on chain but no SessionMirror row, the backend now reads the pack_session + card_record accounts directly (skipping Anchor discriminators), restores the mirror, and re-marks the MintRecords as reserved so claim/sell-back/resume all work again.
- `/program/session/pending` and `/program/open/build` both call this backfill helper, so hitting the Resume button (or simply retrying Claim/Sell-back) surfaces the active pack instead of blocking with “wallet already has a session”.
- Verified the hot wallet `63KMUfAuxy…` now returns session `3sxb…` from `/program/session/pending`; admin pagination also shows the pending row so ops can force-expire if needed.

## 2025-12-06 – Codex
- Anchor program (`mochi_v2_vault`) updated: `open_pack_v2` now enforces that the MOCHI mint authority equals the vault authority PDA and always mints rewards on-chain when `reward_per_pack > 0`; added explicit `require_keys_eq!` checks for mint/ATA ownership and extra `msg!` logs around reward config and `mint_to`. Added `RewardMinted` event emission for monitoring.
- Redeployed `mochi_v2_vault` to devnet (program unchanged: `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`) with the logging changes to surface reward minting in tx logs.
- Reset on-chain reward config via `set_reward_config` so the vault PDA is the mint authority and rewards are active: `mochi_mint = 2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT`, `reward_per_pack = 100_000_000` (100 MOCHI @ 6 decimals). Tx sig: `Zd9K9Cea5z22cUMwJbgp9EfSEU3V3VK7XvQ7oTovrN85nPTgeXF9Yimm2k7KaUnEZghNVzn8XjAzzaUL2bQQU6B`.
- Verified backend open builder already includes the user MOCHI ATA (auto-creates if missing); reward mint now lands in the same open transaction. If rewards stop, re-run `set_reward_config` or reassign mint authority to the vault PDA.

## 2025-12-07 – Codex
- Fixed marketplace listing failures (`AccountDidNotDeserialize` on `vault_state`) after the VaultState struct grew. Added a one-time admin instruction `migrate_marketplace_vault` to resize and rewrite the marketplace vault PDA to the current layout (includes reward fields).
- Built and redeployed `mochi_v2_vault` to devnet (program unchanged: `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`).
- Ran the migration on devnet for the marketplace vault PDA (`mx1PX4zganVFtuneoc61jcuadctsUPk9UGbyhNnnLwT`, auth `CGhdCwqZx7zn6YNqASY6V4uxFZpegb1QDu5qnMNDKihd`), tx `2j3ypYWtFAA3xRUbGHJU9i5zXrT23LdKK65myrUoRvmvgwx4FkgtdzxYQk9hkpgjEqEaHxZPXEHihbNz7QMZCub7`. It now deserializes at 215 bytes with `marketplace_fee_bps=200`.
- Listing flow works again; if deploying elsewhere, run `migrate_marketplace_vault` once on that cluster to upgrade the marketplace vault PDA.

## 2025-12-05T10:15:00Z – Codex
- Simplified marketplace `list_card`: `card_record` and `listing` PDAs are now `init_if_needed` (no PDA signatures), with canonical vault enforcement baked in. This removes the `AccountDidNotSerialize (0xbbc)` failures seen on listing.
- Regenerated IDL (`anchor-program/idl/mochi_v2_vault.json`) and redeployed `mochi_v2_vault` to devnet (sig `46KoTXDZ9aNkEPvkJZA1TQXqRCvzo6WSZ5Gdogc7xaxHxsxVM61uq5mqxhrqrhbwxdFZDPfXjErkgtyLLDQnA4aB`).
- Updated `scripts/test_listing_flow.ts` (card_record/listing no longer signers) and confirmed end-to-end on devnet: minted Core asset `FK5X2C7G21Lqzyj1NQUR49Kt6kuMw3vq3bsYbVCM1m3d`, listed successfully (tx `2aBViFHyUmLALdGT6mXavZEkQavDQZxMYhMNHruLoK9WSQJDeuSfvundGiYkiZUV1Memvttys7R6Bfi2nxdqwEXw`).

## 2025-11-27T20:05:00+08:00 – Codex
- Added `/program/expire/build` so wallets can sign an `expire_session` instruction the moment the 1h window lapses; the frontend now shows an **Expire session** button next to Claim/Sell when the countdown hits zero.
- Fixed both the user and admin force-expire flows by marking `vault_authority` writable in the CPI builders, and updated the resume/backfill logic so pending sessions with missing DB rows are re-created automatically.
- Rebuilt the frontend and restarted both services after the changes.

## 2025-12-05T07:24:00Z – Codex
- Split vault domains on-chain: gacha stays on `[b"vault_state"/"vault_authority"]`; marketplace now uses `[b"market_vault_state"/"market_vault_authority"]`. Listings derive off the marketplace seeds; CardRecords derive off their owning vault_state.
- Added admin guardrails: `emergency_return_asset` (returns escrowed Core asset to `listing.seller`, destination locked) and `admin_rescue_legacy_listing` (pulls assets from legacy vault_state/authority back to seller). Added `initialize_marketplace_vault` for the canonical market vault.
- Regenerated IDL to include the new instructions/seeds; updated rescue script `scripts/rescue_legacy_listings.ts` (populate RESCUE_TARGETS, set MARKETPLACE_VAULT_STATE, RPC_URL, ADMIN_KEYPAIR).
- Docs refreshed (`docs/AGENT_GUIDE.md`) to reflect the two-vault architecture, on-chain-first marketplace, and new rescue/emergency flows.

## 2025-12-05 – Codex
- Pricing 2.0: reset `PriceSnapshot` (purged corrupted rows) and made it append-only with new fields `market_price` (recent sales) and `direct_low` plus an index on `(template_id, collected_at)` for high-frequency inserts.
- Backend fair-value engine now prioritizes `market_price → direct_low → mid`, computes `confidence_score` from spread/staleness, and exposes new endpoints `/pricing/stats?wallet=` (portfolio_total + 24h change) and `/pricing/sparklines` (30-point history with fair_value).
- `/pricing/card/{id}` and search/set endpoints return `fair_value`, `confidence_score`, and sparkline points; portfolio calculations now use fair_value + confidence.
- Frontend pricing page redesigned with investment dashboard, per-row sparklines (green/red trend), and “Live Market Card” hover showing fair value, last-updated badge, and volatility warning.
- Docs updated (Agent Guide) to reflect append-only import flow and new pricing API surface; `scripts/fetch_tcg_prices.py` writes the new fields without deletes.

## 2025-12-05 – Codex (Market fusion)
- Fused Marketplace + Pricing into a single Market flow: nav now Home | Gacha | Market | Stadium | Profile | Admin; `/pricing` redirects to `/market`.
- Backend: new `/market/cards` (search/filter/sort; returns card metadata, fair_price, sparkline, lowest_listing, listing_count) and `/market/card/{id}` (metadata, confidence, 24h/7d/30d change, history, active listings, wallet-owned assets). Listings pulled from on-chain PDAs; fair-price from oracle.
- Frontend: new `/market` grid (card-level tiles with fair price + lowest listing + sparkline), `/market/card/[id]` detail with listings left, price insights + chart right, buy/list actions using existing tx builders.
- Profile now shows portfolio fair-value total and per-card breakdown (from `/pricing/stats`) linking into the Market card pages.

## 2025-11-27T21:30:00+08:00 – Codex
- Added a reproducible Docker toolchain for Anchor builds: `Dockerfile.anchor` now installs Solana CLI 1.18.20 from the GitHub tarball, Rust stable, and Anchor CLI 0.30.1 (with time crate patch). Symlinks place Solana binaries on PATH.
- Built base image `anchor-dev` locally; versions baked in: solana-cli 1.18.20, anchor-cli 0.30.1, rustc/cargo 1.91.1.
- Usage: `docker run --rm -it -v /root/mochi:/workspace -v /root/mochi/anchor-program/keys:/root/.config/solana -w /workspace/anchor-program anchor-dev bash`, then `anchor clean && anchor build --program-name mochi_seed_sale --arch sbf` and `anchor deploy --program-name mochi_seed_sale --provider.cluster devnet`.
- Documented the container workflow and image build command in `docs/commands_devnet_setup.md` (Docker section).

## 2025-11-29 – Codex
- Marketplace list endpoint now returns a versioned tx (fixed undefined `tx_v0_b64`) and parses on-chain Listing PDAs so price/currency/seller/status reflect reality instead of zeros.
- Added `scripts/test-listing.ts` to POST listing payloads against the API for fast debugging without the UI.
- Rebuilt `/marketplace` into a live feed with framer-motion entrance, 3D tilt/foil cards, particle bursts on success, auto-refresh ticker, and SOL/USDC toggle for listing.
- Added deposit-on-list: `list_card` now accepts `template_id`/`rarity`, can init `card_record` on the fly, and pulls the Core asset from the seller wallet into vault custody before marking the Listing active. Backend builder populates template/rarity from MintRecord and enforces rarity tag; CardRecord PDA seeds/listing seeds updated accordingly.

## 2025-11-28 – Codex
- Introduced gacha v2 on-chain flow: new `PackSessionV2` PDA (`pack_session_v2` seed), Rare+ only reservations (max 3), and streamlined instructions `open_pack`, `claim_pack_v2`, `sellback_pack_v2`, `expire_session_v2`, and `admin_force_close_v2`. Added helper utilities and error codes for Rare+ validation.
- Tx builder now supports v2 layouts/signatures and derives the new PDA; added builders for open/claim/sellback/expire/admin v2 instructions.
- Backend scaffolding for the hybrid inventory: VirtualCard/RecycleLog tables, v2 open/build/confirm + claim/sellback/expire endpoints using Rare+ CardRecords only, virtual low-tier tracking, and recycle build endpoint to mint Mochi tokens via admin mint authority.
- Pack lineup slots now mark NFT vs virtual cards, SessionMirror stores template_ids/version, and admin rarity inventory aggregates virtual counts.
- SQLite migrated: added SessionMirror.template_ids/version plus new tables virtualcard and recyclelog.
- Devnet Mochi token minted for recycle testing: `3gqKrJoVx3gUXLHCsNQfpyZAuVagLHQFGtYgbtY3VEsn` (decimals=6), 1,000,000 tokens minted to ATA `AHN6zuPCSfHL548fCWnF9RBNMLDMv245VxgX8Xr6V4x`; backend `.env` updated (MOCHI_TOKEN_MINT/DECIMALS/RECYCLE_RATE).
- Legacy mint `6rPGXw2imNPgiqUpA2Rq2doVVyyEXawxepip5YRQ2Jd7` accidentally minted max supply; mark unused.
- Backend v2 pending/resume now reads on-chain state, syncs mirrors, and returns 404 when the session is not pending. Confirm-open accepts pending/accepted states and preserves full lineup; added `/program/v2/claim/cleanup` for stuck mirrors. Treasury airdropped for sell-back tests.
- Frontend gacha shows all 11 slots with NFT/Virtual badges, virtual inventory panel, and an explicit “Opening…” state after buy/confirm. Claim/sell-back/expire call cleanup on mismatch.
- Profile page: virtual cards panel + recycle UI (devnet Mochi mint), name search, rarity/name sort, totals for NFTs/virtuals, denser grid, and per-NFT list button (builds list tx via backend). 
- Always add virtual cards on confirm-open, even if mirror already pending; added gacha opening overlay and pushed fixes to avoid “accept” errors blocking flow.
- Backend v2 pending/resume now reads on-chain state, syncs mirrors, and returns 404 when session is not pending. Confirm open preserves full lineup and adds virtual cards. Added `/program/v2/claim/cleanup` for stuck mirrors.
- Frontend gacha shows all 11 slots with NFT/Virtual badges; virtual inventory panel added. Profile page now shows virtual cards and recycle UI (devnet token), with denser inventory grid and sort controls.

## 2025-11-27T20:50:00+08:00 – Codex
- Added on-chain `admin_force_close_session` instruction to forcibly close any pack_session (ignores state) and return card records to `Available`/vault ownership; redeployed `mochi_v2_vault` (sig `4pnMwuK9mZj4ZSnv3fk8QrPL5HUf7NNvgyhyrgAs2gtMsQ4yUSMQFxANBt8Lfb14D5jvV4Faw31CmHcnY5k7khgR`).
- Backend: new `POST /admin/sessions/force_close` that deserializes the pack_session PDA, builds the new ix with the admin keypair, and frees card records + mirrors for the target wallet.
- Frontend admin: added wallet input + “Force close session” button calling the new endpoint.
- After deploy, backend and frontend services restarted; DB mirrors cleared and all 400 MintRecords set to Available/owned by the vault PDA.

## 2025-11-28T11:05:00+08:00 – Codex
- Added a Compute Budget ix (`set_compute_unit_limit` to 400_000 CUs) ahead of `open_pack_start` in `/program/open/build` to stop pack opens from reverting at the 200k CU cap while reserving 11 CardRecords.
- Restarted `mochi-backend.service` to apply the change; no API shape changes (tx now has one extra instruction before `open_pack_start`).

## 2025-11-28T11:35:00+08:00 – Codex
- Hardened gacha UX: the Buy flow now waits for wallet signature + `/program/open/confirm` success before rendering any lineup/session. If the open tx fails/reverts, local session state is cleared and the Buy button re-enables.
- `hydrateSession` now supports `{interactive, fresh}` to differentiate resume vs new opens (fresh keeps cards face-down). Added messaging for confirmed opens.
- Rebuilt frontend (`npm run build`) and restarted `mochi-frontend.service`.

## 2025-11-28T11:55:00+08:00 – Codex
- Backend: `wait_for_confirmation` now treats any signature with `err` as failure; `/program/open/confirm` returns “Signature not confirmed or transaction failed” instead of later “pack session not found” when the open tx reverts.
- Restarted `mochi-backend.service` after the guard.

## 2025-11-28T12:36:00+08:00 – Codex
- Frontend: Buy flow now only calls `/program/open/confirm` after `sendTransaction` succeeds; if the send throws or returns no signature, it surfaces the error and clears local session state (no confirm call).
- Rebuilt frontend (`npm run build`) and restarted `mochi-frontend.service`.

## 2025-11-29TXX:XX:00+08:00 – Codex
- Program: added `claim_pack_batch3` (exactly 3 cards) and tightened `claim_pack_batch` to 1–2 cards per ix to avoid heap OOM. Redeployed `mochi_v2_vault` (same ID) with deploy sig `4YnkpmsvkNPLzDgVeYBnpvFiRLqNxGnScAiMH82SX2WMHh4J9UNA23gG7Axift8iWi8V1XQTtuBd947SpycbT1is`.
- Backend: disabled old single-shot claim; added `/program/claim/batch_flow` (per-card tx list + finalize) and `/program/claim/test3` (single 3-card test tx). Restarted `mochi-backend`.
- Frontend gacha: “Keep cards” now uses `batch_flow` sequential txs; added “Test claim 3 NFTs” button calling `/api/program/claim/test3`. Rebuilt frontend and restarted `mochi-frontend`.
- State hygiene: force-closed sessions; reset all CardRecords in current vault to Available. One corrupted CardRecord in an old vault_state remains but is ignored by current flows.

## 2025-12-01T00:00:00+00:00 – Codex
- Backend `/program/v2/open/confirm` now accepts optional rarities/template_ids/server_nonce from the client, retries the session fetch, tolerates already-accepted CardRecords, and always persists the lineup before adding low-tier virtual cards (fixes missing virtual inventory).
- Frontend send path now forwards lineup data to confirm-open and auto-attempts a resume hydrate if confirm throws, reducing the “unexpected state accepted” loop; keeps the opening overlay until hydrate completes.
- API client updated for the new confirm-open payload; virtual inventory should populate immediately after pack open without needing manual resume.

## 2025-12-02T00:00:00+00:00 – Codex
- Minted new devnet Mochi token `2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT` (decimals=6) with 1,000,000,000 supply to admin ATA `7gcEZxTRqHDCubymXhsvraHqo6imt8j2StN9qb4UqMtu`; switched backend `.env` and frontend `.env.local` to use this mint for recycle UI/tests.
- Rebuilt frontend and restarted backend/frontend services after the mint swap.

## 2025-12-03T00:00:00+00:00 – Codex
- Added MSRV patches for the Anchor toolchain (toml_datetime/toml_edit/toml_parser/toml_write, indexmap 2.11.4, borsh & borsh-derive 1.6.0) and kept `Cargo.lock` at version 3; build inside the `anchor-dev` Docker image with `rustup default 1.75.0` before `anchor build/deploy`.
- Built the `anchor-dev` container and successfully compiled/deployed `mochi_seed_sale` (program id `2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue`) to devnet after extending the program account for the larger binary.
- Regenerated IDL with full account layouts at `anchor-program/idl/mochi_seed_sale.json` (copy also in `target/idl`). PDAs for the devnet sale config: sale `8S39Fqt73RvakApyQq7mcnPQTQ7MqKVRB4Y6JRzaWviY`, vault auth `J8kvs3vE6mFFhceA59khvkhtKAx4wZQN4xmSfF73j4P7`, seed vault `9pSNuqZjx15rzc9mP4tvFGcZYJrczDtLMm6B19s3trY5`.
- Fixed `SeedSale::LEN` (under-allocation) and re-deployed; `init_sale` now succeeds. Init tx: `5bR86vLzYqN9WHsdnmZukaUAwmgBdYQ3u7wCDGv3nJG2JdX1Sa93FiWArY4fZivzUoDsCJPPNr2dGd5tVXFFFBde`. Seed vault funded with the full devnet Mochi mint (sig `24wdtitnJRCu5mKXjzd3BFMH4QaYc7yMNW2Y8UaA3JnKG5eppRY99G7FT1JFWVd9VLhSAvMnxHtdLAb5uyBCUyqT`).
- Updated `contribute` to `init_if_needed` so a wallet can contribute multiple times (no single-contribution limit). Redeployed the program with the same id to devnet.
- Contributor count: reverted on-chain field to keep account size stable; frontend now derives contributor count by scanning Contribution PDAs for the sale (best-effort RPC). Redeployed mochi_seed_sale with unchanged account layout.

## 2025-12-05T00:00:00+00:00 – Codex
- Integrated “Mochi Stadium” mini-games (bot duels) into the frontend:
  - New nav item `Stadium` → `app/stadium` hub with cards for each game.
  - Game pages under `app/stadium/*` (connect-3, memory-duel, speed-match, tactics-lite, rps-plus) load Phaser clients dynamically.
  - Game logic/assets in `frontend/stadium/games/*`; Pokémon sprite PNGs in `public/img/pokemon/`.
- Added Phaser dependency to the frontend; ensure `npm install` is run if node_modules is missing.
- Profile dashboard: totals + CTA tab buttons; sort/search moved inside the dashboard (removed duplicate counters).

## 2025-12-06T00:00:00+00:00 – Codex
- Marketplace fill guard: `/marketplace/fill/build` now verifies the Listing PDA exists and is owned by the program; if missing/wrong-owner it returns HTTP 400 ("please relist") instead of producing a tx that fails with AccountOwnedByWrongProgram.

## 2025-12-06 – Codex
- Added pricing scaffolding: SQLModel `PriceSnapshot`, pricing endpoints (`/pricing/card/{id}`, `/pricing/card/{id}/history`, `/pricing/portfolio`), marketplace price hints (`current_mid`, `high_90d`, `low_90d`), and a mock USD→SOL helper (`get_sol_price`). Sellback code is wired to compute 90% mid-price, but on-chain payout override still needs program support.
- Added price-oracle scaffold: `price_oracle/` folder plus `scripts/fetch_tcg_prices.py` and `price_oracle/config.json`. Currently uses mock rows; replace `run_spider` with the vendored pokespider (Scrapy + Playwright) to ingest TCGPlayer prices into the DB.

## 2025-12-07 – Codex
- Pricing pipeline documented and refreshed:
  - Added a price-oracle section to `docs/AGENT_GUIDE.md` describing the fetch-elsewhere/import flow (pokemonTCG.io), since this VPS IP is blocked.
  - Imported `/root/me1.json` into `backend/mochi.db` → 188 fresh `PriceSnapshot` rows for Mega Evolution mapped to existing `CardTemplate` entries.
  - Backend pricing responses now return derived fields: `display_price`, 7d/30d averages, spread ratio, and `price_confidence`.
  - Pricing UI shows display price + confidence, and a detail modal with history sparkline fetched on demand.
- Added `scripts/rescue_garbage.ts`, a TS utility to call `admin_force_cancel_listing` for listings pointing to an old/non-canonical vault_state and return NFTs to the seller. Reads garbage JSON, derives PDAs (listing, card_record, vault_authority) for the old vault, and sends the rescue tx. Use with admin keypair + RPC where the old vault lives.
- Recycle flow tightened: reward is now exactly 1 card = 1 MOCHI (raw units with configured decimals), no minimum batch size beyond selecting at least one card, user pays gas on the mint tx, and `/profile/recycle/confirm` deducts virtual cards after confirming the on-chain mint.

## 2025-12-04 – Codex
- Wired Scrapy runner to actually return scraped rows via a shared `COLLECTED_ITEMS` bucket and fixed package imports (`price_oracle/__init__.py`, fully qualified spider settings).
- Mock spider now emits real card-template names so `PriceSnapshot` inserts succeed; running `POKESP_MOCK=1 PYTHONPATH=/root/mochi:/root/mochi/backend DATABASE_URL=sqlite:///backend/mochi.db python scripts/fetch_tcg_prices.py` inserts snapshots against `CardTemplate` rows.
- `price_oracle/pokespider/settings.py` now uses the fully-qualified module path to avoid `ModuleNotFoundError: pokespider`.
- Added live price search endpoint `/pricing/search` (returns latest snapshot for matching CardTemplate names) and a frontend page at `/pricing` with search UI. Header nav now links to “Pricing.”
- Added `/pricing/set` (latest prices by set) and `/pricing/sets` (available sets with prices). Pricing UI now has a “Set view” with filters (set selector, rarity, sort) defaulting to Mega Evolution plus the existing search tab.

## 2025-12-03T05:57:00+00:00 – Codex
- Backend seed-sale support added: settings for `SEED_SALE_AUTHORITY/MINT/TREASURY`, parsers for sale/contribution PDAs, ATA helper, and contributor count via RPC scan.
- New endpoints:
  - `GET /seed_sale/state` returns on-chain sale fields, vault/treasury balances, contributor count, and optional user contribution.
  - `POST /seed_sale/contribute/build` validates window/caps (min 0.01 SOL) and returns a ready contribute transaction.
  - `POST /seed_sale/claim/build` checks sale end/contribution/claimable, adds ATA creation when needed, and returns claim tx meta.
- Responses include `tx_b64`/`tx_v0_b64` + instruction metadata alongside lamports/tokens owed/claimable to keep the frontend thin.

## 2025-12-03T06:10:00+00:00 – Codex
- Frontend home seed-sale widget now calls backend builders (`/seed_sale/state`, `/seed_sale/contribute/build`, `/seed_sale/claim/build`) instead of hand-built txs; shows live caps/progress/your stake via the API.
- Updated `frontend/.env.local` to use `NEXT_PUBLIC_BACKEND_URL=https://getmochi.fun/api` so the site hits the new domain.
- Contribute/claim flows deserialize backend v0 txs and submit via wallet adapter; balances/tokens owed respect mint decimals. Rebuild + service restart pending after these changes.

## 2025-12-05T10:25:00Z – Codex
- Fixed marketplace buy flow: `build_fill_listing_ix` now includes `core_asset` and `mpl_core_program` accounts (previously missing, causing post-signature failures), and `/marketplace/fill/build` passes the core asset through. Buy buttons should submit valid transactions now. Backend restart required after pulling this change.

## 2025-12-06T09:30:00Z – Codex
- Domain migration note: legacy metadata/images are still served from `https://getmochi.fun/nft/...` while the live site runs at `https://getmochi.fun`. Frontend no longer rewrites URLs; keep both domains serving the same files or add redirects, and mint future batches with `getmochi.fun` in the manifest to avoid broken images.

## 2025-12-06T12:45:00Z – Codex
- Backend tx builder now requires env-driven program ids: `PROGRAM_ID` and `SEED_SALE_PROGRAM_ID` are loaded from `backend/.env` (devnet defaults provided).
- Frontend marketplace enforces `NEXT_PUBLIC_PROGRAM_ID` (no hard-coded fallback), and the admin dashboard now reads `NEXT_PUBLIC_VAULT_AUTHORITY`/`NEXT_PUBLIC_SEED_*` from `frontend/.env.local` for PDAs and balance diagnostics.
```

## TOKENOMICS_FLOW.md (docs/TOKENOMICS_FLOW.md)
```markdown
# Tokenomics Flow

## Configuration
- Mint: **Mochi V2** `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv` (decimals=6). Master key `Dy2b6bzpX9XYLUowS4BgYiYEHrtqrsD895zxddQvLH1M` (kept in `keys/allocation/mochi_v2_master.json`) holds mint/freeze authority; allocations are recorded in `docs/MIGRATION_V2.md`.
- Backend `.env`: `MOCHI_TOKEN_MINT`, `MOCHI_TOKEN_DECIMALS`, `MOCHI_PACK_REWARD` (whole tokens per pack; default 100). Rewards are paid from the admin treasury ATA `831fnahUncbMNznw79BtqAbsKGvvDZ2HefEhmQrv8CqW` (funded with 10M V2 tokens).
- On-chain reward config is **disabled**: `set_reward_config` is set to `reward_per_pack = 0` and `mochi_mint = GS99...`, so the program skips PDA minting. Do not reassign mint authority to the vault PDA; V2 rewards are treasury transfers only.

## Pack → Reward lifecycle (treasury transfer)
1) Build: Frontend calls `/program/v2/open/build`; backend prepends MOCHI ATA creation if missing and returns `open_pack_v2` ix. On-chain reward_per_pack is 0 so the program does **not** mint.
2) Transaction: User signs and sends the open tx (payment + session creation only).
3) Confirm: Frontend posts `/program/v2/open/confirm`; backend mirrors the session and then calls `maybe_spawn_pack_reward`, which transfers `MOCHI_PACK_REWARD * 10^decimals` from the admin treasury ATA to the user’s ATA (creates the ATA server-side if missing). PackRewardLog stores status/signature per session.
4) Claim/sellback/expire continue as normal (`/program/v2/claim|sellback|expire/build` → sign → `/.../confirm`).

## Fallback / error handling
- If the admin treasury lacks funds, `maybe_spawn_pack_reward` returns `status: "failed"` and leaves the session open; fund `831fna...` and rerun `/admin/reward/retry`.
- To suspend rewards entirely, set `MOCHI_PACK_REWARD=0` (or clear `MOCHI_TOKEN_MINT`) in the backend environment.
- ConstraintSeeds errors usually mean the wrong vault_authority PDA was passed; expected devnet PDA is `FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g` for `vault_state = ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d`.

## Recent changes (2025-12-08)
- Launched Mochi V2 token `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv` (1B supply) with allocations in `docs/MIGRATION_V2.md`; admin treasury seeded with 10M for recycle/reward flows.
- Disabled on-chain reward minting by setting `reward_per_pack = 0` via `set_reward_config` (sig `66vYeQwa8UKjHC7juUyqqBRviAUmvqt883QLvxX2KNqbt92igzT6p43RrgtiBTSFye5t4tX9tB56TUnmzeD3Kv79`).
- Backend `/program/v2/open/confirm` now always treasury-transfers rewards from the admin wallet using `MOCHI_PACK_REWARD` instead of calling the PDA mint authority.
```

## commands_devnet_setup.md (docs/commands_devnet_setup.md)
```markdown
# Devnet setup commands (authority/USDC already generated)

## Keys (already present)
- Authority/treasury: `mochi/anchor-program/keys/dev-authority.json` (pubkey `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs`)
- USDC mint: `mochi/anchor-program/keys/dev-usdc-mint.json` (pubkey `GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu`)
- Program id: `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`
- PDAs: vault_state = `HNJPBPsnHJ7DAVs3PmZMBCkV5dgZrXvEWVp891X4D1Kw`, vault_authority = `C9EfNtZkpjVsTSxCdGN4M8G1meBExxqBMFdfj8Jc4Y7z`

## 1) Solana CLI config
```bash
solana config set --url https://api.devnet.solana.com
solana config set --keypair mochi/anchor-program/keys/dev-authority.json
```

## 2) Fund the authority
```bash
solana airdrop 2 CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
```

## 3) Mint dev USDC and create ATAs
```bash
USDC_MINT=GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu
AUTH=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
solana-keygen pubkey mochi/anchor-program/keys/dev-usdc-mint.json
spl-token create-account $USDC_MINT --owner $AUTH --fee-payer mochi/anchor-program/keys/dev-authority.json
VAULT_USDC_ATA=$(spl-token account-info $USDC_MINT --owner $AUTH --output json | jq -r '.address')
# Mint some USDC for treasury
spl-token mint $USDC_MINT 1000 --owner mochi/anchor-program/keys/dev-usdc-mint.json --fee-payer mochi/anchor-program/keys/dev-authority.json
spl-token transfer $USDC_MINT 500 $VAULT_USDC_ATA --owner mochi/anchor-program/keys/dev-authority.json --fund-recipient
```

## 4) Deploy program
```bash
cd mochi/anchor-program
anchor build
anchor deploy
```

## 5) Initialize vault
```bash
anchor test --skip-build -- --nocapture  # optional sanity tests if added later

# Example via anchor-cli (pseudo)
anchor run initialize_vault -- \
  --pack-price-sol 100000000 \
  --pack-price-usdc 10000000 \
  --buyback-bps 9000 \
  --claim-window 3600 \
  --fee-bps 200 \
  --core-collection <CORE_COLLECTION_OPTIONAL> \
  --usdc-mint $USDC_MINT \
  --vault-treasury <VAULT_SOL_TREASURY=AUTH> \
  --vault-usdc-ata $VAULT_USDC_ATA
```

## 6) Mint Core assets and deposit
- Mint Metaplex Core assets using authority `CKjhhqf…` as update authority.
- For each Core asset ID:
```bash
anchor run deposit_card -- --core-asset <ASSET_PUBKEY> --template-id <u32> --rarity <enum>
```

## 7) Backend env
Set in `backend/.env`:
```
SOLANA_RPC=https://api.devnet.solana.com
SOLANA_DEVNET_RPC=https://api.devnet.solana.com
HELIUS_RPC_URL=<your helius key>
ADMIN_ADDRESS=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
PLATFORM_WALLET=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
TREASURY_WALLET=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
USDC_MINT=GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu
CORE_COLLECTION_ADDRESS=<optional>
SERVER_SEED=<random>
DATABASE_URL=sqlite:///./mochi.db
```

## 8) Frontend env
Set in `frontend/.env.local`:
```
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_ADMIN_ADDRESS=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
NEXT_PUBLIC_USDC_MINT=GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu
NEXT_PUBLIC_PROGRAM_ID=Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx
```

Note: Metaplex Core CPI custody/burn wiring is still TODO in the program; after adding it, rebuild/deploy and re-run initialize + deposit.

## Docker toolchain (clean Anchor builds)
- Build the image once (from repo root): `docker build -f Dockerfile.anchor -t anchor-dev .`
- Run with project + keys mounted:
```
docker run --rm -it \
  -v /root/mochi:/workspace \
  -v /root/mochi/anchor-program/keys:/root/.config/solana \
  -w /workspace/anchor-program \
  anchor-dev bash
```
- Inside the container:
  - `anchor clean`
  - `anchor build --program-name mochi_seed_sale --arch sbf`
  - `anchor deploy --program-name mochi_seed_sale --provider.cluster devnet`
- Versions baked into the image: `solana-cli 1.18.20`, `anchor-cli 0.30.1`, `rustc/cargo 1.91.1`. Use this container for all future builds/deploys to avoid host toolchain drift.
```

## AGENT_GUIDE.md (docs/AGENT_GUIDE.md)
```markdown
# Mochi v2 – Agent Guide

This is a clean rebuild of the Mochi real‑world‑asset Pokémon card platform for Solana devnet. Use this guide as the orientation doc for future agents.

## High-level architecture
- **On-chain (Anchor):** `mochi_v2_vault` manages two distinct domains:
  - **Gacha vault:** PDA seeds `[b"vault_state"]` / `[b"vault_authority", vault_state]` own protocol packs/cards.
  - **Marketplace vault:** PDA seeds `[b"market_vault_state"]` / `[b"market_vault_authority", market_vault_state]` own seller escrow for listings.
  - Listings use `[b"listing", market_vault_state, core_asset]`; CardRecords use `[b"card_record", <vault_state>, core_asset]`. NFTs are Metaplex Core assets.
- **Backend (FastAPI):** Transaction builder + provably-fair RNG service + DB mirror (SQLite/Postgres). Uses Helius DAS for reads. Scripts live in `/scripts`.
- **Frontend (Next.js App Router):** Wallet adapter + animated UI for gacha, marketplace, profiles, admin. Calls backend for previews/tx builders. Marketplace listing state comes from on-chain PDAs (RPC-first); DB only caches/verify-allowlists mints.
- **Data:** Card templates loaded from the Mega Evolution CSV via `scripts/import_card_templates.py`; mint records mirror Core assets sitting in the vault PDA. PNG/JSON metadata lives under `/var/www/mochi-assets/nft` and is exposed through `https://getmochi.fun/nft/...` (generated by `~/nft_pipeline`).
  - Domain note: legacy metadata/images were minted with `https://getmochi.fun/nft/...`; the live site is now `https://getmochi.fun`. Keep both domains serving the same files or add redirects, and when minting new batches use the `getmochi.fun` base in your manifests.

## Price Oracle (pokemonTCG.io → PriceSnapshot)
- Source: pokemonTCG.io `/v2/cards` (includes `tcgplayer.prices.market/mid/low/high`). Direct API calls from this VPS are still flaky; preferred flow remains “fetch elsewhere + import.”
- **Append-only rule:** PriceSnapshot is now time-series only. Never delete/overwrite rows; every fetch inserts a new row with the scrape timestamp. The table was purged/reset on 2025-12-05 to clear corrupted data.
- Schema: new columns `market_price` (recent sales) and `direct_low` (lowest listing) plus an index on `(template_id, collected_at)`. Fair value priority = `market_price` → `direct_low` → `mid_price` → `low/high`. Confidence is LOW when `(high - low) / low > 50%` or data is stale.
- APIs: `/pricing/card/{id}` (returns `fair_value` + `confidence_score`), `/pricing/card/{id}/history?points=30` (fair_value per point), `/pricing/sparklines?template_ids=1,2&points=30`, `/pricing/stats?wallet=` (portfolio_total + 24h_change), `/pricing/portfolio` (per-card breakdown with fair_value/confidence).
- Relevant files: `scripts/fetch_tcg_prices.py` (supports `POKEMONTCG_PROXY`), `price_oracle/config.json`, sample payload `/root/me1.json`.

### Refreshing prices (append-only)
1) On a machine with API access, fetch a set as JSON (includes collected_at implicitly):
```
curl --http1.1 -s -H "Accept: application/json" \
  -H "X-Api-Key: <API_KEY>" \
  "https://api.pokemontcg.io/v2/cards?q=set.id:<SET_ID>&page=1&pageSize=250&select=name,set,tcgplayer,rarity" \
  -o <set>.json
```
For Mega Evolution: `set.id:me1`, pageSize 250 covers all 188 cards.

2) Upload JSON to VPS: `scp <set>.json root@72.61.126.168:/root/mochi/`.

3) Import (append) on VPS using the script (sets live in `price_oracle/config.json`):
```
POKEMONTCG_API_KEY=<API_KEY> PRICE_ORACLE_CONFIG=price_oracle/config.json \
  python3 scripts/fetch_tcg_prices.py
```
This maps rows by fuzzy card/set name to CardTemplate and inserts `market_price`, `direct_low`, `mid/low/high`, and `collected_at` timestamps. No deletes are performed; each run adds new time-series points.

If you must scrape from the VPS directly, set `POKEMONTCG_PROXY` and rerun the same script (falls back to Playwright/scrapy via the vendored `price_oracle/pokespider`).

## Key flows
- **Pack opening:**
  1) Frontend calls `/program/open/preview` with client seed to show rarities.
  2) `/program/open/build` selects specific assets (DB/Helius), builds `open_pack_start` tx.
  3) User signs; decision window = 1 hour. `claim_pack` or `sellback_pack` txs are built by backend.
- **Pack opening v2 (Rare+ only on-chain):**
  - New `pack_session_v2` PDA holds only Rare+ CardRecord bindings (max 3); Common/Uncommon/Energy stay off-chain in the DB.
  - `open_pack` (v2) reserves Rare+ CardRecords, `claim_pack_v2`/`sellback_pack_v2` resolve, `expire_session_v2` frees after the window, and `admin_force_close_v2` clears stuck sessions.
  - SessionMirror now keeps `template_ids` and `version=2` for hybrid inventory; VirtualCard table tracks low-tier counts; recycle endpoint mints Mochi tokens from recycled low-tier cards.
- **Marketplace:** Listings stored on-chain via `Listing` PDA (marketplace vault seeds); backend provides tx builders; frontend renders grid & actions directly from RPC (not DB state).
  - Safety rails: `emergency_return_asset` (admin-only, returns escrowed Core asset to the recorded seller; destination is fixed) and `admin_rescue_legacy_listing` (admin-only, pulls from a legacy vault_state/authority back to seller). Use `initialize_marketplace_vault` to set up the canonical market vault.
  - Listing init: `list_card` now `init_if_needed`-creates `card_record` + `listing` PDAs (no PDA signatures). Canonical market vault is enforced (`market_vault_state = mx1PX4zganVFtuneoc61jcuadctsUPk9UGbyhNnnLwT`, `market_vault_authority = CGhdCwqZx7zn6YNqASY6V4uxFZpegb1QDu5qnMNDKihd`); latest deploy sig `46KoTXDZ9aNkEPvkJZA1TQXqRCvzo6WSZ5Gdogc7xaxHxsxVM61uq5mqxhrqrhbwxdFZDPfXjErkgtyLLDQnA4aB`. Quick smoke: `TS_NODE_TRANSPILE_ONLY=1 npx ts-node -P tsconfig.scripts.json scripts/test_listing_flow.ts` mints + lists (last success tx `2aBViFHyUmLALdGT6mXavZEkQavDQZxMYhMNHruLoK9WSQJDeuSfvundGiYkiZUV1Memvttys7R6Bfi2nxdqwEXw`, asset `FK5X2C7G21Lqzyj1NQUR49Kt6kuMw3vq3bsYbVCM1m3d`).
  - Mainnet hardening (todo): enforce a verified collection/update-authority/creator allowlist when accepting deposits/listings so only Mochi-minted assets can be escrowed. Today the program doesn’t gate the Core asset beyond CardRecord ownership; add collection/creator checks before mainnet.
- **Profiles:** Read holdings via Helius DAS filtered by Core collection; enrich with CSV template metadata.
- **Admin:** Inventory by rarity, session mirrors, cleanup/settle helpers.

## Seeds / PDAs
- **Gacha:** `vault_state` = [`"vault_state"`]; `vault_authority` = [`"vault_authority"`, vault_state]; `card_record` = [`"card_record"`, vault_state, core_asset]; `pack_session` = [`"pack_session"`, vault_state, user]; `pack_session_v2` = [`"pack_session_v2"`, vault_state, user].
- **Marketplace:** `market_vault_state` = [`"market_vault_state"`]; `market_vault_authority` = [`"market_vault_authority"`, market_vault_state]; `listing` = [`"listing"`, market_vault_state, core_asset]; `card_record` shared type derived with the target vault_state.

## Environment
- Devnet-first. RPC via Helius (set `HELIUS_RPC_URL`).
- Wallets: generated keypairs live in `anchor-program/keys/`. `passkey.json` is the authority key; `program-id.json` is the program deploy key.
- Treasury: set `TREASURY_WALLET` (defaults to `PLATFORM_WALLET`) for marketplace fees/buyback payouts.
- Mochi token V2: mint `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv` (decimals=6). Allocations live in `docs/MIGRATION_V2.md`; server admin ATA `831fnahUncbMNznw79BtqAbsKGvvDZ2HefEhmQrv8CqW` holds 10M for recycle/reward flows. V1 token `2iL86t...` is deprecated.
- Backend tx builders return message base64 (`tx_b64`), unsigned v0 tx (`tx_v0_b64`), instruction metadata, and `recent_blockhash` for client signing.
- RNG provably-fair: `server_seed_hash` (commit), `server_nonce = sha256(server_seed_hash:client_seed)[:16]`, entropy = `sha256(server_seed:client_seed:server_nonce)`. Preview/build return `server_seed_hash`, `server_nonce`, and `entropy_proof` so users can verify slot lineups.
- Timekeeping: prefer ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`). Install MCP time server (`pip install mcp-server-time` or `uvx mcp-server-time`) to keep logs accurate; see `docs/mcp_time.md`.
- Devnet defaults (generated): CORE_AUTHORITY/VAULT wallet `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs`, USDC mint `GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu`. Secrets in `anchor-program/keys/dev-authority.json` and `dev-usdc-mint.json`.

## Toolchain (Docker, use this for builds)
- Image: build once from repo root `docker build -f Dockerfile.anchor -t anchor-dev .`
- Versions baked in: `solana-cli 1.18.20`, `anchor-cli 0.30.1`, `rustc/cargo 1.91.1`.
- Run container for builds/deploys:
```
docker run --rm -it \
  -v /root/mochi:/workspace \
  -v /root/mochi/anchor-program/keys:/root/.config/solana \
  -w /workspace/anchor-program \
  anchor-dev bash
```
- Inside: `anchor clean && anchor build --program-name mochi_seed_sale --arch sbf`, then `anchor deploy --program-name mochi_seed_sale --provider.cluster devnet`.
- MSRV pin: the SBF toolchain is rustc `1.75.x`; keep `Cargo.lock` at version 3 and run `rustup default 1.75.0` in the container before `anchor build/deploy`. `Cargo.toml` patches pin `toml_*`, `indexmap`, and `borsh( -derive)` to MSRV-compatible versions—avoid bumping them or regenerating the lockfile with newer Cargo.

## Minting verification checklist
- Core assets (Metaplex): use Helius DAS `getAsset` on a minted `core_asset`; expect `ownership.owner = vault_authority` and metadata URI matching `https://getmochi.fun/nft/metadata/...`. Admin refresh: `curl -X POST http://127.0.0.1:4000/admin/inventory/refresh` then `curl http://127.0.0.1:4000/admin/inventory/assets | jq 'length'` to see counts; CardRecords should show `status=Available`.
- SPL mints (e.g., USDC/Mochi token): `spl-token supply <mint>`, `spl-token account-info <mint> --owner <wallet>`; confirm decimals, mint/freeze authority, and balances for treasury/vault ATAs.
- Deposit confirmation: `anchor accounts mochi_v2_vault` (or `solana account <card_record_pda>`) shows CardRecord status/owner; backend SessionMirror shouldn’t list them as reserved.
- Explorer check: view the mint/asset in Solscan/Explorer for final confirmation of supply/owner/metadata.
- **Seed sale (devnet test)**
  - Program: `2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue`
  - PDAs (authority `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs`, mint `2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT`): sale `8S39Fqt73RvakApyQq7mcnPQTQ7MqKVRB4Y6JRzaWviY`, vault auth `J8kvs3vE6mFFhceA59khvkhtKAx4wZQN4xmSfF73j4P7`, seed vault `9pSNuqZjx15rzc9mP4tvFGcZYJrczDtLMm6B19s3trY5`.
  - Init tx: `5bR86vLzYqN9WHsdnmZukaUAwmgBdYQ3u7wCDGv3nJG2JdX1Sa93FiWArY4fZivzUoDsCJPPNr2dGd5tVXFFFBde`; seed vault funded with full devnet supply (sig `24wdtitnJRCu5mKXjzd3BFMH4QaYc7yMNW2Y8UaA3JnKG5eppRY99G7FT1JFWVd9VLhSAvMnxHtdLAb5uyBCUyqT`).

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
- Backend dev: `cd backend && uvicorn main:app --reload --port 4000`
- Frontend dev: `cd frontend && npm install && npm run dev`
- Import templates: `DATABASE_URL=sqlite:///backend/mochi.db python scripts/import_card_templates.py ../nft_pipeline/data/mega-evolutions.csv`
- Asset pipeline: `cd ../nft_pipeline && npm run fetch:tcgdex && npm run generate && npm run upload -- --target local`
- Mint + deposit Core assets: `CORE_TEMPLATE_OFFSET=0 CORE_TEMPLATE_LIMIT=40 TS_NODE_TRANSPILE_ONLY=1 npx ts-node -P tsconfig.scripts.json scripts/mint_and_deposit.ts`
- Refresh backend inventory mirror: `curl -X POST http://127.0.0.1:4000/admin/inventory/refresh`
- Claim flow (dev): use `/program/claim/batch_flow` (per-card txs + finalize) or `/program/claim/test3` for a 3-card benchmark; single-shot claim is disabled. Always send the returned txs sequentially and finalize afterward.
- Pricing oracle:
  - Folder: `price_oracle/` (pokespider vendoring), config at `price_oracle/config.json` (`{"sets": ["Base Set", ...]}`).
  - Fetch script: `scripts/fetch_tcg_prices.py` (requires Scrapy/Playwright; `playwright install chromium`). Inserts append-only rows with `market_price`, `direct_low`, `mid/low/high`, and `collected_at`; never delete existing snapshots.
  - Fair value: priority `market_price → direct_low → mid_price`; `confidence_score` flips LOW when `(high-low)/low > 50%` or stale. Endpoints return `fair_value` + sparkline points: `/pricing/card/{id}`, `/pricing/card/{id}/history?points=30`, `/pricing/sparklines?template_ids=1,2`, `/pricing/stats?wallet=`, `/pricing/portfolio`.
  - Buyback: sellback build still uses 90% of mid-price converted via `get_sol_price` (mock 150 USD/SOL). On-chain program needs payout override support; rarity-based fallback remains.
  - If API is blocked from the VPS: fetch on another machine then import JSON:
    1) `curl --http1.1 -s -H "Accept: application/json" -H "X-Api-Key: <API_KEY>" "https://api.pokemontcg.io/v2/cards?q=set.id:<SET_ID>&page=1&pageSize=250&select=name,set,tcgplayer,rarity" -o <set>.json`
    2) Upload to VPS (`/root/mochi/`) and import via a short Python snippet mapping (card name + set name) → `CardTemplate` and replacing `PriceSnapshot` rows for that set.
  - Derived fields: backend pricing responses return `display_price`, 7d/30d averages, spread ratio, `price_confidence`; frontend pricing page shows display + confidence and a detail modal with sparkline (90d).
- Listing rescue (legacy vault → seller):
  - Script: `scripts/rescue_legacy_listings.ts` calls on-chain `admin_rescue_legacy_listing` to return NFTs from an old/non-canonical `vault_state` to the recorded seller (no DB writes).
  - Inputs: edit `RESCUE_TARGETS` array inside the script with `{listing, coreAsset, legacyVaultState, seller}`; set env `MARKETPLACE_VAULT_STATE=<canonical market_vault_state PDA>`, `RPC_URL`, `ADMIN_KEYPAIR`.
  - Behavior: derives the legacy `card_record` and detects whether the legacy vault authority matches marketplace or gacha seeds, then signs with that PDA to transfer back to `listing.seller`. Destination is locked; admin cannot redirect.
  - For stuck listings in the current vault, use `emergency_return_asset` (admin-only) which returns escrowed Core assets to `listing.seller` and marks the listing cancelled.

## Contact points
- Admin address: set via env `ADMIN_ADDRESS` / `NEXT_PUBLIC_ADMIN_ADDRESS`.
- Core collection: set via env `CORE_COLLECTION_ADDRESS`.

Keep this guide current as the stack evolves and when adding VRF, payments, or redemption flows.


### Market fusion
- Top nav: Home | Gacha | Market | Stadium | Profile | Admin; /pricing redirects to /market.
- Unified market endpoints: `/market/cards` (search/filter/sort; returns fair_price, lowest_listing, listing_count, sparkline) and `/market/card/{id}` (metadata, history, listings, optional wallet-owned assets).
- Frontend pages: `/market` grid (card-level tiles with fair price + listing snapshot) and `/market/card/[id]` (two-column detail with listings + price insights/chart).
- Portfolio view now lives in Profile: fetches `/pricing/stats` to show fair-value total and per-card rows linking to Market.
```

## TOKEN_MECHANICS_V2.md (docs/TOKEN_MECHANICS_V2.md)
```markdown
# Mochi Token Mechanics (V2) — Single Source of Truth

## Model: Treasury Transfer
- Rewards and recycle payouts flow **from the server admin treasury ATA to the user ATA**.
- No PDA minting is used for rewards. On-chain `reward_per_pack` is set to 0 to prevent program-side mints; all payouts are standard SPL transfers signed by the admin key.

## Supply
- Total supply: **1,000,000,000** MOCHI (decimals=6).
- Mint: `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv`.
- Allocations: see `docs/MIGRATION_V2.md` for the five buckets and funding signatures.

## Flows
- **Recycle**
  - User signs and pays fees; backend builds a tx that transfers tokens from the admin treasury ATA to the user ATA.
  - Amount: `count * 10^decimals` where `count` is the number of recycled virtual cards.
  - The backend will create the user ATA if missing; it checks the admin treasury balance before building.
- **Open Pack**
  - User signs and pays pack cost (SOL/USDC). Backend confirm step (`/program/v2/open/confirm`) triggers `maybe_spawn_pack_reward`, which transfers `MOCHI_PACK_REWARD * 10^decimals` from the admin treasury ATA to the user ATA.
  - Admin treasury signs the transfer; the transaction is logged in `PackRewardLog`. If treasury balance is insufficient, reward status returns `failed` and can be retried after funding.

## Addresses
- **Mint:** `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv`
- **Admin Treasury ATA:** `831fnahUncbMNznw79BtqAbsKGvvDZ2HefEhmQrv8CqW` (owner: `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs`)
- **Mint Authority (master key):** `Dy2b6bzpX9XYLUowS4BgYiYEHrtqrsD895zxddQvLH1M` (kept offline in `keys/allocation/mochi_v2_master.json`; not used for runtime rewards)
```

## agent_frontend.md (docs/agent_frontend.md)
```markdown
# Frontend – Next.js App Router
Path: `frontend/`

## Stack
- Next.js 14 (App Router, TypeScript)
- TailwindCSS + custom palette (ink/sakura/aurora/coin)
- Framer Motion for reveals/tilt
- Solana wallet adapter (Phantom, Solflare, Backpack)

## Env
- `NEXT_PUBLIC_SOLANA_RPC`
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_ADMIN_ADDRESS`
- `NEXT_PUBLIC_USDC_MINT` (devnet default: `GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu`)

## Routes
- `/` – Hero, RWA diagram, live feed mock.
- `/gacha` – Client seed input, preview RNG (calls `/program/open/preview`), build pack, 11-card reveal UI, claim/sellback buttons, 1h countdown. The page now auto-resumes any pending session by calling `GET /program/session/pending` when a wallet connects (so refreshes show the same lineup/countdown), and it disables buy/claim/sell buttons with explicit loading states while wallet prompts or RPC calls are in flight to prevent spam clicks. A dedicated “Resume pending pack” button under the buy controls lets ops manually rehydrate the session if needed. When the timer hits zero the UI surfaces an `Expire session` button that calls `/program/expire/build`, prompting the user to sign the cleanup transaction so the old pack can be cleared without admin help.
  - Front-end now surfaces backend error strings (e.g., “Active pack session already exists”) beside the Buy Pack controls, shows explicit “Awaiting wallet signature → Submitting transaction” states so Phantom prompts are expected, and displays the active session id/countdown whenever a pack is pending.
  - Claim flow: “Keep cards” now calls `/program/claim/batch_flow` (backend returns per-card txs + finalize), and sends each tx sequentially. Added a “Test claim 3 NFTs” button calling `/api/program/claim/test3` (one tx using on-chain `claim_pack_batch3`) for benchmarking whether 3-card batches are stable.
- `/marketplace` – Grid of listings from backend with hover animation; buy/cancel buttons (placeholder actions).
  - Buy/cancel wired to backend builders and wallet signing; list form available (asset + price lamports).
- `/profile` – Redirects to connected wallet; `/profile/[address]` fetches holdings via backend profile endpoint.
- `/admin` – Devnet-friendly dashboard (wallet gate temporarily disabled) showing inventory counts, searchable asset list, session mirrors, buttons that call `/admin/inventory/refresh` / `/admin/inventory/assets` to sync with Helius, plus a “Force expire all” control that hits `/admin/sessions/force_expire`. A new wallet input + “Force close session” button calls `/admin/sessions/force_close` (uses the on-chain `admin_force_close_session` to free stuck PDAs). Diagnostics blocks pull `/admin/sessions/diagnostic` and `/admin/inventory/reserved` so you can see which cards/sessions are stuck before clearing them. Session mirrors list now paginates (Prev/Next) using the backend’s `page`/`page_size` params so the UI stays responsive even with large histories.
- Provably-fair panel on `/gacha` displays `server_seed_hash`, `server_nonce`, `entropy_proof` from backend responses.
- Provably-fair dashboard cards show server_seed_hash, server_nonce, client_seed, entropy_proof, and verification steps (hash/nnonce/entropy reproduction).
- Transaction helper: `lib/tx.ts` decodes instruction metadata and builds v0 transactions from backend responses (uses returned `recent_blockhash`); gacha page wires claim/sellback buttons to `signTransaction` + `connection.sendTransaction`.
  - Pack purchase now also signs/sends using the same helper and blockhash.
  - Marketplace buy/cancel/list actions use the same helper + blockhash for signing.
- Gacha and marketplace offer USDC toggles that auto-derive user/vault ATAs using `NEXT_PUBLIC_USDC_MINT` (manual ATA derivation helper).
- Backend also returns `tx_v0_b64` (unsigned v0 tx) if you prefer to deserialize directly instead of rebuilding from instruction metadata.

## Components
- `WalletProvider` – wraps Connection/Wallet providers; autoConnect.
- `Header` – navigation + WalletMultiButton.

## Styling
- globals: gradient background, glass cards via `card-blur` class.
- Fonts: Space Grotesk (non-default stack).

## TODOs
- Pipe built tx_b64 into wallet for signing.
- Consume backend instruction metadata (v0 message + keys) to build full transactions client-side.
- Add filters/search for marketplace and templates metadata rendering (images, rarities).
- Add responsive animations for card reveals (swipe/drag gestures).
- Add redemption flow UI.
```

## agent_backend.md (docs/agent_backend.md)
```markdown
# Backend – FastAPI
Path: `backend/main.py`

## Environment
- `SOLANA_RPC`, `SOLANA_DEVNET_RPC` (devnet default)
- `HELIUS_RPC_URL` (DAS endpoint)
- `ADMIN_ADDRESS`, `PLATFORM_WALLET`, `CORE_COLLECTION_ADDRESS`
- `ADMIN_KEYPAIR_PATH` (server-side signer used for force-expire; default `/root/mochi/anchor-program/keys/passkey.json`)
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
- `POST /program/open/build` → selects assets (DB), reserves MintRecords, persists SessionMirror, returns `tx_b64` (message), `tx_v0_b64` (unsigned v0 tx), `recent_blockhash`, instruction metadata, and provably_fair payload. The transaction builder now prepends a Compute Budget ix (`set_compute_unit_limit` 400k) before `open_pack_start`, pushes each slot’s CardRecord PDA (11) into the remaining accounts, and only appends the user/vault token accounts when `currency == Token`. The handler queries devnet RPC for an existing `pack_session` PDA before reserving new cards so wallets can’t start a second pack while one is still pending.
- `GET /program/session/pending?wallet=<pubkey>` → returns the active SessionMirror (if any): slot lineup (rarity + template_id via MintRecords), raw asset ids, provably-fair hashes, and remaining countdown seconds so clients can resume mid-pack. If an on-chain pack session exists but SQLite lacks the mirror (e.g., user refreshed before we wrote it), the handler now reads the pack_session + card_record accounts directly, rehydrates the SessionMirror, and re-reserves those MintRecords before responding.
- `GET /program/session/pending?wallet=<pubkey>` → returns the active SessionMirror (if any): slot lineup (rarity + template_id resolved from MintRecords), raw asset ids, provably-fair hashes, and the remaining countdown seconds. Gacha calls this on connect to resume the reveal UI after a refresh.
- Claim flow (single-shot disabled):
  - `POST /program/claim/batch_flow` → builds a sequence of per-card (1–2 max) claim txs plus a finalize tx (MultiTxResponse.txs). Send sequentially.
  - `POST /program/claim/test3` → builds a single tx using on-chain `claim_pack_batch3` (exactly 3 cards) for benchmarking.
  - Legacy `claim/build` endpoint is disabled (returns 400).
  - Claim transactions include card_records then core_assets; no SPL token accounts are needed.
- `POST /program/expire/build` → builds an `expire_session` transaction that the wallet signs once the 1-hour window has elapsed. It restores each CardRecord to Available, updates the mirror row, and clears the on-chain `pack_session` PDA so the user can buy a new pack.
- `POST /program/sellback/build` → builds sellback instruction, resets MintRecords to available; returns `tx_b64` + `tx_v0_b64` + `recent_blockhash`. SPL token accounts are appended only when the session used the Token currency.
- `GET /profile/{wallet}` → Helius `getAssetsByOwner` with optional collection filter.
- Marketplace: `GET /marketplace/listings`, `POST /marketplace/list/build`, `POST /marketplace/fill/build`, `POST /marketplace/cancel/build`.
- Admin: `GET /admin/inventory/rarity`, `GET /admin/inventory/assets`, `GET /admin/sessions`, `POST /admin/session/settle`, `POST /admin/inventory/refresh` (Helius sync that repopulates MintRecords + statuses), `POST /admin/sessions/force_expire` (signs and sends the on-chain `admin_force_expire` instruction to return all reserved cards to the vault PDA and mark SessionMirrors expired), `POST /admin/sessions/force_close` (admin-signed, calls the new on-chain `admin_force_close_session` to close a wallet’s pack_session regardless of state and free card records). `GET /admin/sessions` accepts optional `page` / `page_size` query params and returns `{items,total,page,page_size}` when paging is requested (legacy behavior = full list).
- Diagnostics/repair: `GET /admin/inventory/reserved` (MintRecords whose status != available), `GET /admin/sessions/diagnostic` (per-session view showing whether the pack_session PDA exists plus each card’s current status/owner), and `POST /admin/inventory/unreserve` (sets every non-available MintRecord back to `available` and marks pending/settled SessionMirrors as expired).
- `GET /pricing/rarity` → returns static rarity -> lamports mapping.

## Scripts / pipelines
- `scripts/import_card_templates.py` – ingests the template CSV into the configured DB. It now accepts either `template_id` or `token_id` columns; when running from repo root set `DATABASE_URL=sqlite:///backend/mochi.db` so the sqlite path resolves correctly.
- `nft_pipeline/` (peer repo) – converts the Mega Evolution CSV into hosted PNG/JSON pairs under `nft/img|metadata/<collection>/<token_id>`, uploads to `/var/www/mochi-assets/nft`, and produces a manifest consumed by the minter/update scripts.
- `scripts/mint_and_deposit.ts` – canonical MPL Core minter + `deposit_card` caller. Reads `CORE_TEMPLATE_CSV` (defaults to `../nft_pipeline/data/mega-evolutions.csv`), points to `CORE_METADATA_BASE` (defaults to `https://getmochi.fun/nft/metadata/mega-evolutions`), and supports `CORE_TEMPLATE_OFFSET` / `CORE_TEMPLATE_LIMIT` envs for batching. Requires `npx ts-node -P tsconfig.scripts.json`.
- Legacy helpers (`mint_core_from_csv.py`, `deposit_core_assets.py`) remain for reference but the TS script above + nft_pipeline flow is what we actually use now.

## Notes
- `admin/inventory/refresh` paginates Helius `getAssetsByOwner` 100/page until depleted and stamps each MintRecord with rarity/template data by looking up `CardTemplate`. Rarity lookups are normalized (spaces/underscores removed + lowercased) so CSV rows like “Double rare” map cleanly onto runtime rarities such as `DoubleRare`. If multiple Core assets exist for the same template (intentional doubles) you’ll see >1 MintRecord per template_id.
- The transaction builder always includes the MPL Core program id alongside token/system programs so CPI helpers can transfer/burn assets. `build_open_pack_ix` now pushes just the 11 CardRecord PDAs (plus optional SPL token ATAs when `currency == Token`), while claim/sell-back/admin-force instructions append the Core asset accounts after the CardRecords before any optional token accounts.
- Inventory counts shown in the admin UI are purely what Helius reports for the vault PDA, so they’ll match whatever is actually sitting in custody.

## TODOs / extensions
- SPL/USDC path and price feeds remain TODO; RPC validations added for CardRecord and Listing seller discovery.
- Persist server_seed rotation + history for audits.
- Add auth for admin endpoints and session settlement.
- Add oracles/pricing for rarity values and SOL/USDC splits.
- Return fully assembled VersionedTransaction with blockhash fetched server-side once signing strategy is finalized.
```

## mcp_time.md (docs/mcp_time.md)
```markdown
# MCP Time Server Setup

The time MCP server provides current time and timezone conversion tools. Use it to keep logs in ISO-8601 and avoid stale timestamps.

## Install (pip fallback)
We cloned the reference at `tmp_mcp_servers/src/time`. For a proper install:
1) Install venv + pip (if needed): `sudo apt-get install -y python3.13-venv python3-pip`
2) Create a virtualenv: `python3 -m venv ~/.venvs/mcp-time && source ~/.venvs/mcp-time/bin/activate`
3) Install: `pip install mcp-server-time`
4) Start the server:
```bash
~/.venvs/mcp-time/bin/python -m mcp_server_time
```

If you prefer `uv`:
```bash
uvx mcp-server-time
```

## Configure clients
- VS Code / Claude / Zed: add MCP server entry named `time`:
```json
{
  "mcp": {
    "servers": {
      "time": { "command": "python", "args": ["-m", "mcp_server_time"] }
    }
  }
}
```

## Using the tools
- `get_current_time(timezone)` → returns ISO timestamp for the IANA timezone.
- `convert_time(source_timezone, time, target_timezone)` → converts HH:MM between zones.

## Current timestamp
- UTC anchor: `2025-11-25T00:14:10+00:00`
- Singapore (GMT+8) anchor: `2025-11-25T08:17+08:00`
Use these as the latest anchors for log entries until the MCP time server is running.
```

## MIGRATION_V2.md (docs/MIGRATION_V2.md)
```markdown
# Mochi V2 Migration (Treasury Transfer Model)

## Mint + Supply
- **Mint:** `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv` (decimals=6).
- **Supply:** 1,000,000,000 minted to master key `Dy2b6bzpX9XYLUowS4BgYiYEHrtqrsD895zxddQvLH1M` (keys under `keys/allocation/`, gitignored). Master ATA `B6uZjLMHGMooQpYf4LmZv729Mq8knniDLsMeRsdhDkci` now sits at 0 after distribution.
- Script: `scripts/deploy_mochi_v2_distribution.py` (summary at `scripts/deploy_mochi_v2_distribution.latest.json`). RPC used: Helius devnet.

## Allocation wallets
- **team_locked.json** – `AnEnfEhCVuPoJKssfgmBQrRVyrMv7XbC6UPNKybwhBts`, ATA `CZPzTEKDMNM3aPEmQ16hNMobzXMSC6vzPKcw7AqUmGem` → **300,000,000** (funded in first TGE run; sig not captured, see summary for final balance).
- **community_master.json** – `5CQgvbRy5HHXKBWa1Z8HcjSqsMjgqJG95eQ2bXZuMRKH`, ATA `5bDb2peW1VRPfuuQ3TeR6sPBCCZxSdrsUNVCnXg66yGx` → **390,000,000** after sending 10M to admin (see Ops funding below).
- **presale_distributor.json** – `5TPjayvy3ZfVYZhDqvVgrYBgX1NMJ83EMHQ5t111uxpr`, ATA `GpHdcarzt3Qhmq1YK79CJaZvm3mgv2zkVbPQszdNgiu5` → **100,000,000** (initial TGE run; sig not captured).
- **liquidity_reserve.json** – `49jd4BCkkVeHic2hYvCyiT9aoxxshNZgbSwSTJtHovie`, ATA `HGMmNbBruM9Za79hCaQeNrbJx8E1AD2AHuQLaNLxTq1A` → **100,000,000** (tx `3CeZc45dqWRrTNxnwb8itm19WdaDtzxZLWEuJ6LKRiriyBfP9rCNXnKrDdUoKao1dtRejW1Bf4nwMNKyp4wNMy46`).
- **treasury_reserve.json** – `9oa4LnNRt62gKyb6xZaL1Z8Ynxra5Q4k511F6WkACTKy`, ATA `3oYGxsK9X2D84Uoz5zpehPd7ByC8rayq4PbGFtCwVNMF` → **100,000,000** (tx `4DZzx5xDxL4A1LMxTkxZVcqJD4ajQx9hJ3YYHTjM2U5MsfUaUwcW5riwFjsNJoPC636uYgz5iWq4Y5M8vAnG62Fg`).

## Ops funding
- **Server admin (dev authority)**: `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs`, ATA `831fnahUncbMNznw79BtqAbsKGvvDZ2HefEhmQrv8CqW` funded with **10,000,000** from `community_master.json` (tx `2PyZQTPD9ZudDmsiQpJtPGMr1JfJX44YriSJtopQ5w7aYLXQNRNhLJFuKcB1YMny6VKuHvMwymAM48J4hde61pNv`). This ATA powers recycle + pack rewards.

## On-chain reward config
- `set_reward_config` set to `reward_per_pack = 0`, `mochi_mint = GS99...` (sig `66vYeQwa8UKjHC7juUyqqBRviAUmvqt883QLvxX2KNqbt92igzT6p43RrgtiBTSFye5t4tX9tB56TUnmzeD3Kv79`). PDA minting is **disabled**; rewards flow via admin treasury transfers.

## Notes
- Allocation keypairs live under `keys/allocation/` (ignored by git); keep backups before rotating.
- Old V1 mint `2iL86t...` is deprecated; frontend/backend envs now point to the V2 mint above.
```

## GACHA_OPERATIONS.md (docs/archive_v1/GACHA_OPERATIONS.md)
```markdown
# Gacha Operations Guide

This doc explains how the pack (gacha) flow works, what needs to be configured, and how to troubleshoot inventory/reward issues.

## High-level flow
1) Frontend calls `POST /program/v2/open/build` to build the open transaction.
2) User signs and sends the open transaction (payment + session creation + on-chain MOCHI reward mint).
3) Frontend calls `POST /program/v2/open/confirm` with the signature; backend mirrors on-chain session to DB (legacy off-chain reward hook is gated by `ENABLE_LEGACY_OFFCHAIN_REWARDS` and defaults to off; on-chain reward is authoritative).
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
- `/program/v2/open/confirm`: Waits for tx confirmation, mirrors session + CardRecords to DB. Off-chain reward hook runs only when `ENABLE_LEGACY_OFFCHAIN_REWARDS` is enabled; otherwise rely solely on on-chain reward.
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
- `ADMIN_ADDRESS`, `ADMIN_KEYPAIR_PATH` (must match; used for admin endpoints).
- `ENABLE_LEGACY_OFFCHAIN_REWARDS` (default `false`; when `true`, enables the legacy MOCHI mint hook in `/program/v2/open/confirm`).
- `MOCHI_TOKEN_MINT`, `MOCHI_TOKEN_DECIMALS`, `MOCHI_PACK_REWARD` (legacy; only used when legacy rewards are enabled).
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
```

## agent_anchor.md (docs/agent_anchor.md)
```markdown
# Anchor Program – mochi_v2_vault
Program ID (devnet): `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`

## PDAs
- **VaultState**: seeds `['vault_state']`
- **VaultAuthority**: seeds `['vault_authority', vault_state]`
- **CardRecord**: seeds `['card_record', vault_state, core_asset]`
- **PackSession**: seeds `['pack_session', vault_state, user]`
- **Listing**: seeds `['listing', vault_state, core_asset]`

## Accounts
- **VaultState**
  - admin: Pubkey
  - vault_authority: Pubkey (PDA treasury/escrow)
  - vault_authority_bump: u8
  - pack_price_sol / pack_price_usdc: u64
  - buyback_bps: u16 (90% default)
  - claim_window_seconds: i64 (3600)
  - marketplace_fee_bps: u16 (200)
  - core_collection: Option<Pubkey>
  - usdc_mint: Option<Pubkey>
- **CardRecord**
  - vault_state
  - core_asset
  - template_id: u32
  - rarity: enum
  - status: enum (Available/Reserved/UserOwned/RedeemPending/Burned/Deprecated)
  - owner
- **PackSession**
  - user
  - currency: enum (Sol/Token)
  - paid_amount: u64
  - created_at / expires_at
  - card_record_keys: [Pubkey; 11]
  - state: enum (Uninitialized/PendingDecision/Accepted/Rejected/Expired)
  - client_seed_hash: [u8; 32]
  - rarity_prices: Vec<u64>
- **Listing**
  - vault_state
  - seller
  - core_asset
  - price_lamports
  - currency_mint: Option<Pubkey>
  - status: enum (Active/Filled/Cancelled/Burned/Deprecated)

## Instructions
- `initialize_vault(pack_price_sol, pack_price_usdc, buyback_bps, claim_window_seconds, marketplace_fee_bps, core_collection, usdc_mint)`
- `deposit_card(core_asset, template_id, rarity)`
  - Admin-only; marks CardRecord Available, owner=vault_authority.
- `open_pack_start(currency, client_seed_hash, rarity_prices)`
  - Collects payment, reserves 11 CardRecords (remaining accounts), writes PackSession.
- `claim_pack()`
  - Legacy single-shot claim (not used in prod); marks all cards UserOwned and session Accepted.
- `claim_pack_batch()`
  - Batch claim for 1–2 cards (to avoid heap OOM); transfers Core assets to user, marks cards UserOwned; session stays PendingDecision.
- `claim_pack_batch3()`
  - Benchmark/test instruction that claims exactly 3 cards in one tx (minimal logging).
- `finalize_claim()`
  - After all cards are UserOwned, sets session Accepted (used after multiple batch claims).
- `sellback_pack()`
  - PendingDecision + not expired; pays out buyback, resets CardRecords, session Rejected.
- `expire_session()`
  - Anyone; if expired PendingDecision, resets CardRecords, state=Expired.
- `admin_force_expire()`
  - Admin-only; bypasses the one-hour wait and forcibly resets Reserved CardRecords + marks the PackSession Expired (used by the backend “force clear sessions” action).
- `admin_force_close_session()`
  - Admin-only; ignores PackSession state, frees all passed CardRecords back to `Available` with owner = vault_authority, zeroes the session, and closes the pack_session PDA to the admin signer. Pass the 11 CardRecord PDAs as remaining accounts.
- `list_card(price_lamports, currency_mint)`
  - Moves card into vault escrow, creates Listing Active.
- `cancel_listing()`
  - Seller-only; returns card, Listing Cancelled.
- `fill_listing()`
  - Transfers payment (2% fee), transfers card to buyer, Listing Filled.
- `redeem_burn()`
  - User burns/redeems a Core asset; marks CardRecord Burned (Core burn CPI still TODO).
- `admin_migrate_asset(destination)`
  - Admin-only; emergency move of a Core asset to a destination, marks Deprecated (Core transfer CPI still TODO).
- `deprecate_card()`
  - Admin-only; mark CardRecord Deprecated to keep it out of packs.

## CPI hooks / TODOs
- Metaplex Core CPI transfer/burn wired via TransferV1/BurnV1 with vault_authority seeds; remaining account order matters for pack flows.
- USDC path uses SPL transfers with mint/account checks; SOL path uses system transfer. The program now pulls the SPL token accounts from the `remaining_accounts` slice (after the 11 card + 11 asset entries) so SOL purchases no longer need dummy token ATAs.

## Custody expectations
- `open_pack_start` only needs the 11 CardRecord PDAs in its remaining accounts (plus optional SPL token accounts in the extras tail when `currency == Token`). `claim_pack` / `sellback_pack` still require the 22-entry layout: first 11 CardRecords, next 11 Core asset accounts in matching slot order; after that come the optional SPL token accounts for the Token currency path.
- Marketplace instructions include `core_asset` + `mpl_core_program` and use vault_authority PDA as signer for custody moves.

## Sizes
Stored in structs via `SIZE` constants for PDA allocation.

## Devnet seeding (Core mint + deposit)
- Script: `scripts/mint_and_deposit.ts` (Umi `createV1` + Anchor `deposit_card`).
- Inputs: `CORE_TEMPLATE_CSV` (defaults to `../nft_pipeline/data/mega-evolutions.csv`) and `CORE_METADATA_BASE` (defaults to `https://getmochi.fun/nft/metadata/mega-evolutions/<token_id>.json`).
- Run: `CORE_TEMPLATE_OFFSET=0 CORE_TEMPLATE_LIMIT=40 TS_NODE_TRANSPILE_ONLY=1 npx ts-node -P tsconfig.scripts.json scripts/mint_and_deposit.ts` (set `SOLANA_RPC` if not devnet). Use the offset/limit envs to batch when minting large sets.
- Result: Core assets are minted straight into the vault PDA (`FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g`) and each gets a CardRecord (`card_record` PDA).
- Current devnet vault PDAs: `vault_state = ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d`, `vault_authority = FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g`.
```

