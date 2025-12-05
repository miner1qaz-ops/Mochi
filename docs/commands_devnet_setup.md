# Devnet setup commands (authority/USDC already generated)

## Keys (already present)
- Authority/treasury: `mochi/anchor-program/keys/dev-authority.json` (pubkey `CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs`)
- USDC mint: `mochi/anchor-program/keys/dev-usdc-mint.json` (pubkey `GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu`)
- Program id: `Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx`
- PDAs: vault_state = `HNJPBPsnHJ7DAVs3PmZMBCkV5dgZrXvEWVp891X4D1Kw`, vault_authority = `C9EfNtZkpjVsTSxCdGN4M8G1meBExxqBMFdfj8Jc4Y7z`

## 1) Solana CLI config
```bash
solana config set --url https://api.devnet.solana.com
solana config set --keypair mochi/anchor-program/keys/dev-authority.json
```

## 2) Fund the authority
```bash
solana airdrop 2 CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
```

## 3) Mint dev USDC and create ATAs
```bash
USDC_MINT=GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu
AUTH=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
solana-keygen pubkey mochi/anchor-program/keys/dev-usdc-mint.json
spl-token create-account $USDC_MINT --owner $AUTH --fee-payer mochi/anchor-program/keys/dev-authority.json
VAULT_USDC_ATA=$(spl-token account-info $USDC_MINT --owner $AUTH --output json | jq -r '.address')
# Mint some USDC for treasury
spl-token mint $USDC_MINT 1000 --owner mochi/anchor-program/keys/dev-usdc-mint.json --fee-payer mochi/anchor-program/keys/dev-authority.json
spl-token transfer $USDC_MINT 500 $VAULT_USDC_ATA --owner mochi/anchor-program/keys/dev-authority.json --fund-recipient
```

## 4) Deploy program
```bash
cd mochi/anchor-program
anchor build
anchor deploy
```

## 5) Initialize vault
```bash
anchor test --skip-build -- --nocapture  # optional sanity tests if added later

# Example via anchor-cli (pseudo)
anchor run initialize_vault -- \
  --pack-price-sol 100000000 \
  --pack-price-usdc 10000000 \
  --buyback-bps 9000 \
  --claim-window 3600 \
  --fee-bps 200 \
  --core-collection <CORE_COLLECTION_OPTIONAL> \
  --usdc-mint $USDC_MINT \
  --vault-treasury <VAULT_SOL_TREASURY=AUTH> \
  --vault-usdc-ata $VAULT_USDC_ATA
```

## 6) Mint Core assets and deposit
- Mint Metaplex Core assets using authority `CKjhhqf…` as update authority.
- For each Core asset ID:
```bash
anchor run deposit_card -- --core-asset <ASSET_PUBKEY> --template-id <u32> --rarity <enum>
```

## 7) Backend env
Set in `backend/.env`:
```
SOLANA_RPC=https://api.devnet.solana.com
SOLANA_DEVNET_RPC=https://api.devnet.solana.com
HELIUS_RPC_URL=<your helius key>
ADMIN_ADDRESS=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
PLATFORM_WALLET=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
TREASURY_WALLET=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
USDC_MINT=GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu
CORE_COLLECTION_ADDRESS=<optional>
SERVER_SEED=<random>
DATABASE_URL=sqlite:///./mochi.db
```

## 8) Frontend env
Set in `frontend/.env.local`:
```
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_ADMIN_ADDRESS=CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs
NEXT_PUBLIC_USDC_MINT=GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu
NEXT_PUBLIC_PROGRAM_ID=Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx
```

Note: Metaplex Core CPI custody/burn wiring is still TODO in the program; after adding it, rebuild/deploy and re-run initialize + deposit.

## Docker toolchain (clean Anchor builds)
- Build the image once (from repo root): `docker build -f Dockerfile.anchor -t anchor-dev .`
- Run with project + keys mounted:
```
docker run --rm -it \
  -v /root/mochi:/workspace \
  -v /root/mochi/anchor-program/keys:/root/.config/solana \
  -w /workspace/anchor-program \
  anchor-dev bash
```
- Inside the container:
  - `anchor clean`
  - `anchor build --program-name mochi_seed_sale --arch sbf`
  - `anchor deploy --program-name mochi_seed_sale --provider.cluster devnet`
- Versions baked into the image: `solana-cli 1.18.20`, `anchor-cli 0.30.1`, `rustc/cargo 1.91.1`. Use this container for all future builds/deploys to avoid host toolchain drift.
