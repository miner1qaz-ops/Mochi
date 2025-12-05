use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

// Program ID
declare_id!("2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue");

// Constants for seeds
const SALE_SEED: &[u8] = b"seed_sale";
const VAULT_AUTH_SEED: &[u8] = b"seed_vault";
const VESTING_SEED: &[u8] = b"vesting";
const SEED_VAULT_TOKEN_SEED: &[u8] = b"seed_vault_token";
const VEST_VAULT_TOKEN_SEED: &[u8] = b"vest_vault_token";

#[program]
pub mod mochi_seed_sale {
    use super::*;

    pub fn init_sale(
        ctx: Context<InitSale>,
        start_ts: i64,
        end_ts: i64,
        price_tokens_per_sol: u64,
        token_cap: u64,
        sol_cap_lamports: u64,
    ) -> Result<()> {
        require!(end_ts > start_ts, SeedError::InvalidWindow);
        let sale = &mut ctx.accounts.sale;
        sale.authority = ctx.accounts.authority.key();
        sale.mint = ctx.accounts.mint.key();
        sale.seed_vault = ctx.accounts.seed_vault.key();
        sale.vault_authority = ctx.accounts.vault_authority.key();
        sale.treasury = ctx.accounts.treasury.key();
        sale.start_ts = start_ts;
        sale.end_ts = end_ts;
        sale.price_tokens_per_sol = price_tokens_per_sol;
        sale.token_cap = token_cap;
        sale.sol_cap_lamports = sol_cap_lamports;
        sale.sold_tokens = 0;
        sale.raised_lamports = 0;
        sale.is_canceled = false;
        sale.bump = ctx.bumps.sale;
        sale.vault_bump = ctx.bumps.vault_authority;
        sale.vault_token_bump = ctx.bumps.seed_vault;
        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, lamports: u64) -> Result<()> {
        let clock = Clock::get()?;
        let sale = &mut ctx.accounts.sale;
        require!(!sale.is_canceled, SeedError::Canceled);
        require!(clock.unix_timestamp >= sale.start_ts, SeedError::NotStarted);
        require!(clock.unix_timestamp <= sale.end_ts, SeedError::Ended);
        require!(lamports > 0, SeedError::InvalidContribution);

        let potential_raise = sale.raised_lamports.checked_add(lamports).ok_or(SeedError::Overflow)?;
        if sale.sol_cap_lamports > 0 {
            require!(potential_raise <= sale.sol_cap_lamports, SeedError::CapReached);
        }
        let tokens_owed = lamports
            .checked_mul(sale.price_tokens_per_sol)
            .ok_or(SeedError::Overflow)?;
        let potential_sold = sale.sold_tokens.checked_add(tokens_owed).ok_or(SeedError::Overflow)?;
        if sale.token_cap > 0 {
            require!(potential_sold <= sale.token_cap, SeedError::CapReached);
        }

        // Transfer SOL to treasury
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &sale.treasury,
            lamports,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[ctx.accounts.buyer.to_account_info(), ctx.accounts.system_program.to_account_info(), ctx.accounts.treasury.to_account_info()],
        )?;

        let contrib = &mut ctx.accounts.contribution;
        contrib.sale = sale.key();
        contrib.buyer = ctx.accounts.buyer.key();
        contrib.contributed_lamports = contrib
            .contributed_lamports
            .checked_add(lamports)
            .ok_or(SeedError::Overflow)?;
        contrib.tokens_owed = contrib.tokens_owed.checked_add(tokens_owed).ok_or(SeedError::Overflow)?;
        contrib.claimed = false;
        sale.raised_lamports = potential_raise;
        sale.sold_tokens = potential_sold;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let clock = Clock::get()?;
        let sale = &mut ctx.accounts.sale;
        require!(!sale.is_canceled, SeedError::Canceled);
        require!(clock.unix_timestamp > sale.end_ts, SeedError::NotEnded);

