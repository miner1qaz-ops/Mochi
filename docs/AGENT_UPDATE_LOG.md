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
