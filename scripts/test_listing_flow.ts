import fs from 'fs';
import path from 'path';
import { Keypair, PublicKey, Connection, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createV1, mplCore } from '@metaplex-foundation/mpl-core';
import { generateSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const MARKET_VAULT_STATE = new PublicKey('mx1PX4zganVFtuneoc61jcuadctsUPk9UGbyhNnnLwT');
const MARKET_VAULT_AUTH = new PublicKey('CGhdCwqZx7zn6YNqASY6V4uxFZpegb1QDu5qnMNDKihd');
const MPL_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const SELLER_PATH = path.join(__dirname, 'test-seller.json');
const DEV_AUTH_PATH = path.join(__dirname, '..', 'anchor-program', 'keys', 'dev-authority.json');

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

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

async function mintCoreToSeller(): Promise<PublicKey> {
  const umi = createUmi('https://api.devnet.solana.com');
  const devAuthSecret = Uint8Array.from(JSON.parse(fs.readFileSync(DEV_AUTH_PATH, 'utf8')));
  const sellerSecret = Uint8Array.from(JSON.parse(fs.readFileSync(SELLER_PATH, 'utf8')));
  const devSigner = umi.eddsa.createKeypairFromSecretKey(devAuthSecret);
  const sellerSigner = umi.eddsa.createKeypairFromSecretKey(sellerSecret);
  umi.use(keypairIdentity(devSigner));
  umi.use(mplCore());
  const asset = generateSigner(umi);
  await createV1(umi, {
    asset,
    name: 'Test Asset',
    uri: 'https://example.com/test.json',
    authority: devSigner.publicKey,
    owner: sellerSigner.publicKey,
  }).sendAndConfirm(umi);
  return new PublicKey(asset.publicKey);
}

function encodeListCard(priceLamports: bigint, currencyMint: PublicKey | null, templateId: number, rarityTag: number): Buffer {
  const disc = createHash('sha256').update('global:list_card').digest().slice(0, 8);
  const buf = Buffer.alloc(8 + 8 + 1 + (currencyMint ? 32 : 0) + 4 + 1);
  let o = 0;
  disc.copy(buf, o); o += 8;
  buf.writeBigUInt64LE(priceLamports, o); o += 8;
  buf.writeUInt8(currencyMint ? 1 : 0, o); o += 1;
  if (currencyMint) {
    Buffer.from(currencyMint.toBytes()).copy(buf, o); o += 32;
  }
  buf.writeUInt32LE(templateId, o); o += 4;
  buf.writeUInt8(rarityTag, o); o += 1;
  return buf.slice(0, o);
}

async function main() {
  const seller = loadKeypair(SELLER_PATH);
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

  console.log('Minting core asset to seller...');
  const coreAsset = await mintCoreToSeller();
  console.log('Minted core asset', coreAsset.toBase58());

  const cardRecord = cardRecordPda(coreAsset);
  const listing = listingPda(coreAsset);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: MARKET_VAULT_STATE, isSigner: false, isWritable: true },
      { pubkey: cardRecord, isSigner: false, isWritable: true },
      { pubkey: coreAsset, isSigner: false, isWritable: true },
      { pubkey: listing, isSigner: false, isWritable: true },
      { pubkey: MARKET_VAULT_AUTH, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeListCard(BigInt(1_000_000_000), null, 1, 0),
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = seller.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(seller);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log('Listed successfully, sig', sig);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
