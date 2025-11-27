import { AnchorProvider, BN, Idl, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../anchor-program/target/idl/mochi_v2_vault.json';

const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR_PATH || '/root/mochi/anchor-program/keys/dev-authority.json';

type MissingCard = {
  asset: string;
  templateId: number;
  rarity: string;
};

const MISSING: MissingCard[] = [
  { asset: 'BvF65aJmPZ9yh12iiXVgLpqBod7fP6FeifTdaKGnRqSe', templateId: 77, rarity: 'DoubleRare' },
  { asset: '9TLDuw79rAdqAp49tQNLiWWMsrXLSZe5uLJiK9FBpBA2', templateId: 152, rarity: 'IllustrationRare' },
  { asset: '4AELiJuZutCeY24wsbQDBcSQt396LWFo1MndrtMbxHZB', templateId: 41, rarity: 'Uncommon' },
];

function loadKeypair(path: string): Keypair {
  const raw = require(path);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function rarityVariant(name: string) {
  const map: Record<string, any> = {
    Common: { common: {} },
    Uncommon: { uncommon: {} },
    Rare: { rare: {} },
    DoubleRare: { doubleRare: {} },
    UltraRare: { ultraRare: {} },
    IllustrationRare: { illustrationRare: {} },
    SpecialIllustrationRare: { specialIllustrationRare: {} },
    MegaHyperRare: { megaHyperRare: {} },
    Energy: { energy: {} },
  };
  const variant = map[name];
  if (!variant) {
    throw new Error(`Unsupported rarity ${name}`);
  }
  return variant;
}

async function main() {
  const payer = loadKeypair(KEYPAIR_PATH);
  const wallet = new Wallet(payer);
  const connection = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl as Idl, provider);

  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), vaultState.toBuffer()],
    PROGRAM_ID
  );

  for (const entry of MISSING) {
    const asset = new PublicKey(entry.asset);
    const [cardRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from('card_record'), vaultState.toBuffer(), asset.toBuffer()],
      PROGRAM_ID
    );
    const existing = await provider.connection.getAccountInfo(cardRecord);
    if (existing) {
      console.log(`CardRecord already exists for ${entry.asset}, skipping`);
      continue;
    }
    console.log(`Depositing template ${entry.templateId} (${entry.rarity}) for asset ${entry.asset}`);
    await program.methods
      .depositCard(new BN(entry.templateId), rarityVariant(entry.rarity))
      .accounts({
        admin: wallet.publicKey,
        vaultState,
        coreAsset: asset,
        cardRecord,
        vaultAuthority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
