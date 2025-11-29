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
- Nginx installed and configured `/etc/nginx/sites-available/mochi` to proxy `mochims.fun`/`www` to frontend (127.0.0.1:3000) and `/api/` to backend (0.0.0.0:8000); config enabled and reloaded.
- Added systemd services:
  - `mochi-backend.service` (uvicorn on 0.0.0.0:8000, uses `backend/.env`).
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
- Nginx HTTPS enabled via Certbot (`certbot --nginx -d mochims.fun -d www.mochims.fun`); HTTP now redirects to HTTPS. Cert/key at `/etc/letsencrypt/live/mochims.fun/`; auto-renew via systemd timer.
- Git repo initialized in `~/mochi`; branch renamed to `main`; remote set to `git@github.com:miner1qaz-ops/Mochi.git`.
- `.gitignore` expanded to exclude env files, build artifacts, Python venvs, `.anchor/`, `target/`, and `anchor-program/keys/` (key JSONs left untracked). Two commits: `Initial commit`, `Add key directory to gitignore`.
- Git identity set locally to `user.name=miner1qaz`, `user.email=miner1qaz@gmail.com`.
- GitHub SSH key to authorize (public): `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEu4UWIk36y7OeNFcen61lb8+KiRQFEbvyCBv+AyqtV3 miner1qaz@gmail.com`. Add in GitHub Settings → SSH keys, then push with:
  ```
  cd ~/mochi
  ssh -T git@github.com          # should succeed after key is added
  git push -u origin main
  ```
- Current services: Next prod server on 127.0.0.1:3000, FastAPI on 0.0.0.0:8000, nginx proxying `/` → 3000 and `/api/` → 8000.

## 2025-11-26T04:46:00Z – Codex
- Homepage hero rebuilt with a glass desk + fanned meg_web card backs, hover tilt/rotation with pointer tracking, and mobile rail layout; CTA buttons now glow with neon bloom and glass outlines.
- Added reusable styles in `frontend/app/globals.css` (`cta-primary`, `cta-ghost`, `glass-surface`, `glass-chip`, `hero-card` hover variables) plus an on-page style guide listing classes/props for card hover and CTA glow.
- Logged UX changes in `docs/UX_CHANGES.md`; hero note clarifies placeholder art stays on `public/card_back.png` until final assets are ready.

## 2025-11-26T13:33:13+08:00 – Codex
- Fixed the mint/deposit toolchain: corrected Anchor client init, pinned IDL usage, and switched Core minting to Umi `createV1` (proper signer wiring).
- Ran `scripts/mint_and_deposit.ts` against devnet (program `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`), seeding 5 Core assets to `vault_authority` PDA `FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g` with CardRecords.
- Minted asset IDs: `9stz7SjNZ9x3cbAnzxXiQU6Lm2Sy9pLn2o23N5LKDDH`, `3Z34WbismuWCT62gfSMk2HxtQXdmUnXMBNVAeHtZbB7d`, `CoKncBYTBAviBEQH6BwbMUqM7pPzaQYL5mt2d9kYds5m`, `EcBW3xZP3wQDeS7ALxneQ1GKgivF7fBcx2gfPCSZnduE`, `2jkQE5pCFEGVvs8q6yrzz5sT8KszJpwKGMYuLkTFtrbB` (metadata hosted at `https://mochims.fun/assets/meg_web/<id>.json`).
- Script now reads templates from `frontend/public/data/meg_web_expanded.csv`; rerun with `TS_NODE_TRANSPILE_ONLY=1 npx ts-node -P tsconfig.scripts.json scripts/mint_and_deposit.ts` (env: `SOLANA_RPC`, optional `USDC_MINT`).

## 2025-11-26T18:42:17Z – Codex
- Removed the frontend wallet gate on `/admin`; dashboard now loads for everyone while we’re on devnet. We’ll restore the `ADMIN_ADDRESS` check before mainnet migration.
- Admin panel still fetches live data via `/admin/inventory/rarity`, `/admin/sessions`, `/admin/inventory/assets`, and the Helius refresh endpoint, so team members can monitor inventory without connecting a wallet.

