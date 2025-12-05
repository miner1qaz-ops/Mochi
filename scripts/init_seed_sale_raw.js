const fs = require('fs');
const path = require('path');
const web3 = require('@solana/web3.js');
const crypto = require('crypto');

function sighash(name){return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0,8);}
function i64le(x){const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(x));return b;}
function u64le(x){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(x));return b;}

(async () => {
  const connection = new web3.Connection('https://api.devnet.solana.com','confirmed');
  const keypair = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname,'../anchor-program/keys/dev-authority.json'),'utf8'))));
  const authority = keypair.publicKey;
  const programId = new web3.PublicKey('2mt9FhkfhrkC5RL29MVPfMGVzpFR3eupGCMqKVYssiue');
  const mint = new web3.PublicKey('2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT');
  const treasury = authority;
  const tokenProgram = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const [sale] = web3.PublicKey.findProgramAddressSync([Buffer.from('seed_sale'), authority.toBuffer(), mint.toBuffer()], programId);
  const [vaultAuth] = web3.PublicKey.findProgramAddressSync([Buffer.from('seed_vault'), sale.toBuffer()], programId);
  const [seedVault] = web3.PublicKey.findProgramAddressSync([Buffer.from('seed_vault_token'), sale.toBuffer()], programId);

  console.log('Sale', sale.toBase58());
  console.log('Seed vault', seedVault.toBase58());

  const now = Math.floor(Date.now()/1000);
  const startTs = now + 60;
  const endTs = startTs + 30*24*3600;
  const priceTokensPerLamport = 2000n;
  const tokenCapRaw = 100000000000000n; // 100M * 1e6
  const solCapLamports = 50n * BigInt(web3.LAMPORTS_PER_SOL);

  const data = Buffer.concat([
    sighash('init_sale'),
    i64le(startTs),
    i64le(endTs),
    u64le(priceTokensPerLamport),
    u64le(tokenCapRaw),
    u64le(solCapLamports),
  ]);

  const keys = [
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: mint, isSigner: false, isWritable: false},
    {pubkey: treasury, isSigner: false, isWritable: true},
    {pubkey: sale, isSigner: false, isWritable: true},
    {pubkey: vaultAuth, isSigner: false, isWritable: false},
    {pubkey: seedVault, isSigner: false, isWritable: true},
    {pubkey: tokenProgram, isSigner: false, isWritable: false},
    {pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
  ];

  const ix = new web3.TransactionInstruction({keys, programId, data});
  const tx = new web3.Transaction().add(ix);
  const sig = await web3.sendAndConfirmTransaction(connection, tx, [keypair], {skipPreflight:false, commitment:'confirmed'});
  console.log('Init tx', sig);
})();