        let contrib = &mut ctx.accounts.contribution;
        require!(!contrib.claimed, SeedError::AlreadyClaimed);
        let amount = contrib.tokens_owed;
        require!(amount > 0, SeedError::NothingToClaim);

        let sale_key = sale.key();
        let seeds = &[VAULT_AUTH_SEED, sale_key.as_ref(), &[sale.vault_bump]];
        let signer = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.seed_vault.to_account_info(),
            to: ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        contrib.claimed = true;
        Ok(())
    }

    pub fn cancel_sale(ctx: Context<CancelSale>) -> Result<()> {
        let sale = &mut ctx.accounts.sale;
        require!(ctx.accounts.authority.key() == sale.authority, SeedError::Unauthorized);
        sale.is_canceled = true;
        Ok(())
    }

    pub fn init_vesting(
        ctx: Context<InitVesting>,
        start_ts: i64,
        cliff_ts: i64,
        end_ts: i64,
        total_amount: u64,
    ) -> Result<()> {
        require!(start_ts < end_ts, SeedError::InvalidWindow);
        let vest = &mut ctx.accounts.vesting;
        vest.authority = ctx.accounts.authority.key();
        vest.beneficiary = ctx.accounts.beneficiary.key();
        vest.mint = ctx.accounts.mint.key();
        vest.vault = ctx.accounts.vest_vault.key();
        vest.start_ts = start_ts;
        vest.cliff_ts = cliff_ts;
        vest.end_ts = end_ts;
        vest.total_amount = total_amount;
        vest.claimed_amount = 0;
        vest.bump = ctx.bumps.vesting;
        vest.vault_bump = ctx.bumps.vest_vault_authority;
        vest.vault_token_bump = ctx.bumps.vest_vault;
        Ok(())
    }

    pub fn claim_vesting(ctx: Context<ClaimVesting>) -> Result<()> {
        let clock = Clock::get()?;
        let vest = &mut ctx.accounts.vesting;
        require!(clock.unix_timestamp >= vest.cliff_ts, SeedError::CliffNotReached);
        require!(vest.total_amount > vest.claimed_amount, SeedError::NothingToClaim);

        let vested = vested_amount(vest, clock.unix_timestamp)?;
        let claimable = vested
            .checked_sub(vest.claimed_amount)
            .ok_or(SeedError::Overflow)?;
        require!(claimable > 0, SeedError::NothingToClaim);

        let seeds = &[VESTING_SEED, vest.beneficiary.as_ref(), &[vest.bump]];
        let signer = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.vest_vault.to_account_info(),
            to: ctx.accounts.beneficiary_ata.to_account_info(),
            authority: ctx.accounts.vest_vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer);
        token::transfer(cpi_ctx, claimable)?;

        vest.claimed_amount = vest
            .claimed_amount
            .checked_add(claimable)
            .ok_or(SeedError::Overflow)?;
        Ok(())
    }
}

fn vested_amount(vest: &Vesting, now: i64) -> Result<u64> {
    if now <= vest.start_ts {
        return Ok(0);
    }
    if now >= vest.end_ts {
        return Ok(vest.total_amount);
    }
    let elapsed = (now - vest.start_ts) as u128;
    let duration = (vest.end_ts - vest.start_ts) as u128;
    let vested = (vest.total_amount as u128)
        .checked_mul(elapsed)
        .ok_or(SeedError::Overflow)?
        .checked_div(duration)
        .ok_or(SeedError::Overflow)?;
    Ok(vested as u64)
}