## 2025-11-26T19:45:00Z – Codex
- Added standalone `~/nft_pipeline` toolkit for NFT asset automation: fetch cards from a TCG API (`scripts/fetch_tcg.ts`), generate PNG/JSON pairs per `COLLECTION_SLUG`, upload to local or S3 hosting, emit a manifest enriched with `image_url` + `source_id`, and mint/update on-chain via Metaplex scripts.
- Metadata/images now live under `nft/{img|metadata}/{collection_slug}/{token_id}` so multiple drops can share the same repo.
- Upload script produces manifest entries (array of objects) and Solana scripts consume that manifest; README documents the full flow (fetch → generate → upload → update/mint) plus env variables for TCG + hosting.

## 2025-11-27T07:11:49+08:00 – Codex
- Served the new asset pipeline by adding an nginx alias for `/nft/` → `/var/www/mochi-assets/nft`; `https://mochims.fun/nft/img|metadata/...` now resolves for wallets/explorers (Solscan caches will refresh automatically).
- Updated `scripts/mint_and_deposit.ts` to read the nft_pipeline CSV (`CORE_TEMPLATE_CSV`), point to the hosted metadata base, and support `CORE_TEMPLATE_OFFSET` / `CORE_TEMPLATE_LIMIT` batching. Ran it across devnet (in chunks) to mint & deposit the full Mega Evolution set (188 distinct templates, 196 Core assets because six templates have intentional doubles) into the vault PDA `FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g`.
- Imported the Mega Evolution CSV into `backend/mochi.db` via `scripts/import_card_templates.py` (now detects `token_id` columns and respects `DATABASE_URL`) so the admin UI can enrich cards with name/rarity.
- Refreshed backend inventory: `/admin/inventory/refresh` now paginates Helius `getAssetsByOwner`, infers template_id from the metadata URI, and stamps rarity/owner on MintRecords. Clearing/reloading MintRecords yields the current 196 Core assets (8 duplicates across templates 1/2/3/41/77/152).
- Docs updated (`agent_backend`, `agent_anchor`, `agent_frontend`, `AGENT_GUIDE`) to reflect the new nft_pipeline flow, nginx hosting path, mint/deposit script, and admin refresh behavior.

## 2025-11-27T08:06:00+08:00 – Codex
- Reran the full mint/deposit pipeline to seed a second copy of the entire Mega Evolution roster (4 × `CORE_TEMPLATE_OFFSET` batches covering 0–188). Result: vault PDA now holds **400** Pokémon cards (196 unique template IDs × 2 copies, including the earlier duplicates).
- Minted an additional Energy set (templates 189–196) so there are two of each basic Energy; metadata continues to live under `https://mochims.fun/nft/metadata/mega-evolutions/189-196.json`.
- Refreshed backend inventory (`curl -X POST http://127.0.0.1:8000/admin/inventory/refresh`), which now reports `{"Energy":8}` per set and **400 total MintRecords** (`curl /admin/inventory/assets | jq 'length'`).
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

## 2025-11-27T13:00:00+08:00 – Codex
- Added backend diagnostics endpoints (`GET /admin/sessions/diagnostic`, `GET /admin/inventory/reserved`) plus a repair endpoint `POST /admin/inventory/unreserve` that flips any non-available MintRecords back to the vault and marks pending/settled sessions as expired.
- Surfaced those diagnostics and a new “Unreserve all” button in the admin UI so you can inspect/clear stuck cards before retrying a pack buy.
- Restarted backend/frontends and updated docs accordingly.

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

## 2025-11-27T20:05:00+08:00 – Codex
- Added `/program/expire/build` so wallets can sign an `expire_session` instruction the moment the 1h window lapses; the frontend now shows an **Expire session** button next to Claim/Sell when the countdown hits zero.
- Fixed both the user and admin force-expire flows by marking `vault_authority` writable in the CPI builders, and updated the resume/backfill logic so pending sessions with missing DB rows are re-created automatically.
- Rebuilt the frontend and restarted both services after the changes.

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
