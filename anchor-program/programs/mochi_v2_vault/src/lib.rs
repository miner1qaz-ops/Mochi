use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use mpl_core::instructions::{BurnV1CpiBuilder, TransferV1CpiBuilder};

declare_id!("Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx");

const PACK_CARD_COUNT: usize = 11;

#[program]
mod mochi_v2_vault {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        pack_price_sol: u64,
        pack_price_usdc: u64,
        buyback_bps: u16,
        claim_window_seconds: i64,
        marketplace_fee_bps: u16,
        core_collection: Option<Pubkey>,
        usdc_mint: Option<Pubkey>,
    ) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.admin = ctx.accounts.admin.key();
        vault_state.vault_authority = ctx.accounts.vault_authority.key();
        vault_state.vault_authority_bump = ctx.bumps.vault_authority;
        vault_state.pack_price_sol = pack_price_sol;
        vault_state.pack_price_usdc = pack_price_usdc;
        vault_state.buyback_bps = buyback_bps;
        vault_state.claim_window_seconds = claim_window_seconds;
        vault_state.marketplace_fee_bps = marketplace_fee_bps;
        vault_state.core_collection = core_collection;
        vault_state.usdc_mint = usdc_mint;
        Ok(())
    }

    pub fn deposit_card(ctx: Context<DepositCard>, template_id: u32, rarity: Rarity) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );

        let record = &mut ctx.accounts.card_record;
        record.vault_state = ctx.accounts.vault_state.key();
        record.core_asset = ctx.accounts.core_asset.key();
        record.template_id = template_id;
        record.rarity = rarity;
        record.status = CardStatus::Available;
        record.owner = ctx.accounts.vault_authority.key();

        // NOTE: Real implementation should CPI-transfer Metaplex Core asset into the vault_authority PDA escrow.
        // Placeholder until Core CPI wiring is finalized.
        Ok(())
    }

    pub fn open_pack_start<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenPackStart<'info>>,
        currency: Currency,
        client_seed_hash: [u8; 32],
        rarity_prices: Vec<u64>,
    ) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let now = Clock::get()?.unix_timestamp;

        let (card_accounts, _asset_accounts, extra_accounts) =
            partition_pack_accounts(&ctx.remaining_accounts)?;
        msg!("open_pack_start rem len {}", ctx.remaining_accounts.len());
        for (i, ai) in ctx.remaining_accounts.iter().enumerate() {
            msg!("  rem[{}] = {}", i, ai.key);
        }
        let mut user_token: Option<Account<'info, TokenAccount>> = None;
        let mut vault_token: Option<Account<'info, TokenAccount>> = None;
        if currency == Currency::Token {
            require!(extra_accounts.len() >= 2, MochiError::MissingTokenAccount);
            user_token = Some(Account::try_from(&extra_accounts[0])?);
            vault_token = Some(Account::try_from(&extra_accounts[1])?);
        }

        // Payment handling (simplified). For SOL we move lamports; for tokens we debit from user token account.
        match currency {
            Currency::Sol => {
                let price = vault_state.pack_price_sol;
                require!(price > 0, MochiError::InvalidPrice);
                require!(
                    ctx.accounts.user.lamports() >= price,
                    MochiError::InsufficientFunds
                );
                invoke(
                    &system_instruction::transfer(
                        &ctx.accounts.user.key(),
                        &ctx.accounts.vault_treasury.key(),
                        price,
                    ),
                    &[
                        ctx.accounts.user.to_account_info(),
                        ctx.accounts.vault_treasury.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                )?;
            }
            Currency::Token => {
                let price = vault_state.pack_price_usdc;
                require!(price > 0, MochiError::InvalidPrice);
                let user_token = user_token.as_ref().ok_or(MochiError::MissingTokenAccount)?;
                let vault_token = vault_token
                    .as_ref()
                    .ok_or(MochiError::MissingTokenAccount)?;
                if let Some(mint) = vault_state.usdc_mint {
                    require_keys_eq!(user_token.mint, mint, MochiError::MintMismatch);
                    require_keys_eq!(vault_token.mint, mint, MochiError::MintMismatch);
                }
                let price = vault_state.pack_price_usdc;
                let cpi_accounts = Transfer {
                    from: user_token.to_account_info(),
                    to: vault_token.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                };
                let cpi_ctx =
                    CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
                token::transfer(cpi_ctx, price)?;
            }
        }

        let mut card_record_keys: [Pubkey; PACK_CARD_COUNT] = [Pubkey::default(); PACK_CARD_COUNT];

        let session = &mut ctx.accounts.pack_session;
        require!(
            matches!(
                session.state,
                PackState::Uninitialized
                    | PackState::Accepted
                    | PackState::Rejected
                    | PackState::Expired
            ),
            MochiError::SessionExists
        );
        session.user = ctx.accounts.user.key();
        session.currency = currency.clone();
        session.paid_amount = match currency {
            Currency::Sol => vault_state.pack_price_sol,
            Currency::Token => vault_state.pack_price_usdc,
        };
        session.created_at = now;
        session.expires_at = now + vault_state.claim_window_seconds;
        session.card_record_keys = card_record_keys;
        session.state = PackState::PendingDecision;
        session.client_seed_hash = client_seed_hash;
        session.rarity_prices = rarity_prices;

        // Validate + Reserve CardRecords in one pass
        for (idx, acc_info) in card_accounts.iter().enumerate() {
            let mut card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            require_keys_eq!(
                card_record.vault_state,
                ctx.accounts.vault_state.key(),
                MochiError::VaultMismatch
            );
            require!(
                card_record.status == CardStatus::Available,
                MochiError::CardNotAvailable
            );
            card_record_keys[idx] = acc_info.key();
            card_record.status = CardStatus::Reserved;
            card_record.owner = ctx.accounts.user.key();
        }
        Ok(())
    }

    pub fn claim_pack<'info>(ctx: Context<'_, '_, 'info, 'info, ResolvePack<'info>>) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now <= session.expires_at, MochiError::SessionExpired);

        let (card_accounts, asset_accounts, _extras) =
            partition_pack_accounts(&ctx.remaining_accounts)?;
        require!(
            asset_accounts.len() == PACK_CARD_COUNT,
            MochiError::InvalidCardCount
        );
        for i in 0..PACK_CARD_COUNT {
            let acc_info: &AccountInfo<'info> = &card_accounts[i];
            let mut card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            require!(
                card_record.status == CardStatus::Reserved,
                MochiError::CardNotReserved
            );
            require_keys_eq!(
                card_record.owner,
                ctx.accounts.user.key(),
                MochiError::Unauthorized
            );
            card_record.status = CardStatus::UserOwned;
            card_record.owner = ctx.accounts.user.key();
            let asset_info: &AccountInfo<'info> = &asset_accounts[i];
            transfer_core_asset(
                &asset_info,
                &ctx.accounts.vault_authority,
                &ctx.accounts.vault_authority, // payer = vault authority
                &ctx.accounts.user.to_account_info(),
                &ctx.accounts.vault_state.key(),
                ctx.accounts.vault_state.vault_authority_bump,
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.mpl_core_program.to_account_info(),
            )?;
        }

        session.state = PackState::Accepted;
        Ok(())
    }

    pub fn sellback_pack<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePack<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let vault_state = &ctx.accounts.vault_state;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now <= session.expires_at, MochiError::SessionExpired);

        let total_value: u64 = session.rarity_prices.iter().copied().sum();
        let payout = total_value
            .checked_mul(vault_state.buyback_bps as u64)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(MochiError::MathOverflow)?;

        let (card_accounts, asset_accounts, extra_accounts) =
            partition_pack_accounts(&ctx.remaining_accounts)?;
        require!(
            asset_accounts.len() == PACK_CARD_COUNT,
            MochiError::InvalidCardCount
        );

        match session.currency {
            Currency::Sol => {
                invoke(
                    &system_instruction::transfer(
                        &ctx.accounts.vault_treasury.key(),
                        &ctx.accounts.user.key(),
                        payout,
                    ),
                    &[
                        ctx.accounts.vault_treasury.to_account_info(),
                        ctx.accounts.user.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                )?;
            }
            Currency::Token => {
                require!(extra_accounts.len() >= 2, MochiError::MissingTokenAccount);
                let user_token: Account<TokenAccount> = Account::try_from(&extra_accounts[0])?;
                let vault_token: Account<TokenAccount> = Account::try_from(&extra_accounts[1])?;
                if let Some(mint) = vault_state.usdc_mint {
                    require_keys_eq!(user_token.mint, mint, MochiError::MintMismatch);
                    require_keys_eq!(vault_token.mint, mint, MochiError::MintMismatch);
                }
                let cpi_accounts = Transfer {
                    from: vault_token.to_account_info(),
                    to: user_token.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                };
                let vault_key = vault_state.key();
                let seeds = &[
                    b"vault_authority",
                    vault_key.as_ref(),
                    &[vault_state.vault_authority_bump],
                ];
                let signer = &[&seeds[..]];
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                );
                token::transfer(cpi_ctx, payout)?;
            }
        }

        for acc_info in card_accounts.iter() {
            let mut card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            card_record.status = CardStatus::Available;
            card_record.owner = ctx.accounts.vault_authority.key();
            // Assets remain in vault authority escrow; no transfer needed
        }

        session.state = PackState::Rejected;
        Ok(())
    }

    pub fn expire_session<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePack<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now > session.expires_at, MochiError::SessionNotExpired);

        let (card_accounts, _asset_accounts, _extras) =
            partition_pack_accounts(&ctx.remaining_accounts)?;
        for acc_info in card_accounts.iter() {
            let mut card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            card_record.status = CardStatus::Available;
            card_record.owner = ctx.accounts.vault_authority.key();
        }

        session.state = PackState::Expired;
        Ok(())
    }

    pub fn admin_force_expire<'info>(
        ctx: Context<'_, '_, 'info, 'info, AdminForceExpire<'info>>,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        let session = &mut ctx.accounts.pack_session;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );

        let (card_accounts, _asset_accounts, _extras) =
            partition_pack_accounts(&ctx.remaining_accounts)?;
        for acc_info in card_accounts.iter() {
            let mut card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            card_record.status = CardStatus::Available;
            card_record.owner = ctx.accounts.vault_authority.key();
        }

        session.state = PackState::Expired;
        Ok(())
    }

    pub fn admin_reset_session<'info>(
        ctx: Context<'_, '_, 'info, 'info, AdminResetSession<'info>>,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );

        // Optionally free any card records passed in remaining accounts.
        for acc_info in ctx.remaining_accounts.iter() {
            if let Ok(mut card_record) = Account::<CardRecord>::try_from(acc_info) {
                if card_record.vault_state == ctx.accounts.vault_state.key() {
                    card_record.status = CardStatus::Available;
                    card_record.owner = ctx.accounts.vault_authority.key();
                }
            }
        }

        let session = &mut ctx.accounts.pack_session;
        require!(
            session.state != PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        session.state = PackState::Uninitialized;
        session.paid_amount = 0;
        session.created_at = 0;
        session.expires_at = 0;
        session.currency = Currency::Sol;
        session.card_record_keys = [Pubkey::default(); PACK_CARD_COUNT];
        session.client_seed_hash = [0u8; 32];
        session.rarity_prices = Vec::new();
        Ok(())
    }

    pub fn user_reset_session<'info>(
        ctx: Context<'_, '_, 'info, 'info, UserResetSession<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        require!(
            session.state != PackState::PendingDecision,
            MochiError::InvalidSessionState
        );

        for acc_info in ctx.remaining_accounts.iter() {
            if let Ok(mut card_record) = Account::<CardRecord>::try_from(acc_info) {
                if card_record.vault_state == ctx.accounts.vault_state.key() {
                    card_record.status = CardStatus::Available;
                    card_record.owner = ctx.accounts.vault_authority.key();
                }
            }
        }
        // Account will be closed to user via `close = user` attribute.
        Ok(())
    }

    pub fn list_card(
        ctx: Context<ListCard>,
        price_lamports: u64,
        currency_mint: Option<Pubkey>,
    ) -> Result<()> {
        let record = &mut ctx.accounts.card_record;
        require!(
            record.owner == ctx.accounts.seller.key()
                || record.owner == ctx.accounts.vault_authority.key(),
            MochiError::Unauthorized
        );
        require!(
            record.status == CardStatus::UserOwned || record.status == CardStatus::Available,
            MochiError::CardNotAvailable
        );

        record.status = CardStatus::Reserved;
        record.owner = ctx.accounts.vault_authority.key();
        // Transfer custody into vault authority escrow (if not already)
        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.accounts.vault_state.vault_authority_bump,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.core_asset = record.core_asset;
        listing.price_lamports = price_lamports;
        listing.currency_mint = currency_mint;
        listing.status = ListingStatus::Active;
        listing.vault_state = ctx.accounts.vault_state.key();
        Ok(())
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        require!(
            listing.status == ListingStatus::Active,
            MochiError::InvalidListingState
        );
        require_keys_eq!(
            listing.seller,
            ctx.accounts.seller.key(),
            MochiError::Unauthorized
        );

        let record = &mut ctx.accounts.card_record;
        require_keys_eq!(
            record.core_asset,
            listing.core_asset,
            MochiError::AssetMismatch
        );
        record.status = CardStatus::UserOwned;
        record.owner = ctx.accounts.seller.key();
        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.accounts.vault_state.vault_authority_bump,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;

        listing.status = ListingStatus::Cancelled;
        Ok(())
    }

    pub fn fill_listing(ctx: Context<FillListing>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        require!(
            listing.status == ListingStatus::Active,
            MochiError::InvalidListingState
        );

        let fee_bps = ctx.accounts.vault_state.marketplace_fee_bps as u64;
        let fee = listing
            .price_lamports
            .checked_mul(fee_bps)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(MochiError::MathOverflow)?;
        let seller_amount = listing
            .price_lamports
            .checked_sub(fee)
            .ok_or(MochiError::MathOverflow)?;

        // SOL path only for now
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.buyer.key(),
                &ctx.accounts.vault_treasury.key(),
                fee,
            ),
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.vault_treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        invoke(
            &system_instruction::transfer(
                &ctx.accounts.buyer.key(),
                &ctx.accounts.seller.key(),
                seller_amount,
            ),
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let record = &mut ctx.accounts.card_record;
        require_keys_eq!(
            record.core_asset,
            listing.core_asset,
            MochiError::AssetMismatch
        );
        record.status = CardStatus::UserOwned;
        record.owner = ctx.accounts.buyer.key();
        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.accounts.vault_state.vault_authority_bump,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;

        listing.status = ListingStatus::Filled;
        Ok(())
    }

    pub fn redeem_burn(ctx: Context<RedeemBurn>) -> Result<()> {
        let record = &mut ctx.accounts.card_record;
        require_keys_eq!(
            record.owner,
            ctx.accounts.user.key(),
            MochiError::Unauthorized
        );
        burn_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_state.key(),
            ctx.accounts.vault_state.vault_authority_bump,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;
        record.status = CardStatus::Burned;
        Ok(())
    }

    pub fn admin_migrate_asset(ctx: Context<AdminMigrateAsset>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        let record = &mut ctx.accounts.card_record;
        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.destination.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.accounts.vault_state.vault_authority_bump,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;
        record.owner = ctx.accounts.destination.key();
        record.status = CardStatus::Deprecated;
        Ok(())
    }

    pub fn deprecate_card(ctx: Context<DeprecateCard>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        let record = &mut ctx.accounts.card_record;
        record.status = CardStatus::Deprecated;
        Ok(())
    }

    pub fn admin_force_close_session<'info>(
        ctx: Context<'_, '_, 'info, 'info, AdminForceClose<'info>>,
    ) -> Result<()> {
        // Admin-only override: closes pack_session regardless of state and frees card records.
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );

        // Reset card records passed in remaining accounts (best-effort)
        for acc_info in ctx.remaining_accounts.iter() {
            if let Ok(mut card_record) = Account::<CardRecord>::try_from(acc_info) {
                if card_record.vault_state == ctx.accounts.vault_state.key() {
                    card_record.status = CardStatus::Available;
                    card_record.owner = ctx.accounts.vault_authority.key();
                }
            }
        }

        // Zero out the pack_session; account will be closed to admin via the context.
        let session = &mut ctx.accounts.pack_session;
        session.state = PackState::Uninitialized;
        session.paid_amount = 0;
        session.created_at = 0;
        session.expires_at = 0;
        session.currency = Currency::Sol;
        session.card_record_keys = [Pubkey::default(); PACK_CARD_COUNT];
        session.client_seed_hash = [0u8; 32];
        session.rarity_prices = Vec::new();
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [b"vault_state"],
        bump,
        space = 8 + VaultState::SIZE,
    )]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA that holds custody/treasury authority (validated by seeds)
    #[account(
        seeds = [b"vault_authority", vault_state.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DepositCard<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: Core asset account (Metaplex Core asset), validated off-chain
    pub core_asset: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [b"card_record", vault_state.key().as_ref(), core_asset.key().as_ref()],
        bump,
        space = 8 + CardRecord::SIZE,
    )]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OpenPackStart<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        init,
        payer = user,
        seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()],
        bump,
        space = 8 + PackSession::SIZE,
    )]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// Treasury to receive SOL fees
    #[account(mut)]
    pub vault_treasury: SystemAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
    /// CHECK: mpl-core program id (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ResolvePack<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault_treasury: SystemAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
    /// CHECK: mpl-core program
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminForceExpire<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: user wallet (used for PDA derivation only)
    pub user: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault_treasury: SystemAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminResetSession<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: user wallet (used for PDA derivation only)
    pub user: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        close = user,
        seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminForceClose<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: user wallet (used for PDA derivation only)
    pub user: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        close = admin,
        seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UserResetSession<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        close = user,
        seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ListCard<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Core asset account (Metaplex Core), validated off-chain
    pub core_asset: UncheckedAccount<'info>,
    #[account(
        init,
        payer = seller,
        seeds = [b"listing", vault_state.key().as_ref(), card_record.core_asset.as_ref()],
        bump,
        space = 8 + Listing::SIZE,
    )]
    pub listing: Account<'info, Listing>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Core asset (Metaplex Core), validated off-chain
    pub core_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"listing", vault_state.key().as_ref(), card_record.core_asset.as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FillListing<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub seller: SystemAccount<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Core asset account (Metaplex Core), validated off-chain
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"listing", vault_state.key().as_ref(), card_record.core_asset.as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault_treasury: SystemAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RedeemBurn<'info> {
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Core asset account (Metaplex Core), validated off-chain
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminMigrateAsset<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: emergency destination (validated off-chain by admin authority)
    pub destination: UncheckedAccount<'info>,
    /// CHECK: Core asset account (Metaplex Core)
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [b"vault_authority", vault_state.key().as_ref()], bump = vault_state.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DeprecateCard<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"vault_state"], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
}

