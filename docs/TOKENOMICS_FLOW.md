# Tokenomics Flow

## Configuration
- On-chain: `set_reward_config` sets `VaultState.mochi_mint` + `reward_per_pack` (raw units). Current config: 100 MOCHI → `reward_per_pack = 100 * 10^MOCHI_TOKEN_DECIMALS`.
- Backend `.env`: `MOCHI_TOKEN_MINT`, `MOCHI_TOKEN_DECIMALS` (for UI/build-time), optional legacy `MOCHI_PACK_REWARD` fallback.
- Mint authority **must** be assigned to the vault authority PDA (`vault_authority = ["vault_authority", vault_state]`).

## Pack → Reward lifecycle (on-chain)
1) Build: Frontend calls `/program/v2/open/build`; backend prepends MOCHI ATA create ix if missing and returns `open_pack_v2` ix.
2) Transaction: User signs the tx that contains payment + session creation + CPI `mint_to` of `reward_per_pack` to their MOCHI ATA. If the reward CPI fails, the whole transaction reverts.
3) Confirm: Frontend posts `/program/v2/open/confirm`; backend only mirrors on-chain state (no extra mint) and returns the session + reward metadata.
4) Claim/sellback/expire continue as normal (`/program/v2/claim|sellback|expire/build` → sign → `/.../confirm`).

## Fallback / error handling
- Backend `maybe_spawn_pack_reward` now returns `status: "on_chain"` when a reward is configured on-chain. It only mints off-chain if no on-chain reward is set (best-effort; does not block pack flow).
- To disable rewards while debugging failures, set `reward_per_pack = 0` via `set_reward_config` (or remove the mint authority from the PDA). Re-enable by setting the raw amount again.
- ConstraintSeeds errors usually mean the wrong vault_authority PDA was passed; expected devnet PDA is `FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g` for `vault_state = ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d`.

## Recent changes (2025-12-06)
- Redeployed `mochi_v2_vault` on devnet (`Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`) with extra reward logging around `mint_to` so tx logs show reward config and mint success/failure.
- Reset on-chain reward config via `set_reward_config` (tx `Zd9K9Cea5z22cUMwJbgp9EfSEU3V3VK7XvQ7oTovrN85nPTgeXF9Yimm2k7KaUnEZghNVzn8XjAzzaUL2bQQU6B`): `mochi_mint = 2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT`, `reward_per_pack = 100_000_000` (100 MOCHI @ 6 dec), mint authority = vault PDA.
- Verified backend open builder already includes user MOCHI ATA (auto-creates if missing); pack opens now mint rewards on-chain in the same tx.
- VaultState on devnet now reflects the above config; if rewards stop, re-run `set_reward_config` or check that mint authority still equals the vault PDA.
