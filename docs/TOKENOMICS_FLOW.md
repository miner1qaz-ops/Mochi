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