#[account]
pub struct VaultState {
    pub admin: Pubkey,
    pub vault_authority: Pubkey,
    pub pack_price_sol: u64,
    pub pack_price_usdc: u64,
    pub buyback_bps: u16,
    pub claim_window_seconds: i64,
    pub marketplace_fee_bps: u16,
    pub core_collection: Option<Pubkey>,
    pub usdc_mint: Option<Pubkey>,
    pub vault_authority_bump: u8,
    pub padding: [u8; 7],
}
impl VaultState {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 2 + 8 + 2 + 1 + 32 + 1 + 32 + 1 + 7;
}

#[account]
pub struct CardRecord {
    pub vault_state: Pubkey,
    pub core_asset: Pubkey,
    pub template_id: u32,
    pub rarity: Rarity,
    pub status: CardStatus,
    pub owner: Pubkey,
}
impl CardRecord {
    pub const SIZE: usize = 32 + 32 + 4 + 1 + 1 + 32;
}

#[account]
pub struct PackSession {
    pub user: Pubkey,
    pub currency: Currency,
    pub paid_amount: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub card_record_keys: [Pubkey; PACK_CARD_COUNT],
    pub state: PackState,
    pub client_seed_hash: [u8; 32],
    pub rarity_prices: Vec<u64>,
}
impl PackSession {
    pub const SIZE: usize =
        32 + 1 + 8 + 8 + 8 + (32 * PACK_CARD_COUNT) + 1 + 32 + 4 + 8 * PACK_CARD_COUNT;
}

