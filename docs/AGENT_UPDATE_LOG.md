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

## 2025-01-30 – Codex
- Fixed Anchor program compilation errors (lifetimes, account contexts, system_program types) and added required `idl-build` feature to `programs/mochi_v2_vault/Cargo.toml`; `anchor build` now succeeds.
- `anchor idl build` still blocked by DNS failures fetching nightly toolchain (GitHub/rust-lang unreachable); SBF binary built successfully. Pending: rerun `anchor idl build --program-name mochi_v2_vault` once DNS is available to emit `target/idl/mochi_v2_vault.json`.

## 2025-01-31 – Codex
- Patched local `anchor-syn` (under `patches/anchor-syn`) to avoid `Span::source_file()` and use `CARGO_MANIFEST_DIR`, and pinned `proc-macro2 = 1.0.86` with `span-locations`; idl-build now works.
- Ran `anchor build` and `anchor idl build --program-name mochi_v2_vault` successfully; artifacts: `target/deploy/mochi_v2_vault.so`, `mochi_v2_vault-keypair.json`, `target/idl/mochi_v2_vault.json`.
