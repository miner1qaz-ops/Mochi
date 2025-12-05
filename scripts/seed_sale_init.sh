#!/usr/bin/env bash
set -euo pipefail

# This script assumes a clean Anchor 0.30 toolchain.
# It rebuilds and redeploys mochi_seed_sale, then runs init_sale with fixed params.

PROGRAM_ID=2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue
MINT=2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT
AUTH_KEY=anchor-program/keys/dev-authority.json
RPC=https://api.devnet.solana.com

echo "Using program id: $PROGRAM_ID"

# 1) Build and deploy (adjust if a different wallet or upgrade authority is needed)
anchor build --program-name mochi_seed_sale
anchor deploy --program-name mochi_seed_sale --provider.cluster devnet

# 2) Run init_sale via Anchor CLI using the IDL
node - <<'JS'
const fs = require('fs');
const path = require('path');
const anchor = require('@coral-xyz/anchor');
const BN = anchor.BN;

const idl = JSON.parse(fs.readFileSync(path.join('anchor-program/target/idl/mochi_seed_sale.json'),'utf8'));
const programId = new anchor.web3.PublicKey('2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue');
const connection = new anchor.web3.Connection('https://api.devnet.solana.com','confirmed');
const wallet = new anchor.Wallet(anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('anchor-program/keys/dev-authority.json','utf8')))));
const provider = new anchor.AnchorProvider(connection, wallet, {commitment:'confirmed', skipPreflight:false});
anchor.setProvider(provider);
const program = new anchor.Program(idl, programId, provider);

const mint = new anchor.web3.PublicKey('2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT');
const authority = wallet.publicKey;
const treasury = authority;
const [sale] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('seed_sale'), authority.toBuffer(), mint.toBuffer()], programId);
const [vaultAuth] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('seed_vault'), sale.toBuffer()], programId);
const [seedVault] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('seed_vault_token'), sale.toBuffer()], programId);

const now = Math.floor(Date.now()/1000);
const startTs = new BN(now + 60);
const endTs = new BN(now + 60 + 30*24*3600);
const priceTokensPerLamport = new BN(2000);
const tokenCapRaw = new BN('100000000000000'); // 100M * 1e6
const solCapLamports = new BN(50 * 1_000_000_000);

(async() => {
  console.log('Sale PDA', sale.toBase58());
  console.log('Seed vault PDA', seedVault.toBase58());
  const txSig = await program.methods.initSale(startTs, endTs, priceTokensPerLamport, tokenCapRaw, solCapLamports)
    .accounts({
      authority,
      mint,
      treasury,
      sale,
      vaultAuthority: vaultAuth,
      seedVault,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc({skipPreflight:false, commitment:'confirmed'});
  console.log('Init sale tx:', txSig);
})();
JS
