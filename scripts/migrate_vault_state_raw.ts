import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import fs from 'fs';

const RPC = process.env.SOLANA_RPC || 'https://devnet.helius-rpc.com/?api-key=fdb761c1-284a-436f-8881-144c788743b7';
const KEYPAIR_PATH = process.env.ADMIN_KEYPAIR_PATH || '/root/mochi/anchor-program/keys/dev-authority.json';
const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const VAULT_STATE_PDA = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], PROGRAM_ID)[0];

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function u64(n: bigint) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n, 0);
  return buf;
}
function u16(n: number) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n, 0);
  return buf;
}
function i64(n: bigint) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n, 0);
  return buf;
}
function optionPubkey(pk: PublicKey | null) {
  if (!pk) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), pk.toBuffer()]);
}

async function main() {
  const admin = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC, 'confirmed');

  const packPriceSol = 120_000_000n; // 0.12 SOL in lamports
  const packPriceUsdc = 12_000_000n; // 12 USDC (6 decimals)
  const buybackBps = 9000;
  const claimWindow = 3600n;
  const marketplaceFeeBps = 200;
  const usdcMint = new PublicKey('GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu');
  const mochiMint = new PublicKey('2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT');
  const rewardPerPack = 100_000_000n; // 100 MOCHI @ 6 decimals

  const discriminator = Buffer.from([102, 131, 230, 150, 169, 240, 189, 142]);
  const data = Buffer.concat([
    discriminator,
    u64(packPriceSol),
    u64(packPriceUsdc),
    u16(buybackBps),
    i64(claimWindow),
    u16(marketplaceFeeBps),
    optionPubkey(usdcMint),
    optionPubkey(mochiMint),
    u64(rewardPerPack),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: VAULT_STATE_PDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction();
  tx.add(ix);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  const signed = await connection.sendTransaction(tx, [admin], { skipPreflight: false });
  console.log('migrate tx', signed);
  const res = await connection.confirmTransaction(signed, 'confirmed');
  console.log('confirmation', res);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
