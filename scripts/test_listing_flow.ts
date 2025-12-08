import assert from 'assert';
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

enum CardStatus {
  Available = 0,
  Reserved = 1,
  UserOwned = 2,
  RedeemPending = 3,
  Burned = 4,
  Deprecated = 5,
}

enum ListingStatus {
  Active = 0,
  Filled = 1,
  Cancelled = 2,
  Burned = 3,
  Deprecated = 4,
}

type ListingAccount = {
  vaultState: PublicKey;
  seller: PublicKey;
  coreAsset: PublicKey;
  priceLamports: bigint;
  currencyMint: PublicKey | null;
  status: ListingStatus;
};

type CardRecordAccount = {
  vaultState: PublicKey;
  coreAsset: PublicKey;
  templateId: number;
  rarity: number;
  status: CardStatus;
  owner: PublicKey;
};

function decodeListingAccount(data: Buffer): ListingAccount {
  if (data.length < 8 + 32 * 3 + 8 + 1 + 1) {
    throw new Error('Listing account data too short');
  }
  let o = 8; // skip discriminator
  const vaultState = new PublicKey(data.slice(o, o + 32)); o += 32;
  const seller = new PublicKey(data.slice(o, o + 32)); o += 32;
  const coreAsset = new PublicKey(data.slice(o, o + 32)); o += 32;
  const priceLamports = data.readBigUInt64LE(o); o += 8;
  const hasCurrency = data.readUInt8(o); o += 1;
  let currencyMint: PublicKey | null = null;
  if (hasCurrency) {
    currencyMint = new PublicKey(data.slice(o, o + 32));
    o += 32;
  }
  const status = data.readUInt8(o) as ListingStatus;
  return { vaultState, seller, coreAsset, priceLamports, currencyMint, status };
}

function decodeCardRecord(data: Buffer): CardRecordAccount {
  if (data.length < 8 + 32 * 3 + 4 + 1 + 1) {
    throw new Error('CardRecord account data too short');
  }
  let o = 8; // skip discriminator
  const vaultState = new PublicKey(data.slice(o, o + 32)); o += 32;
  const coreAsset = new PublicKey(data.slice(o, o + 32)); o += 32;
  const templateId = data.readUInt32LE(o); o += 4;
  const rarity = data.readUInt8(o); o += 1;
  const status = data.readUInt8(o) as CardStatus; o += 1;
  const owner = new PublicKey(data.slice(o, o + 32));
  return { vaultState, coreAsset, templateId, rarity, status, owner };
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

  const listingInfo = await conn.getAccountInfo(listing, 'confirmed');
  const cardRecordInfo = await conn.getAccountInfo(cardRecord, 'confirmed');
  assert(cardRecordInfo?.data, 'CardRecord account missing on-chain');
  assert(listingInfo?.data, 'Listing account missing on-chain');

  const listingAccount = decodeListingAccount(listingInfo.data);
  const cardRecordAccount = decodeCardRecord(cardRecordInfo.data);

  assert.strictEqual(
    listingAccount.vaultState.toBase58(),
    MARKET_VAULT_STATE.toBase58(),
    'Listing PDA must target the canonical market vault',
  );
  assert.strictEqual(
    listingAccount.seller.toBase58(),
    seller.publicKey.toBase58(),
    'Listing seller should be the signer',
  );
  assert.strictEqual(listingAccount.status, ListingStatus.Active, 'Listing status should initialize as Active');

  assert.strictEqual(
    cardRecordAccount.vaultState.toBase58(),
    MARKET_VAULT_STATE.toBase58(),
    'CardRecord PDA must target the canonical market vault',
  );
  assert.strictEqual(
    cardRecordAccount.owner.toBase58(),
    MARKET_VAULT_AUTH.toBase58(),
    'CardRecord custody should transfer to vault authority on list',
  );
  assert.strictEqual(
    cardRecordAccount.status,
    CardStatus.Reserved,
    'CardRecord status should be Reserved after listing',
  );
  console.log('Validated Listing and CardRecord PDAs were initialized correctly.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
