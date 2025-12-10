# Mainnet Deployment

Read this alongside `PROJECT_CONTEXT.md` and `TECH_MANUAL.md` before switching clusters.

## Config Checklist
- Backend `.env`: set `SOLANA_RPC`/`HELIUS_RPC_URL` to mainnet, `PROGRAM_ID` for the deployed `mochi_v2_vault`, `MOCHI_TOKEN_MINT` + `MOCHI_TOKEN_DECIMALS`, `MOCHI_PACK_REWARD` (whole tokens), `ADMIN_KEYPAIR_PATH`, `TREASURY_WALLET`/`PLATFORM_WALLET`, `CORE_COLLECTION_ADDRESS`, `USDC_MINT`, `SERVER_SEED`, `DATABASE_URL`, and `POKEMON_PRICE_TRACKER_API_KEY` (production key). Keep `pokemon_price_api` pointed at the live endpoint.
- Frontend `.env.local`: `NEXT_PUBLIC_SOLANA_RPC`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_VAULT_AUTHORITY`, `NEXT_PUBLIC_MOCHI_TOKEN_MINT`, `NEXT_PUBLIC_MOCHI_TOKEN_DECIMALS`, `NEXT_PUBLIC_USDC_MINT`, and seed-sale envs if used.
- IDL: rebuild the Anchor program after deploy and copy the updated IDL to `anchor-program/idl/mochi_v2_vault.json` (and any generated clients).

## Reward Vault (Pack Reward)
- PDAs (devnet reference): `vault_state = ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d`, `vault_authority = FKALjGXodzs1RhSGYKL72xnnQjB35nK9e6dtZ9fTLj3g`. On mainnet, derive with `findProgramAddressSync([\"vault_state\"], PROGRAM_ID)` and `findProgramAddressSync([b\"vault-authority\", vault_state], PROGRAM_ID)`.
- Reward vault ATA = ATA for `MOCHI_TOKEN_MINT` owned by `vault_authority`. Create if missing:
  - `solana config set --url <MAINNET_RPC>`
  - `spl-token create-account <MOCHI_TOKEN_MINT> --owner <VAULT_AUTHORITY>`
- Fund the vault from the admin/minter keypair:
  - `spl-token transfer <MOCHI_TOKEN_MINT> 50000 <REWARD_VAULT_ATA> --owner <ADMIN_KEYPAIR_PATH> --fund-recipient`
  - 50,000 tokens covers 500 packs at 100 MOCHI each; adjust as needed.
- Ensure `set_reward_config` is set to `reward_per_pack = 100 * 10^decimals` and rewards enabled before go-live.

## Price Oracle
- Set `POKEMON_PRICE_TRACKER_API_KEY` in the backend environment (no frontend calls should hit the external API).
- Verify the key once:
  - `cd backend && source .env && python scripts/debug_price_api.py`
  - Expected: `API Alive: <card> = $<price>`
- The background fetcher refreshes every ~15 minutes on startup. For a manual refresh, call `POST /pricing/fetch` on the backend.
