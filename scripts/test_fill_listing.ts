import { Connection, PublicKey, TransactionInstruction, Transaction, Keypair, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const MARKET_VAULT_STATE = new PublicKey('mx1PX4zganVFtuneoc61jcuadctsUPk9UGbyhNnnLwT');
const MARKET_VAULT_AUTH = new PublicKey('CGhdCwqZx7zn6YNqASY6V4uxFZpegb1QDu5qnMNDKihd');
const MPL_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const TREASURY = new PublicKey('CKjhhqfijtAD48cg2FDcDH5ARCVjRiQS6ppmXFBM6Lcs'); // system-owned
const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

// Asset from previous test listing
const CORE_ASSET = new PublicKey('FK5X2C7G21Lqzyj1NQUR49Kt6kuMw3vq3bsYbVCM1m3d');

function listingPda(core: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('listing'), MARKET_VAULT_STATE.toBuffer(), core.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function cardRecordPda(core: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('card_record'), MARKET_VAULT_STATE.toBuffer(), core.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function parseListing(buf: Buffer) {
  // discriminator 8 bytes already present; skip
  let o = 8;
  const readPubkey = () => {
    const k = new PublicKey(buf.slice(o, o + 32));
    o += 32;
    return k;
  };
  const vault_state = readPubkey();
  const seller = readPubkey();
  const core_asset = readPubkey();
  const price_lamports = Number(buf.readBigUInt64LE(o));
  o += 8;
  const hasMint = buf[o] === 1;
  o += 1;
  let currency_mint: PublicKey | null = null;
  if (hasMint) {
    currency_mint = new PublicKey(buf.slice(o, o + 32));
    o += 32;
  }
  const status = buf[o];
  return { vault_state, seller, core_asset, price_lamports, currency_mint, status };
}

function sighash(name: string): Buffer {
  return Buffer.from(require('crypto').createHash('sha256').update(name).digest().slice(0, 8));
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const buyer = Keypair.generate();
  console.log('Buyer', buyer.publicKey.toBase58());
  // airdrop
  const sigAir = await conn.requestAirdrop(buyer.publicKey, 2e9);
  await conn.confirmTransaction(sigAir, 'confirmed');
  console.log('Airdrop sig', sigAir);

  const listing = listingPda(CORE_ASSET);
  const cardRecord = cardRecordPda(CORE_ASSET);

  const info = await conn.getAccountInfo(listing, 'confirmed');
  if (!info) throw new Error('Listing not found');
  const listingData = parseListing(Buffer.from(info.data));
  console.log('Listing data', listingData);

  const accounts = [
    { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
    { pubkey: listingData.seller, isSigner: false, isWritable: true },
    { pubkey: MARKET_VAULT_STATE, isSigner: false, isWritable: true },
    { pubkey: cardRecord, isSigner: false, isWritable: true },
    { pubkey: CORE_ASSET, isSigner: false, isWritable: true },
    { pubkey: listing, isSigner: false, isWritable: true },
    { pubkey: MARKET_VAULT_AUTH, isSigner: false, isWritable: false },
    { pubkey: TREASURY, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.concat([sighash('global:fill_listing')]);
  const ix = new TransactionInstruction({ programId: PROGRAM_ID, keys: accounts, data });

  const tx = new Transaction().add(ix);
  tx.feePayer = buyer.publicKey;
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  const sig = await sendAndConfirmTransaction(conn, tx, [buyer], { skipPreflight: false, commitment: 'confirmed' });
  console.log('Fill signature', sig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