#[account]
pub struct Listing {
    pub vault_state: Pubkey,
    pub seller: Pubkey,
    pub core_asset: Pubkey,
    pub price_lamports: u64,
    pub currency_mint: Option<Pubkey>,
    pub status: ListingStatus,
}
impl Listing {
    pub const SIZE: usize = 32 + 32 + 32 + 8 + 1 + 32 + 1; // currency_mint option + status
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    DoubleRare,
    UltraRare,
    IllustrationRare,
    SpecialIllustrationRare,
    MegaHyperRare,
    Energy,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum CardStatus {
    Available,
    Reserved,
    UserOwned,
    RedeemPending,
    Burned,
    Deprecated,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Currency {
    Sol,
    Token,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PackState {
    Uninitialized,
    PendingDecision,
    Accepted,
    Rejected,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ListingStatus {
    Active,
    Filled,
    Cancelled,
    Burned,
    Deprecated,
}

#[error_code]
pub enum MochiError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid card count")]
    InvalidCardCount,
    #[msg("Card not available")]
    CardNotAvailable,
    #[msg("Vault mismatch")]
    VaultMismatch,
    #[msg("Session already exists")]
    SessionExists,
    #[msg("Invalid session state")]
    InvalidSessionState,
    #[msg("Session expired")]
    SessionExpired,
    #[msg("Session not expired")]
    SessionNotExpired,
    #[msg("Card not reserved")]
    CardNotReserved,
    #[msg("Listing invalid state")]
    InvalidListingState,
    #[msg("Asset mismatch")]
    AssetMismatch,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Missing token account")]
    MissingTokenAccount,
    #[msg("Mint mismatch")]
    MintMismatch,
    #[msg("Core CPI error")]
    CoreCpiError,
}

fn partition_pack_accounts<'info>(
    accounts: &'info [AccountInfo<'info>],
) -> Result<(
    &'info [AccountInfo<'info>],
    &'info [AccountInfo<'info>],
    &'info [AccountInfo<'info>],
)> {
    require!(
        accounts.len() >= PACK_CARD_COUNT,
        MochiError::InvalidCardCount
    );
    let (card_slice, rest) = accounts.split_at(PACK_CARD_COUNT);
    if rest.len() >= PACK_CARD_COUNT {
        let (asset_slice, extras) = rest.split_at(PACK_CARD_COUNT);
        Ok((card_slice, asset_slice, extras))
    } else {
        Ok((card_slice, &[], rest))
    }
}

