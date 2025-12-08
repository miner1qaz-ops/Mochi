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
