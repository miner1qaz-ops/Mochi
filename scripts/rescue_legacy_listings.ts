import fs from 'fs';
import path from 'path';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { MPL_CORE_PROGRAM_ID } from '@metaplex-foundation/mpl-core';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../anchor-program/idl/mochi_v2_vault.json';

type RescueTarget = {
  listing: string;
  coreAsset: string;
  legacyVaultState: string;
  seller: string;
};

const RPC_URL = process.env.RPC_URL || anchor.web3.clusterApiUrl('devnet');
const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR ||
  path.join(process.env.HOME || '.', '.config', 'solana', 'id.json');
const MARKETPLACE_VAULT_STATE = process.env.MARKETPLACE_VAULT_STATE;
const PROGRAM_ID = new PublicKey((idl as any).address);

const CARD_RECORD_SEED = 'card_record';
const MARKETPLACE_VAULT_AUTHORITY_SEED = 'market_vault_authority';
const GACHA_VAULT_AUTHORITY_SEED = 'vault_authority';

// Stuck listings to rescue (legacy vault_state -> seller).
const RESCUE_TARGETS: RescueTarget[] = [
  {
    listing: '46bjuegniqdVHDXUEpgPphAyLjMey5VrpBaz6f6QCFTq',
    coreAsset: '443js4nrQzX2777qKq13BfZ6DkkZaVmJPvE95y6nspcu',
    legacyVaultState: 'ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d',
    seller: '63KMUfAuxyLPQNeVP5sDYz3VwiBMpyNnK9W6n1rkYkyo',
  },
  {
    listing: '8DULkQDmWBaW2dLUPXtQNZjWu2A9CnM4RnHTwxBQzVL9',
    coreAsset: '9JxeTugbTXRxFNJZtBPc6Zaa8wUXKypB3us6swwtbSYZ',
    legacyVaultState: 'ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d',
    seller: '63KMUfAuxyLPQNeVP5sDYz3VwiBMpyNnK9W6n1rkYkyo',
  },
  {
    listing: '6uzWoymseCzm8kJ6tpf6VdTEK7a44rJfJoQMwdye2773',
    coreAsset: 'G6QZrK91JKCK2Y9w2C1S3DtsTDGhjUYx6iDZy8grwzZ6',
    legacyVaultState: 'ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d',
    seller: '63KMUfAuxyLPQNeVP5sDYz3VwiBMpyNnK9W6n1rkYkyo',
  },
  {
    listing: 'Ang9S3cdBfjq64cYeuspwhn7m6iZ8wX8eiV7eTsTXRjB',
    coreAsset: '4FTB9h3bGC4zJH2pPyK58YtCMFLqdEBG5pgsPPEBQRvq',
    legacyVaultState: 'ChDquu2qJZ2yHuFzMNcSpHjDf7mwGN2x9KpNQ8ocE53d',
    seller: '63KMUfAuxyLPQNeVP5sDYz3VwiBMpyNnK9W6n1rkYkyo',
  },
];

function loadKeypair(keypairPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  if (!MARKETPLACE_VAULT_STATE) {
    throw new Error('Set MARKETPLACE_VAULT_STATE env var to the canonical marketplace vault_state PDA');
  }
  if (RESCUE_TARGETS.length === 0) {
    throw new Error('Populate RESCUE_TARGETS with the 10 garbage listings before running this script.');
  }

  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed');
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  const program = new Program(idl as anchor.Idl, PROGRAM_ID, provider);

  const marketplaceVaultState = new PublicKey(MARKETPLACE_VAULT_STATE);

  for (const target of RESCUE_TARGETS) {
    const legacyVaultState = new PublicKey(target.legacyVaultState);
    const coreAsset = new PublicKey(target.coreAsset);
    const listing = new PublicKey(target.listing);
    const seller = new PublicKey(target.seller);

    const [cardRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from(CARD_RECORD_SEED), legacyVaultState.toBuffer(), coreAsset.toBuffer()],
      PROGRAM_ID,
    );

    const [marketAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from(MARKETPLACE_VAULT_AUTHORITY_SEED), legacyVaultState.toBuffer()],
      PROGRAM_ID,
    );
    const [gachaAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from(GACHA_VAULT_AUTHORITY_SEED), legacyVaultState.toBuffer()],
      PROGRAM_ID,
    );

    const marketAuthInfo = await connection.getAccountInfo(marketAuth);
    const gachaAuthInfo = await connection.getAccountInfo(gachaAuth);
    const legacyVaultAuthority = marketAuthInfo ? marketAuth : gachaAuth;

    console.log('Rescuing listing', listing.toBase58(), 'core_asset', coreAsset.toBase58());
    const sig = await program.methods
      .adminRescueLegacyListing()
      .accounts({
        admin: admin.publicKey,
        marketplaceVaultState,
        legacyVaultState,
        cardRecord,
        coreAsset,
        listing,
        legacyVaultAuthority,
        seller,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      })
      .signers([admin])
      .rpc({ commitment: 'confirmed' });

    console.log('  -> returned to seller; tx', sig);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