fn transfer_core_asset<'info>(
    asset: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    vault_state: &Pubkey,
    vault_bump: u8,
    system_program: &AccountInfo<'info>,
    mpl_core_program: &AccountInfo<'info>,
) -> Result<()> {
    let seeds = &[b"vault_authority", vault_state.as_ref(), &[vault_bump]];
    let signer = &[&seeds[..]];
    let mut builder = TransferV1CpiBuilder::new(mpl_core_program);
    builder
        .asset(asset)
        .payer(payer)
        .authority(Some(authority))
        .new_owner(new_owner)
        .system_program(Some(system_program));
    builder
        .invoke_signed(signer)
        .map_err(|_| MochiError::CoreCpiError.into())
}

fn burn_core_asset<'info>(
    asset: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    vault_state: &Pubkey,
    vault_bump: u8,
    system_program: &AccountInfo<'info>,
    mpl_core_program: &AccountInfo<'info>,
) -> Result<()> {
    let seeds = &[b"vault_authority", vault_state.as_ref(), &[vault_bump]];
    let signer = &[&seeds[..]];
    let mut builder = BurnV1CpiBuilder::new(mpl_core_program);
    builder
        .asset(asset)
        .authority(Some(authority))
        .payer(payer)
        .system_program(Some(system_program));
    builder
        .invoke_signed(signer)
        .map_err(|_| MochiError::CoreCpiError.into())
}
