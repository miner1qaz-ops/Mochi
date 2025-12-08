# PROJECT_CONTEXT

## Tech Stack
- Frontend: Next.js 14 (App Router) + React 18, TypeScript, TailwindCSS 3, Framer Motion, Solana wallet adapter, Phaser mini-games.
- Backend: FastAPI 0.111 with SQLModel + SQLite (default `mochi.db`), Pydantic v2, Requests; Solana stack via `solders`, `solana`, `anchorpy`; Borsh-based tx builder.
- On-chain: Anchor program `mochi_v2_vault` (devnet ID `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`), Metaplex Core CPI, SPL Token/ATA programs. Seed-sale program `2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue`.
- Data: Card templates from CSVs in `frontend/public/data/`; NFT metadata served from `https://getmochi.fun/nft/...` (and `getmochi.fun`), mirrored in `nft_pipeline` outputs.

## Environment Variables (runtime-critical)
- Backend (`backend/.env`): `SOLANA_RPC`, `HELIUS_RPC_URL`, `ADMIN_ADDRESS`, `PLATFORM_WALLET`, `TREASURY_WALLET`, `CORE_COLLECTION_ADDRESS`, `USDC_MINT`, `SERVER_SEED`, `DATABASE_URL`, `ADMIN_KEYPAIR_PATH`, `MOCHI_TOKEN_MINT`, `MOCHI_TOKEN_DECIMALS`, `MOCHI_PACK_REWARD`, `RECYCLE_RATE`, `PROGRAM_ID`, `SEED_SALE_PROGRAM_ID`.
- Frontend (`frontend/.env.local`): `NEXT_PUBLIC_SOLANA_RPC`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_ADMIN_ADDRESS`, `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_VAULT_AUTHORITY`, `NEXT_PUBLIC_SEED_SALE_PROGRAM_ID`, `NEXT_PUBLIC_SEED_VAULT_TOKEN_ACCOUNT`, `NEXT_PUBLIC_MOCHI_TOKEN_MINT`, `NEXT_PUBLIC_MOCHI_TOKEN_DECIMALS` (optional).
- Tooling (docs): MCP time server command, dockerized Anchor toolchain, price oracle config at `price_oracle/config.json`.

## Key Addresses & Constants
- Mochi V2 mint: `GS99uG5mWq3YtENvdxDdkrixtez3vUvAykZWoqfJETZv` (decimals 6); admin treasury ATA `831fnahUncbMNznw79BtqAbsKGvvDZ2HefEhmQrv8CqW`; master authority `Dy2b6bzpX9XYLUowS4BgYiYEHrtqrsD895zxddQvLH1M`.
- Program IDs: gacha/marketplace `mochi_v2_vault = Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`; seed sale `2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue`; MPL Core `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`; SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`; ATA `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`.
- PDAs (devnet): gacha `vault_state = ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d`, `vault_authority = FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g`; marketplace `market_vault_state = mx1PX4zganVFtuneoc61jcuadctsUPk9UGbyhNnnLwT`, `market_vault_authority = CGhdCwqZx7zn6YNqASY6V4uxFZpegb1QDu5qnMNDKihd`; seed vault token account `9pSNuqZjx15rzc9mP4tvFGcZYJrczDtLMm6B19s3trY5`.
- Packs: registry in `backend/main.py` (`meg_web`/`mega_evolutions`, `phantasmal_flames`), `PACK_CARD_COUNT=11`, claim window 3600s.

## Current State (what’s live)
- Rewards/recycle use treasury transfers (no PDA minting): `MOCHI_PACK_REWARD` whole tokens per pack, paid from admin treasury ATA; on-chain `reward_per_pack` is 0.
- Recycle flow now guards against desync: backend confirms tx but always deducts virtual cards; any post-broadcast DB failure logs `CRITICAL_DESYNC` for manual repair.
- Pack V2 is the only supported flow: rare+ slots on-chain (CardRecords), low-tier stored as `VirtualCard` rows; buy/claim/sell/expire endpoints are V2-only (V1 routes return 410).
- Marketplace reads/writes on-chain listings via the marketplace PDAs; pricing overlays come from `PriceSnapshot` history.
- Seed sale program deployed to devnet with PDAs derived from `SEED_SALE_PROGRAM_ID`; backend builders return unsigned v0 transactions for contribute/claim.
- Services run via systemd + nginx per `docs/AGENT_UPDATE_LOG.md` (frontend 3000, backend 4000, nginx proxy /api).

## Active Bugs / Known Gaps
- Pricing/oracle ingestion is append-only but still relies on external fetch/import; live scraping from this host is flaky (pokemonTCG API blocks); data freshness depends on manual imports.
- Mainnet-hardening pending: collection/update-authority allowlist for deposits/listings not enforced; program trusts provided assets beyond CardRecord ownership.
- Metaplex Core burn/redemption flows remain TODO; marketplace emergency/rescue flows exist but full burn path is not finished.
- On-chain reward minting intentionally disabled; ensure admin treasury ATA remains funded or rewards will return `failed`.

## Recent Changes (high signal)
- Migrated to Mochi V2 mint (`GS99...`), treasury-transfer rewards, admin ATA funded 10M; envs updated accordingly.
- Split gacha vs marketplace PDAs and added emergency/rescue admin flows; marketplace builders now enforce canonical market vault.
- Pack V2 launched: rare+ only on-chain with virtual low-tier, recycle flow mints MOCHI from treasury; confirm-open auto-adds virtual cards and logs rewards.
- Pack reveal and profile views now use local pack art fallbacks (CSV-driven) so Phantasmal/Mega cards render correctly in openings/profiles; on-chain stock API now aliases rarity keys (IllustrationRare, SpecialIllustration, MegaHyper, etc.) to match UI expectations.
- Pack rewards confirmed: MOCHI token drops now land on-chain (env-driven treasury transfer), verified via devnet token account balances.
- Pricing 2.0: `PriceSnapshot` append-only with `market_price`/`direct_low`, fair-value/portfolio endpoints, merged Market + Pricing UI and `/market` API.
- Seed sale program deployed (devnet) with builders and PDAs; frontend widgets use backend builders for contribute/claim.