#[derive(Accounts)]
pub struct InitSale<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    /// CHECK: treasury can be any system account
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        seeds = [SALE_SEED, authority.key().as_ref(), mint.key().as_ref()],
        bump,
        space = 8 + SeedSale::LEN,
    )]
    pub sale: Account<'info, SeedSale>,
    /// CHECK: PDA authority for seed vault
    #[account(seeds = [VAULT_AUTH_SEED, sale.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        seeds = [SEED_VAULT_TOKEN_SEED, sale.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub seed_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub sale: Account<'info, SeedSale>,
    /// CHECK: treasury system account
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = buyer,
        seeds = [b"contrib", sale.key().as_ref(), buyer.key().as_ref()],
        bump,
        space = 8 + Contribution::LEN,
    )]
    pub contribution: Account<'info, Contribution>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub sale: Account<'info, SeedSale>,
    #[account(mut, seeds = [b"contrib", sale.key().as_ref(), buyer.key().as_ref()], bump = contribution.bump)]
    pub contribution: Account<'info, Contribution>,
    #[account(mut)]
    pub seed_vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority
    #[account(seeds = [VAULT_AUTH_SEED, sale.key().as_ref()], bump = sale.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelSale<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub sale: Account<'info, SeedSale>,
}

#[derive(Accounts)]
pub struct InitVesting<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    /// Beneficiary who will claim vested tokens
    pub beneficiary: SystemAccount<'info>,
    #[account(
        init,
        payer = authority,
        seeds = [VESTING_SEED, beneficiary.key().as_ref()],
        bump,
        space = 8 + Vesting::LEN,
    )]
    pub vesting: Account<'info, Vesting>,
    /// CHECK: PDA authority for vest vault
    #[account(seeds = [VESTING_SEED, beneficiary.key().as_ref()], bump)]
    pub vest_vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        seeds = [VEST_VAULT_TOKEN_SEED, beneficiary.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vest_vault_authority,
    )]
    pub vest_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ClaimVesting<'info> {
    pub beneficiary: Signer<'info>,
    #[account(mut, seeds = [VESTING_SEED, beneficiary.key().as_ref()], bump = vesting.bump)]
    pub vesting: Account<'info, Vesting>,
    #[account(mut)]
    pub vest_vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority
    #[account(seeds = [VESTING_SEED, beneficiary.key().as_ref()], bump = vesting.vault_bump)]
    pub vest_vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub beneficiary_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct SeedSale {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub seed_vault: Pubkey,
    pub vault_authority: Pubkey,
    pub treasury: Pubkey,
    pub start_ts: i64,
    pub end_ts: i64,
    pub price_tokens_per_sol: u64,
    pub token_cap: u64,
    pub sol_cap_lamports: u64,
    pub sold_tokens: u64,
    pub raised_lamports: u64,
    pub is_canceled: bool,
    pub bump: u8,
    pub vault_bump: u8,
    pub vault_token_bump: u8,
}
impl SeedSale {
    // 5 pubkeys (5*32) + 2 i64 (start/end) + 5 u64 (price, caps, totals) + 4 u8/bool
    pub const LEN: usize = 32 * 5 + 8 * 7 + 4; // 220 bytes (data), +8 discriminator at init
}

#[account]
pub struct Contribution {
    pub sale: Pubkey,
    pub buyer: Pubkey,
    pub contributed_lamports: u64,
    pub tokens_owed: u64,
    pub claimed: bool,
    pub bump: u8,
}
impl Contribution {
    pub const LEN: usize = 32 * 2 + 8 * 2 + 1 + 1;
}

#[account]
pub struct Vesting {
    pub authority: Pubkey,
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub start_ts: i64,
    pub cliff_ts: i64,
    pub end_ts: i64,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub vault_token_bump: u8,
}
impl Vesting {
    pub const LEN: usize = 32 * 4 + 8 * 5 + 1 + 1 + 1;
}

#[error_code]
pub enum SeedError {
    #[msg("Sale window is invalid")] InvalidWindow,
    #[msg("Sale not started")] NotStarted,
    #[msg("Sale ended")] Ended,
    #[msg("Sale not ended")] NotEnded,
    #[msg("Sale canceled")] Canceled,
    #[msg("Contribution too small")] InvalidContribution,
    #[msg("Cap reached")] CapReached,
    #[msg("Overflow")] Overflow,
    #[msg("Unauthorized")] Unauthorized,
    #[msg("Already claimed")] AlreadyClaimed,
    #[msg("Nothing to claim")] NothingToClaim,
    #[msg("Cliff not reached")] CliffNotReached,
}
