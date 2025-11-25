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
  - Requires PendingDecision + not expired; marks cards UserOwned and session Accepted.
- `sellback_pack()`
  - PendingDecision + not expired; pays out buyback, resets CardRecords, session Rejected.
- `expire_session()`
  - Anyone; if expired PendingDecision, resets CardRecords, state=Expired.
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
- USDC path uses SPL transfers with mint/account checks; SOL path uses system transfer.

## Custody expectations
- Pack open/claim/sellback: remaining accounts must be 22 accounts: first 11 = CardRecord PDAs, next 11 = Core asset accounts in matching slot order.
- Marketplace instructions include `core_asset` + `mpl_core_program` and use vault_authority PDA as signer for custody moves.

## Sizes
Stored in structs via `SIZE` constants for PDA allocation.
