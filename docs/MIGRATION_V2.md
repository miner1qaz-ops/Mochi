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
