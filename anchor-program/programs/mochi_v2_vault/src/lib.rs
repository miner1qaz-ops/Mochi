use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke, program::invoke_signed, program_option::COption, system_instruction,
};
use anchor_lang::Discriminator;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};
use mpl_core::instructions::{BurnV1CpiBuilder, TransferV1CpiBuilder};
use std::io::Write;

declare_id!("Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx");

const PACK_CARD_COUNT: usize = 11;
const MAX_RARE_CARDS: usize = 3;
const GACHA_VAULT_SEED: &[u8] = b"vault_state";
const GACHA_VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
const MARKETPLACE_VAULT_SEED: &[u8] = b"market_vault_state";
const MARKETPLACE_VAULT_AUTHORITY_SEED: &[u8] = b"market_vault_authority";
const LISTING_SEED: &[u8] = b"listing";
const CARD_RECORD_SEED: &[u8] = b"card_record";

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
        mochi_mint: Option<Pubkey>,
        reward_per_pack: u64,
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
        vault_state.mochi_mint = mochi_mint;
        vault_state.reward_per_pack = reward_per_pack;
        Ok(())
    }

    pub fn initialize_marketplace_vault(
        ctx: Context<InitializeMarketplaceVault>,
        marketplace_fee_bps: u16,
        core_collection: Option<Pubkey>,
        usdc_mint: Option<Pubkey>,
    ) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.admin = ctx.accounts.admin.key();
        vault_state.vault_authority = ctx.accounts.vault_authority.key();
        vault_state.vault_authority_bump = ctx.bumps.vault_authority;
        vault_state.pack_price_sol = 0;
        vault_state.pack_price_usdc = 0;
        vault_state.buyback_bps = 0;
        vault_state.claim_window_seconds = 0;
        vault_state.marketplace_fee_bps = marketplace_fee_bps;
        vault_state.core_collection = core_collection;
        vault_state.usdc_mint = usdc_mint;
        vault_state.mochi_mint = None;
        vault_state.reward_per_pack = 0;
        Ok(())
    }

    /// Admin-configurable MOCHI reward mint + per-pack amount (raw units).
    pub fn set_reward_config(
        ctx: Context<SetRewardConfig>,
        mochi_mint: Pubkey,
        reward_per_pack: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.mochi_mint = Some(mochi_mint);
        vault_state.reward_per_pack = reward_per_pack;
        Ok(())
    }

    /// One-time migration to grow the VaultState account to the new size that includes MOCHI rewards.
    pub fn migrate_vault_state(
        ctx: Context<MigrateVaultState>,
        pack_price_sol: u64,
        pack_price_usdc: u64,
        buyback_bps: u16,
        claim_window_seconds: i64,
        marketplace_fee_bps: u16,
        usdc_mint: Option<Pubkey>,
        mochi_mint: Option<Pubkey>,
        reward_per_pack: u64,
    ) -> Result<()> {
        let admin_key = ctx.accounts.admin.key();
        let vault_key = ctx.accounts.vault_state.key();
        let (expected_vault_auth, vault_bump) =
            Pubkey::find_program_address(&[GACHA_VAULT_AUTHORITY_SEED, vault_key.as_ref()], ctx.program_id);

        // Ensure account is large enough and rent-exempt for the expanded struct.
        let target_len: usize = 8 + VaultState::SIZE;
        let rent = Rent::get()?;
        let required_lamports = rent.minimum_balance(target_len);
        let vault_info = ctx.accounts.vault_state.to_account_info();

        if vault_info.lamports() < required_lamports {
            let diff = required_lamports
                .checked_sub(vault_info.lamports())
                .ok_or(MochiError::MathOverflow)?;
            invoke(
                &system_instruction::transfer(&ctx.accounts.admin.key(), vault_info.key, diff),
                &[
                    ctx.accounts.admin.to_account_info(),
                    vault_info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        vault_info.realloc(target_len, false)?;

        // Manually write the struct to guarantee deterministic layout and overwrite any legacy bytes.
        let mut data = vault_info.try_borrow_mut_data()?;
        data.fill(0);
        // Discriminator
        data[..8].copy_from_slice(&VaultState::discriminator());
        let mut offset = 8;

        // admin
        data[offset..offset + 32].copy_from_slice(admin_key.as_ref());
        offset += 32;
        // vault_authority
        data[offset..offset + 32].copy_from_slice(expected_vault_auth.as_ref());
        offset += 32;
        // pack_price_sol
        data[offset..offset + 8].copy_from_slice(&pack_price_sol.to_le_bytes());
        offset += 8;
        // pack_price_usdc
        data[offset..offset + 8].copy_from_slice(&pack_price_usdc.to_le_bytes());
        offset += 8;
        // buyback_bps (u16)
        data[offset..offset + 2].copy_from_slice(&buyback_bps.to_le_bytes());
        offset += 2;
        // claim_window_seconds (i64)
        data[offset..offset + 8].copy_from_slice(&claim_window_seconds.to_le_bytes());
        offset += 8;
        // marketplace_fee_bps (u16)
        data[offset..offset + 2].copy_from_slice(&marketplace_fee_bps.to_le_bytes());
        offset += 2;

        // core_collection: None => flag 0
        data[offset] = 0;
        offset += 1 + 32; // keep layout consistent with SIZE even though value is None.

        // usdc_mint option
        match usdc_mint {
            Some(pk) => {
                data[offset] = 1;
                data[offset + 1..offset + 33].copy_from_slice(pk.as_ref());
            }
            None => data[offset] = 0,
        }
        offset += 1 + 32;

        // mochi_mint option
        match mochi_mint {
            Some(pk) => {
                data[offset] = 1;
                data[offset + 1..offset + 33].copy_from_slice(pk.as_ref());
            }
            None => data[offset] = 0,
        }
        offset += 1 + 32;

        // reward_per_pack
        data[offset..offset + 8].copy_from_slice(&reward_per_pack.to_le_bytes());
        offset += 8;

        // vault_authority_bump
        data[offset] = vault_bump;
        offset += 1;

        // padding (7 bytes already zeroed)
        // offset now should equal target_len
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

    /// New lightweight open: only Rare+ CardRecords are reserved on-chain (max 3).
    /// remaining_accounts: [rare_card_records...]
    pub fn open_pack<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenPackV2<'info>>,
        currency: Currency,
        client_seed_hash: [u8; 32],
        rare_templates: Vec<u32>,
    ) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        let now = Clock::get()?.unix_timestamp;

        let rare_count = rare_templates.len();
        require!(rare_count <= MAX_RARE_CARDS, MochiError::TooManyRareCards);
        require!(
            ctx.remaining_accounts.len() >= rare_count,
            MochiError::InvalidCardCount
        );
        msg!(
            "reward cfg amount {} mint {:?}",
            vault_state.reward_per_pack,
            vault_state.mochi_mint
        );

        // Fail fast if an active session already exists.
        let session = &mut ctx.accounts.pack_session;
        if session.state == PackState::PendingDecision && now <= session.expires_at {
            return err!(MochiError::SessionExists);
        }

        // Process payment first.
        let paid_amount = match currency {
            Currency::Sol => {
                let price = vault_state.pack_price_sol;
                require!(price > 0, MochiError::InvalidPrice);
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
                price
            }
            Currency::Token => {
                let price = vault_state.pack_price_usdc;
                require!(price > 0, MochiError::InvalidPrice);
                require!(
                    ctx.remaining_accounts.len() >= rare_count + 2,
                    MochiError::MissingTokenAccount
                );
                let token_accounts = &ctx.remaining_accounts[rare_count..];
                let user_token: Account<TokenAccount> = Account::try_from(&token_accounts[0])?;
                let vault_token: Account<TokenAccount> = Account::try_from(&token_accounts[1])?;
                if let Some(mint) = vault_state.usdc_mint {
                    require_keys_eq!(user_token.mint, mint, MochiError::MintMismatch);
                    require_keys_eq!(vault_token.mint, mint, MochiError::MintMismatch);
                }
                let cpi_accounts = Transfer {
                    from: user_token.to_account_info(),
                    to: vault_token.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                };
                let cpi_ctx =
                    CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
                token::transfer(cpi_ctx, price)?;
                price
            }
        };

        // Reserve Rare+ CardRecords only.
        let mut rare_keys: Vec<Pubkey> = Vec::with_capacity(rare_count);
        for (idx, acc_info) in ctx.remaining_accounts.iter().take(rare_count).enumerate() {
            let mut card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            require_keys_eq!(
                card_record.vault_state,
                vault_state.key(),
                MochiError::VaultMismatch
            );
            require!(
                card_record.status == CardStatus::Available,
                MochiError::CardNotAvailable
            );
            require!(
                is_rare_or_above(&card_record.rarity),
                MochiError::CardTooCommon
            );
            require!(
                card_record.template_id == rare_templates[idx],
                MochiError::TemplateMismatch
            );
            card_record.status = CardStatus::Reserved;
            card_record.owner = ctx.accounts.user.key();
            rare_keys.push(acc_info.key());
            persist_card_record(&card_record, acc_info)?;
        }

        // Write session state
        session.user = ctx.accounts.user.key();
        session.currency = currency;
        session.paid_amount = paid_amount;
        session.created_at = now;
        session.expires_at = now + vault_state.claim_window_seconds;
        session.state = PackState::PendingDecision;
        session.client_seed_hash = client_seed_hash;
        session.rare_card_keys = rare_keys;
        session.rare_templates = rare_templates;
        session.total_slots = PACK_CARD_COUNT as u8;
        session.bump = ctx.bumps.pack_session;
        // Optional MOCHI reward mint (requires vault authority to own mint authority).
        if vault_state.reward_per_pack > 0 {
            let mochi_mint = vault_state
                .mochi_mint
                .ok_or(MochiError::MintMismatch)?;
            require_keys_eq!(
                ctx.accounts.mochi_mint.key(),
                mochi_mint,
                MochiError::MintMismatch
            );
            require!(
                ctx.accounts.mochi_mint.mint_authority == COption::Some(ctx.accounts.vault_authority.key()),
                MochiError::Unauthorized
            );
            msg!(
                "reward mint {} to ATA {} (user {}) bump {}",
                vault_state.reward_per_pack,
                ctx.accounts.user_mochi_token.key(),
                ctx.accounts.user.key(),
                ctx.bumps.vault_authority
            );
            require_keys_eq!(
                ctx.accounts.user_mochi_token.mint,
                mochi_mint,
                MochiError::MintMismatch
            );
            require_keys_eq!(
                ctx.accounts.user_mochi_token.owner,
                ctx.accounts.user.key(),
                MochiError::Unauthorized
            );
            let vault_key = vault_state.key();
            let seeds = &[
                GACHA_VAULT_AUTHORITY_SEED,
                vault_key.as_ref(),
                &[ctx.bumps.vault_authority],
            ];
            let signer = &[&seeds[..]];
            let cpi_accounts = MintTo {
                mint: ctx.accounts.mochi_mint.to_account_info(),
                to: ctx.accounts.user_mochi_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer,
            );
            token::mint_to(cpi_ctx, vault_state.reward_per_pack)?;
            emit!(RewardMinted {
                user: ctx.accounts.user.key(),
                ata: ctx.accounts.user_mochi_token.key(),
                mint: mochi_mint,
                amount: vault_state.reward_per_pack,
            });
            msg!("reward minted");
        }
        Ok(())
    }

    /// Tx2 Keep path – transfers only the Rare+ assets listed in the PackSessionV2.
    /// remaining_accounts: [rare_card_records...][core_assets...]
    pub fn claim_pack_v2<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePackV2<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now <= session.expires_at, MochiError::SessionExpired);

        let rare_count = session.rare_card_keys.len();
        let (card_accounts, asset_accounts, _) =
            split_rare_accounts(&ctx.remaining_accounts, rare_count)?;
        require!(
            asset_accounts.len() == rare_count,
            MochiError::InvalidCardCount
        );

        for i in 0..rare_count {
            let acc_info: &AccountInfo<'info> = &card_accounts[i];
            require_keys_eq!(
                acc_info.key(),
                session.rare_card_keys[i],
                MochiError::CardKeyMismatch
            );
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
            let asset_info: &AccountInfo<'info> = &asset_accounts[i];
            transfer_core_asset(
                asset_info,
                &ctx.accounts.vault_authority,
                &ctx.accounts.vault_authority,
                &ctx.accounts.user.to_account_info(),
                &ctx.accounts.vault_state.key(),
                ctx.bumps.vault_authority,
                GACHA_VAULT_AUTHORITY_SEED,
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.mpl_core_program.to_account_info(),
            )?;
            card_record.status = CardStatus::UserOwned;
            card_record.owner = ctx.accounts.user.key();
            persist_card_record(&card_record, acc_info)?;
        }

        session.state = PackState::Accepted;
        Ok(())
    }

    /// Tx2 Sellback path – frees Rare+ reservations and pays the refund.
    /// remaining_accounts: [rare_card_records...][core_assets...][optional token accounts]
    pub fn sellback_pack_v2<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePackV2<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let vault_state = &ctx.accounts.vault_state;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now <= session.expires_at, MochiError::SessionExpired);

        let payout = session
            .paid_amount
            .checked_mul(vault_state.buyback_bps as u64)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(MochiError::MathOverflow)?;

        let rare_count = session.rare_card_keys.len();
        let (card_accounts, _asset_accounts, extras) =
            split_rare_accounts(&ctx.remaining_accounts, rare_count)?;

        // Pay refund
        match session.currency {
            Currency::Sol => {
                let vault_key = vault_state.key();
                let seeds = &[
                    GACHA_VAULT_AUTHORITY_SEED,
                    vault_key.as_ref(),
                    &[ctx.bumps.vault_authority],
                ];
                let signer = &[&seeds[..]];
                invoke_signed(
                    &system_instruction::transfer(
                        &ctx.accounts.vault_authority.key(),
                        &ctx.accounts.user.key(),
                        payout,
                    ),
                    &[
                        ctx.accounts.vault_authority.to_account_info(),
                        ctx.accounts.user.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    signer,
                )?;
            }
            Currency::Token => {
                require!(extras.len() >= 2, MochiError::MissingTokenAccount);
                let user_token: Account<TokenAccount> = Account::try_from(&extras[0])?;
                let vault_token: Account<TokenAccount> = Account::try_from(&extras[1])?;
                if let Some(mint) = vault_state.usdc_mint {
                    require_keys_eq!(user_token.mint, mint, MochiError::MintMismatch);
                    require_keys_eq!(vault_token.mint, mint, MochiError::MintMismatch);
                }
                let vault_key = vault_state.key();
                let seeds = &[
                    GACHA_VAULT_AUTHORITY_SEED,
                    vault_key.as_ref(),
                    &[ctx.bumps.vault_authority],
                ];
                let signer = &[&seeds[..]];
                let cpi_accounts = Transfer {
                    from: vault_token.to_account_info(),
                    to: user_token.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                );
                token::transfer(cpi_ctx, payout)?;
            }
        }

        for (idx, acc_info) in card_accounts.iter().enumerate() {
            require_keys_eq!(
                acc_info.key(),
                session.rare_card_keys[idx],
                MochiError::CardKeyMismatch
            );
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
            card_record.status = CardStatus::Available;
            card_record.owner = ctx.accounts.vault_authority.key();
            persist_card_record(&card_record, acc_info)?;
        }

        session.state = PackState::Rejected;
        Ok(())
    }

    /// Post-window cleanup – frees Rare+ reservations without payout.
    pub fn expire_session_v2<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePackV2<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now > session.expires_at, MochiError::SessionNotExpired);

        let rare_count = session.rare_card_keys.len();
        let (card_accounts, _assets, _) = split_rare_accounts(&ctx.remaining_accounts, rare_count)?;
        for (idx, acc_info) in card_accounts.iter().enumerate() {
            require_keys_eq!(
                acc_info.key(),
                session.rare_card_keys[idx],
                MochiError::CardKeyMismatch
            );
            let mut card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            require!(
                card_record.status == CardStatus::Reserved,
                MochiError::CardNotReserved
            );
            card_record.status = CardStatus::Available;
            card_record.owner = ctx.accounts.vault_authority.key();
            persist_card_record(&card_record, acc_info)?;
        }

        session.state = PackState::Expired;
        Ok(())
    }

    /// Admin-only hard reset for V2 sessions; frees any passed Rare+ CardRecords.
    pub fn admin_force_close_v2<'info>(
        ctx: Context<'_, '_, 'info, 'info, AdminForceCloseV2<'info>>,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        let session = &mut ctx.accounts.pack_session;
        let rare_count = session.rare_card_keys.len();
        let (card_accounts, _, _) = split_rare_accounts(&ctx.remaining_accounts, rare_count)?;
        for acc_info in card_accounts.iter() {
            if let Ok(mut card_record) = Account::<CardRecord>::try_from(acc_info) {
                if card_record.vault_state == ctx.accounts.vault_state.key() {
                    card_record.status = CardStatus::Available;
                    card_record.owner = ctx.accounts.vault_authority.key();
                    persist_card_record(&card_record, acc_info)?;
                }
            }
        }

        // Zero session but keep account alive for the user; they can reuse it on next open.
        session.state = PackState::Uninitialized;
        session.paid_amount = 0;
        session.created_at = 0;
        session.expires_at = 0;
        session.currency = Currency::Sol;
        session.rare_card_keys.clear();
        session.rare_templates.clear();
        session.total_slots = PACK_CARD_COUNT as u8;
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
            // Manually serialize because we constructed Account<T> from raw AccountInfo
            let mut data = acc_info.try_borrow_mut_data()?;
            let mut cursor = std::io::Cursor::new(&mut data[..]);
            card_record.try_serialize(&mut cursor)?;
        }
        session.card_record_keys = card_record_keys;
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
        msg!(
            "claim_pack: cards {} assets {} rarity_prices_len {} state {:?}",
            card_accounts.len(),
            asset_accounts.len(),
            session.rarity_prices.len(),
            session.state
        );
        require!(
            asset_accounts.len() == PACK_CARD_COUNT,
            MochiError::InvalidCardCount
        );
        // Defensive: ensure rarity_prices never allocates huge vec on deserialize
        if session.rarity_prices.len() > PACK_CARD_COUNT {
            session.rarity_prices.truncate(PACK_CARD_COUNT);
        }
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
            msg!("claim idx {} card {}", i, acc_info.key());
            card_record.status = CardStatus::UserOwned;
            card_record.owner = ctx.accounts.user.key();
            // Transfer Core asset to user
            let asset_info: &AccountInfo<'info> = &asset_accounts[i];
            msg!("claim transfer asset {}", asset_info.key());
            transfer_core_asset(
                &asset_info,
                &ctx.accounts.vault_authority,
                &ctx.accounts.vault_authority, // payer = vault authority
                &ctx.accounts.user.to_account_info(),
                &ctx.accounts.vault_state.key(),
                ctx.bumps.vault_authority,
                GACHA_VAULT_AUTHORITY_SEED,
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.mpl_core_program.to_account_info(),
            )?;
            msg!("claim transfer done {}", asset_info.key());
            // Persist card_record changes
            let mut data = acc_info.try_borrow_mut_data()?;
            let mut cursor = std::io::Cursor::new(&mut data[..]);
            card_record.try_serialize(&mut cursor)?;
        }

        session.state = PackState::Accepted;
        Ok(())
    }

    /// New: claim selected cards in smaller batches to reduce heap/CU pressure.
    /// remaining_accounts = [card_records..., core_assets...] with equal lengths >0.
    pub fn claim_pack_batch<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePack<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now <= session.expires_at, MochiError::SessionExpired);

        let (card_accounts, asset_accounts, _extras) =
            partition_half_accounts(&ctx.remaining_accounts)?;
        // Restrict batch size to 1 or 2 to avoid heap blowups.
        require!(
            card_accounts.len() > 0 && card_accounts.len() <= 2,
            MochiError::InvalidCardCount
        );
        for i in 0..card_accounts.len() {
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
                &ctx.accounts.vault_authority,
                &ctx.accounts.user.to_account_info(),
                &ctx.accounts.vault_state.key(),
                ctx.bumps.vault_authority,
                GACHA_VAULT_AUTHORITY_SEED,
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.mpl_core_program.to_account_info(),
            )?;
            let mut data = acc_info.try_borrow_mut_data()?;
            let mut cursor = std::io::Cursor::new(&mut data[..]);
            card_record.try_serialize(&mut cursor)?;
        }
        // Keep session pending; frontend/backend should call finalize_claim when all cards processed.
        Ok(())
    }

    /// Test helper: claim exactly 3 cards in one ix (for benchmarking); minimal logging.
    pub fn claim_pack_batch3<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePack<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now <= session.expires_at, MochiError::SessionExpired);

        let (card_accounts, asset_accounts, _extras) =
            partition_half_accounts(&ctx.remaining_accounts)?;
        require!(card_accounts.len() == 3, MochiError::InvalidCardCount);
        for i in 0..card_accounts.len() {
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
                &ctx.accounts.vault_authority,
                &ctx.accounts.user.to_account_info(),
                &ctx.accounts.vault_state.key(),
                ctx.bumps.vault_authority,
                GACHA_VAULT_AUTHORITY_SEED,
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.mpl_core_program.to_account_info(),
            )?;
            let mut data = acc_info.try_borrow_mut_data()?;
            let mut cursor = std::io::Cursor::new(&mut data[..]);
            card_record.try_serialize(&mut cursor)?;
        }
        Ok(())
    }

    /// New: finalize after all cards are user-owned; sets state = Accepted.
    /// remaining_accounts should include all card_record PDAs for verification.
    pub fn finalize_claim<'info>(
        ctx: Context<'_, '_, 'info, 'info, ResolvePack<'info>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.pack_session;
        let now = Clock::get()?.unix_timestamp;
        require!(
            session.state == PackState::PendingDecision,
            MochiError::InvalidSessionState
        );
        require!(now <= session.expires_at, MochiError::SessionExpired);
        for acc_info in ctx.remaining_accounts.iter() {
            let card_record: Account<CardRecord> = Account::try_from(acc_info)?;
            require!(
                card_record.status == CardStatus::UserOwned,
                MochiError::CardNotReserved
            );
            require_keys_eq!(
                card_record.owner,
                ctx.accounts.user.key(),
                MochiError::Unauthorized
            );
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
                    GACHA_VAULT_AUTHORITY_SEED,
                    vault_key.as_ref(),
                    &[ctx.bumps.vault_authority],
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
        template_id: u32,
        rarity: Rarity,
    ) -> Result<()> {
        // Enforce canonical marketplace vault PDA so listings cannot target a bogus vault.
        let (expected_vault, _) =
            Pubkey::find_program_address(&[MARKETPLACE_VAULT_SEED], ctx.program_id);
        require_keys_eq!(
            ctx.accounts.vault_state.key(),
            expected_vault,
            MochiError::VaultMismatch
        );

        let vault_key = ctx.accounts.vault_state.key();
        let core_key = ctx.accounts.core_asset.key();
        let seller_key = ctx.accounts.seller.key();

        // Load or initialize the CardRecord with the canonical marketplace seeds.
        let record = &mut ctx.accounts.card_record;
        let is_uninitialized = record.vault_state == Pubkey::default();
        if is_uninitialized {
            record.vault_state = vault_key;
            record.core_asset = core_key;
            record.template_id = template_id;
            record.rarity = rarity.clone();
            record.status = CardStatus::UserOwned;
            record.owner = seller_key;
        } else {
            require_keys_eq!(record.vault_state, vault_key, MochiError::VaultMismatch);
            require_keys_eq!(record.core_asset, core_key, MochiError::AssetMismatch);
            require!(
                record.template_id == template_id,
                MochiError::TemplateMismatch
            );
            require!(record.rarity == rarity, MochiError::RarityMismatch);
        }

        require!(
            record.owner == seller_key || record.owner == ctx.accounts.vault_authority.key(),
            MochiError::Unauthorized
        );
        require!(
            record.status == CardStatus::UserOwned || record.status == CardStatus::Available,
            MochiError::CardNotAvailable
        );

        // Move custody into the marketplace vault if the seller still holds the asset.
        if record.owner != ctx.accounts.vault_authority.key() {
            transfer_core_asset_user(
                &ctx.accounts.core_asset,
                &ctx.accounts.seller.to_account_info(),
                &ctx.accounts.seller.to_account_info(),
                &ctx.accounts.vault_authority.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.mpl_core_program.to_account_info(),
            )?;
        }

        record.status = CardStatus::Reserved;
        record.owner = ctx.accounts.vault_authority.key();

        // Write the Listing account directly; anchor will serialize on exit.
        let listing = &mut ctx.accounts.listing;
        listing.vault_state = vault_key;
        listing.seller = seller_key;
        listing.core_asset = record.core_asset;
        listing.price_lamports = price_lamports;
        listing.currency_mint = currency_mint;
        listing.status = ListingStatus::Active;
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

        // Defensive: recover or rebuild card_record even if prior data drifted.
        let mut record =
            CardRecord::try_deserialize(&mut &ctx.accounts.card_record.data.borrow()[..])
                .or_else(|_| {
                    CardRecord::try_deserialize_unchecked(
                        &mut &ctx.accounts.card_record.data.borrow()[..],
                    )
                })
                .unwrap_or(CardRecord {
                    vault_state: ctx.accounts.vault_state.key(),
                    core_asset: listing.core_asset,
                    template_id: 0,
                    rarity: Rarity::Common,
                    status: CardStatus::Reserved,
                    owner: ctx.accounts.vault_authority.key(),
                });
        record.vault_state = ctx.accounts.vault_state.key();
        record.core_asset = listing.core_asset;
        record.status = CardStatus::UserOwned;
        record.owner = ctx.accounts.seller.key();

        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.bumps.vault_authority,
            MARKETPLACE_VAULT_AUTHORITY_SEED,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;

        // Persist repaired record.
        {
            let mut data = ctx.accounts.card_record.try_borrow_mut_data()?;
            let mut cursor = std::io::Cursor::new(data.as_mut());
            record.try_serialize(&mut cursor)?;
        }

        listing.status = ListingStatus::Cancelled;
        Ok(())
    }

    pub fn fill_listing(ctx: Context<FillListing>) -> Result<()> {
        require!(
            ctx.accounts.listing.status == ListingStatus::Active,
            MochiError::InvalidListingState
        );
        let core_key = ctx.accounts.card_record.core_asset;

        let fee_bps = ctx.accounts.vault_state.marketplace_fee_bps as u64;
        let price = ctx.accounts.listing.price_lamports;
        let fee = price
            .checked_mul(fee_bps)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(MochiError::MathOverflow)?;
        let seller_amount = price.checked_sub(fee).ok_or(MochiError::MathOverflow)?;
        // Direct pay: buyer -> treasury (fee) and buyer -> seller (net). No escrow on listing PDA.
        if fee > 0 {
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
        }
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
        require_keys_eq!(record.core_asset, core_key, MochiError::AssetMismatch);
        record.status = CardStatus::UserOwned;
        record.owner = ctx.accounts.buyer.key();
        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.bumps.vault_authority,
            MARKETPLACE_VAULT_AUTHORITY_SEED,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;

        let listing = &mut ctx.accounts.listing;
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
            ctx.bumps.vault_authority,
            GACHA_VAULT_AUTHORITY_SEED,
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
            ctx.bumps.vault_authority,
            GACHA_VAULT_AUTHORITY_SEED,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;
        record.owner = ctx.accounts.destination.key();
        record.status = CardStatus::Deprecated;
        Ok(())
    }

    /// Admin-only prune for malformed listings that point to a wrong/nonexistent vault_state.
    /// This does NOT move any assets; it simply marks the listing as Cancelled to hide it.
    pub fn admin_prune_listing(ctx: Context<AdminPruneListing>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        // Overwrite the listing account regardless of prior contents to mark it Cancelled.
        let listing = Listing {
            vault_state: ctx.accounts.vault_state.key(),
            seller: Pubkey::default(),
            core_asset: Pubkey::default(),
            price_lamports: 0,
            currency_mint: None,
            status: ListingStatus::Cancelled,
        };
        let mut data = ctx.accounts.listing.try_borrow_mut_data()?;
        let mut cursor = std::io::Cursor::new(&mut data[..]);
        // AccountSerialize already writes the discriminator; avoid writing it twice.
        listing.try_serialize(&mut cursor)?;
        Ok(())
    }

    /// Admin-only escape hatch to repair/cancel corrupted listings.
    /// Returns NFT to seller and marks listing + card_record accordingly.
    pub fn admin_force_cancel_listing(ctx: Context<AdminForceCancel>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        let listing = &mut ctx.accounts.listing;
        require_keys_eq!(
            listing.vault_state,
            ctx.accounts.vault_state.key(),
            MochiError::VaultMismatch
        );
        require_keys_eq!(
            listing.seller,
            ctx.accounts.seller.key(),
            MochiError::Unauthorized
        );

        // Defensive: recover card_record even if drifted.
        let mut record =
            CardRecord::try_deserialize(&mut &ctx.accounts.card_record.data.borrow()[..])
                .or_else(|_| {
                    CardRecord::try_deserialize_unchecked(
                        &mut &ctx.accounts.card_record.data.borrow()[..],
                    )
                })
                .unwrap_or(CardRecord {
                    vault_state: ctx.accounts.vault_state.key(),
                    core_asset: listing.core_asset,
                    template_id: 0,
                    rarity: Rarity::Common,
                    status: CardStatus::Reserved,
                    owner: ctx.accounts.vault_authority.key(),
                });
        record.vault_state = ctx.accounts.vault_state.key();
        record.core_asset = listing.core_asset;
        record.status = CardStatus::UserOwned;
        record.owner = listing.seller;

        // Return NFT to seller.
        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.bumps.vault_authority,
            MARKETPLACE_VAULT_AUTHORITY_SEED,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;

        // Persist repaired card_record
        {
            let mut data = ctx.accounts.card_record.try_borrow_mut_data()?;
            let mut cursor = std::io::Cursor::new(&mut data[..]);
            cursor.write_all(&CardRecord::discriminator())?;
            record.try_serialize(&mut cursor)?;
        }

        listing.status = ListingStatus::Cancelled;
        Ok(())
    }

    /// Admin-only guardrail to return a stuck listing's asset to its original seller.
    /// Destination is fixed to listing.seller; admin cannot redirect funds.
    pub fn emergency_return_asset(ctx: Context<EmergencyReturnAsset>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        let listing = &mut ctx.accounts.listing;
        require_keys_eq!(
            listing.vault_state,
            ctx.accounts.vault_state.key(),
            MochiError::VaultMismatch
        );
        require_keys_eq!(
            listing.seller,
            ctx.accounts.seller.key(),
            MochiError::Unauthorized
        );

        let mut record =
            CardRecord::try_deserialize(&mut &ctx.accounts.card_record.data.borrow()[..])
                .or_else(|_| {
                    CardRecord::try_deserialize_unchecked(
                        &mut &ctx.accounts.card_record.data.borrow()[..],
                    )
                })
                .unwrap_or(CardRecord {
                    vault_state: ctx.accounts.vault_state.key(),
                    core_asset: listing.core_asset,
                    template_id: 0,
                    rarity: Rarity::Common,
                    status: CardStatus::Reserved,
                    owner: ctx.accounts.vault_authority.key(),
                });
        record.vault_state = ctx.accounts.vault_state.key();
        record.core_asset = listing.core_asset;
        record.status = CardStatus::UserOwned;
        record.owner = listing.seller;

        transfer_core_asset(
            &ctx.accounts.core_asset,
            &ctx.accounts.vault_authority,
            &ctx.accounts.vault_authority,
            &ctx.accounts.seller.to_account_info(),
            &ctx.accounts.vault_state.key(),
            ctx.bumps.vault_authority,
            MARKETPLACE_VAULT_AUTHORITY_SEED,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.mpl_core_program.to_account_info(),
        )?;

        {
            let mut data = ctx.accounts.card_record.try_borrow_mut_data()?;
            let mut cursor = std::io::Cursor::new(&mut data[..]);
            cursor.write_all(&CardRecord::discriminator())?;
            record.try_serialize(&mut cursor)?;
        }

        listing.status = ListingStatus::Cancelled;
        Ok(())
    }

    /// Admin-only rescue for legacy listings anchored to an old/non-canonical vault_state PDA.
    /// Returns the asset to the original seller and marks the listing cancelled.
    pub fn admin_rescue_legacy_listing(ctx: Context<AdminRescueLegacyListing>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.marketplace_vault_state.admin,
            MochiError::Unauthorized
        );
        let listing = &mut ctx.accounts.listing;
        require_keys_eq!(
            listing.vault_state,
            ctx.accounts.legacy_vault_state.key(),
            MochiError::VaultMismatch
        );
        require_keys_eq!(
            listing.seller,
            ctx.accounts.seller.key(),
            MochiError::Unauthorized
        );

        let (market_auth, market_bump) = Pubkey::find_program_address(
            &[
                MARKETPLACE_VAULT_AUTHORITY_SEED,
                ctx.accounts.legacy_vault_state.key().as_ref(),
            ],
            ctx.program_id,
        );
        let (gacha_auth, gacha_bump) = Pubkey::find_program_address(
            &[
                GACHA_VAULT_AUTHORITY_SEED,
                ctx.accounts.legacy_vault_state.key().as_ref(),
            ],
            ctx.program_id,
        );
        let (authority_seed, authority_bump) =
            if market_auth == ctx.accounts.legacy_vault_authority.key() {
                (MARKETPLACE_VAULT_AUTHORITY_SEED, market_bump)
            } else {
                require_keys_eq!(
                    gacha_auth,
                    ctx.accounts.legacy_vault_authority.key(),
                    MochiError::VaultMismatch
                );
                (GACHA_VAULT_AUTHORITY_SEED, gacha_bump)
            };

        let mut record =
            CardRecord::try_deserialize(&mut &ctx.accounts.card_record.data.borrow()[..])
                .or_else(|_| {
                    CardRecord::try_deserialize_unchecked(
                        &mut &ctx.accounts.card_record.data.borrow()[..],
                    )
                })
                .unwrap_or(CardRecord {
                    vault_state: listing.vault_state,
                    core_asset: listing.core_asset,
                    template_id: 0,
                    rarity: Rarity::Common,
                    status: CardStatus::Reserved,
                    owner: ctx.accounts.legacy_vault_authority.key(),
                });
        record.vault_state = listing.vault_state;
        record.core_asset = listing.core_asset;
        record.status = CardStatus::UserOwned;
        record.owner = listing.seller;

        let should_transfer = record.owner == ctx.accounts.legacy_vault_authority.key();
        if should_transfer {
            transfer_core_asset(
                &ctx.accounts.core_asset,
                &ctx.accounts.legacy_vault_authority,
                &ctx.accounts.legacy_vault_authority,
                &ctx.accounts.seller.to_account_info(),
                &ctx.accounts.legacy_vault_state.key(),
                authority_bump,
                authority_seed,
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.mpl_core_program.to_account_info(),
            )?;
        } else if record.owner != listing.seller {
            // If the asset is already with the seller, no transfer is needed; otherwise fail.
            return err!(MochiError::Unauthorized);
        }

        // Best-effort persist; if the legacy card_record is missing or too small, skip persistence.
        if let Ok(mut data) = ctx.accounts.card_record.try_borrow_mut_data() {
            if data.len() >= 8 + CardRecord::SIZE {
                let mut cursor = std::io::Cursor::new(&mut data[..]);
                let _ = cursor.write_all(&CardRecord::discriminator());
                let _ = record.try_serialize(&mut cursor);
            }
        }

        listing.status = ListingStatus::Cancelled;
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

    pub fn admin_reset_cards<'info>(
        ctx: Context<'_, '_, 'info, 'info, AdminResetCards<'info>>,
    ) -> Result<()> {
        // Admin loop to set any provided CardRecords back to Available/ vault authority owner.
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault_state.admin,
            MochiError::Unauthorized
        );
        msg!("admin_reset_cards rem len {}", ctx.remaining_accounts.len());
        for acc_info in ctx.remaining_accounts.iter() {
            if let Ok(mut card_record) = Account::<CardRecord>::try_from(acc_info) {
                if card_record.vault_state == ctx.accounts.vault_state.key() {
                    card_record.status = CardStatus::Available;
                    card_record.owner = ctx.accounts.vault_authority.key();
                    let mut data = acc_info.try_borrow_mut_data()?;
                    let mut cursor = std::io::Cursor::new(&mut data[..]);
                    card_record.try_serialize(&mut cursor)?;
                }
            }
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct OpenPackV2<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"pack_session_v2", vault_state.key().as_ref(), user.key().as_ref()],
        bump,
        space = 8 + PackSessionV2::SIZE,
    )]
    pub pack_session: Account<'info, PackSessionV2>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// Treasury to receive SOL fees (typically same as vault_authority PDA)
    #[account(mut)]
    pub vault_treasury: SystemAccount<'info>,
    #[account(mut)]
    pub mochi_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_mochi_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ResolvePackV2<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"pack_session_v2", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub pack_session: Account<'info, PackSessionV2>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
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
pub struct AdminForceCloseV2<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: target user wallet (for PDA derivation)
    pub user: UncheckedAccount<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"pack_session_v2", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub pack_session: Account<'info, PackSessionV2>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [GACHA_VAULT_SEED],
        bump,
        space = 8 + VaultState::SIZE,
    )]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA that holds custody/treasury authority (validated by seeds)
    #[account(
        seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitializeMarketplaceVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [MARKETPLACE_VAULT_SEED],
        bump,
        space = 8 + VaultState::SIZE,
    )]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: marketplace escrow/vault authority PDA
    #[account(
        seeds = [MARKETPLACE_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositCard<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: Core asset account (Metaplex Core asset), validated off-chain
    pub core_asset: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [CARD_RECORD_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()],
        bump,
        space = 8 + CardRecord::SIZE,
    )]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: System program
    pub system_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OpenPackStart<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
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
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
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
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
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
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
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
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        close = user,
        seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminForceClose<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: user wallet (used for PDA derivation only)
    pub user: UncheckedAccount<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        close = admin,
        seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminResetCards<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UserResetSession<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        close = user,
        seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeClaim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [b"pack_session", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub pack_session: Account<'info, PackSession>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ListCard<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        init_if_needed,
        payer = seller,
        space = 8 + CardRecord::SIZE,
        seeds = [CARD_RECORD_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()],
        bump
    )]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Core asset account (Metaplex Core), validated off-chain
    pub core_asset: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = seller,
        space = 8 + Listing::SIZE,
        seeds = [LISTING_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [MARKETPLACE_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [CARD_RECORD_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    /// CHECK: We will deserialize or rebuild defensively.
    pub card_record: UncheckedAccount<'info>,
    /// CHECK: Core asset (Metaplex Core), validated off-chain
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [LISTING_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [MARKETPLACE_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
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
    #[account(mut, seeds = [MARKETPLACE_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Core asset account (Metaplex Core), validated off-chain
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [LISTING_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(mut, seeds = [MARKETPLACE_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
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
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: Core asset account (Metaplex Core), validated off-chain
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminMigrateAsset<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
    /// CHECK: emergency destination (validated off-chain by admin authority)
    pub destination: UncheckedAccount<'info>,
    /// CHECK: Core asset account (Metaplex Core)
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    /// CHECK: Vault authority PDA (validated by seeds)
    #[account(seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program (CPI target)
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminForceCancel<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [CARD_RECORD_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    /// CHECK: we will deserialize or rebuild
    pub card_record: UncheckedAccount<'info>,
    /// CHECK: core asset
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [LISTING_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    /// CHECK: vault authority
    pub vault_authority: UncheckedAccount<'info>,
    /// Seller (funds will be returned)
    #[account(mut)]
    pub seller: SystemAccount<'info>,
    /// CHECK: system program
    pub system_program: UncheckedAccount<'info>,
    /// CHECK: mpl-core
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct EmergencyReturnAsset<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [CARD_RECORD_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    /// CHECK: we will deserialize or rebuild
    pub card_record: UncheckedAccount<'info>,
    /// CHECK: core asset
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [LISTING_SEED, vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    /// CHECK: vault authority
    pub vault_authority: UncheckedAccount<'info>,
    /// Seller destination (must match listing.seller)
    #[account(mut)]
    pub seller: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AdminRescueLegacyListing<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_SEED], bump)]
    pub marketplace_vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub legacy_vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [CARD_RECORD_SEED, legacy_vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    /// CHECK: legacy card record PDA
    pub card_record: UncheckedAccount<'info>,
    /// CHECK: core asset tied to listing
    #[account(mut)]
    pub core_asset: UncheckedAccount<'info>,
    #[account(mut, seeds = [LISTING_SEED, legacy_vault_state.key().as_ref(), core_asset.key().as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    /// CHECK: legacy vault authority PDA (seed prefix verified in handler)
    #[account(mut)]
    pub legacy_vault_authority: UncheckedAccount<'info>,
    /// Seller destination (must match listing.seller)
    #[account(mut)]
    pub seller: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program
    pub mpl_core_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DeprecateCard<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub card_record: Account<'info, CardRecord>,
}

#[derive(Accounts)]
pub struct AdminPruneListing<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [MARKETPLACE_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: listing PDA may have been created with wrong seeds; we only mark Cancelled.
    #[account(mut)]
    pub listing: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetRewardConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: vault authority PDA (seed checked in handler)
    #[account(mut, seeds = [GACHA_VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MigrateVaultState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GACHA_VAULT_SEED], bump)]
    /// CHECK: migrating legacy account; seeds enforced above.
    pub vault_state: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
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
    pub mochi_mint: Option<Pubkey>,
    pub reward_per_pack: u64,
    pub vault_authority_bump: u8,
    pub padding: [u8; 7],
}
impl VaultState {
    pub const SIZE: usize = 32 // admin
        + 32 // vault_authority
        + 8 // pack_price_sol
        + 8 // pack_price_usdc
        + 2 // buyback_bps
        + 8 // claim_window_seconds
        + 2 // marketplace_fee_bps
        + 1 + 32 // core_collection Option
        + 1 + 32 // usdc_mint Option
        + 1 + 32 // mochi_mint Option
        + 8 // reward_per_pack
        + 1 // vault_authority_bump
        + 7; // padding
}

#[event]
pub struct RewardMinted {
    pub user: Pubkey,
    pub ata: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
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
pub struct PackSessionV2 {
    pub user: Pubkey,
    pub currency: Currency,
    pub paid_amount: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub rare_card_keys: Vec<Pubkey>,
    pub rare_templates: Vec<u32>,
    pub state: PackState,
    pub client_seed_hash: [u8; 32],
    pub total_slots: u8,
    pub bump: u8,
}
impl PackSessionV2 {
    pub const SIZE: usize = 32 // user
        + 1 // currency enum
        + 8 // paid_amount
        + 8 // created_at
        + 8 // expires_at
        + 4 + (32 * MAX_RARE_CARDS) // rare_card_keys vec
        + 4 + (4 * MAX_RARE_CARDS) // rare_templates vec
        + 1 // state enum
        + 32 // client_seed_hash
        + 1 // total_slots
        + 1; // bump
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
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
    #[msg("Listing invalid state")]
    InvalidListingState,
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
    #[msg("Too many Rare+ cards provided")]
    TooManyRareCards,
    #[msg("Card rarity must be Rare or above")]
    CardTooCommon,
    #[msg("Card template mismatch")]
    TemplateMismatch,
    #[msg("Card key mismatch")]
    CardKeyMismatch,
    #[msg("Rarity mismatch")]
    RarityMismatch,
}

fn persist_card_record(card_record: &CardRecord, acc_info: &AccountInfo) -> Result<()> {
    let mut data = acc_info.try_borrow_mut_data()?;
    let mut cursor = std::io::Cursor::new(&mut data[..]);
    card_record.try_serialize(&mut cursor)?;
    Ok(())
}

fn is_rare_or_above(rarity: &Rarity) -> bool {
    matches!(
        rarity,
        Rarity::Rare
            | Rarity::DoubleRare
            | Rarity::UltraRare
            | Rarity::IllustrationRare
            | Rarity::SpecialIllustrationRare
            | Rarity::MegaHyperRare
    )
}

fn split_rare_accounts<'info>(
    accounts: &'info [AccountInfo<'info>],
    rare_count: usize,
) -> Result<(
    &'info [AccountInfo<'info>],
    &'info [AccountInfo<'info>],
    &'info [AccountInfo<'info>],
)> {
    require!(accounts.len() >= rare_count, MochiError::InvalidCardCount);
    let (card_slice, rest) = accounts.split_at(rare_count);
    if rest.len() >= rare_count {
        let (asset_slice, extras) = rest.split_at(rare_count);
        Ok((card_slice, asset_slice, extras))
    } else {
        Ok((card_slice, &[], rest))
    }
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

/// Split remaining accounts into equal halves (card_records, assets)
fn partition_half_accounts<'info>(
    accounts: &'info [AccountInfo<'info>],
) -> Result<(
    &'info [AccountInfo<'info>],
    &'info [AccountInfo<'info>],
    &'info [AccountInfo<'info>],
)> {
    require!(accounts.len() >= 2, MochiError::InvalidCardCount);
    let half = accounts.len() / 2;
    require!(
        half > 0 && half * 2 == accounts.len(),
        MochiError::InvalidCardCount
    );
    let (cards, rest) = accounts.split_at(half);
    let (assets, extras) = rest.split_at(half);
    Ok((cards, assets, extras))
}

fn transfer_core_asset<'info>(
    asset: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    vault_state: &Pubkey,
    vault_bump: u8,
    authority_seed: &[u8],
    system_program: &AccountInfo<'info>,
    mpl_core_program: &AccountInfo<'info>,
) -> Result<()> {
    let bump_arr = [vault_bump];
    let seeds: [&[u8]; 3] = [authority_seed, vault_state.as_ref(), &bump_arr];
    let signer: &[&[&[u8]]] = &[&seeds];
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
    authority_seed: &[u8],
    system_program: &AccountInfo<'info>,
    mpl_core_program: &AccountInfo<'info>,
) -> Result<()> {
    let seeds = &[authority_seed, vault_state.as_ref(), &[vault_bump]];
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
fn transfer_core_asset_user<'info>(
    asset: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    mpl_core_program: &AccountInfo<'info>,
) -> Result<()> {
    let mut builder = TransferV1CpiBuilder::new(mpl_core_program);
    builder
        .asset(asset)
        .payer(payer)
        .authority(Some(authority))
        .new_owner(new_owner)
        .system_program(Some(system_program));
    builder
        .invoke()
        .map_err(|_| MochiError::CoreCpiError.into())
}
