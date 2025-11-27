/**
 * Prototype script: mint Metaplex Core assets and deposit CardRecords.
 * - Reads public/data/meg_web_expanded.csv for template_id/name/rarity/image.
 * - Mints Core assets to the vault_authority PDA (owner).
 * - Calls deposit_card on the mochi_v2_vault program to create CardRecord PDAs.
 *
 * NOTE: This is a scaffold; wire your RPC/KEYS and install deps before running:
 *   npm install @solana/web3.js @metaplex-foundation/mpl-core @coral-xyz/anchor csv-parse
 *
 * Run with:
 *   TS_NODE_TRANSPILE_ONLY=1 ts-node scripts/mint_and_deposit.ts
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { MPL_CORE_PROGRAM_ID, createV1 } from '@metaplex-foundation/mpl-core';
import { Idl, Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, generateSigner, keypairIdentity, publicKey as umiPublicKey } from '@metaplex-foundation/umi';
import idl from '../anchor-program/target/idl/mochi_v2_vault.json';

const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const CSV_PATH =
  process.env.CORE_TEMPLATE_CSV ||
  path.join(__dirname, '../../nft_pipeline/data/mega-evolutions.csv');
const KEYPAIR_PATH = path.join(__dirname, '../anchor-program/keys/dev-authority.json');
const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const JSON_BASE =
  process.env.CORE_METADATA_BASE || 'https://mochims.fun/nft/metadata/mega-evolutions';

interface TemplateRow {
  templateId: number;
  name: string;
  rarity: string;
}

function loadKeypair(p: string): Keypair {
  const raw = fs.readFileSync(p, 'utf-8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function loadTemplates(): TemplateRow[] {
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parse(text, { columns: true, skip_empty_lines: true });
  const templates: TemplateRow[] = [];
  for (const r of rows) {
    const templateRaw = r.template_id ?? r.token_id ?? r.Number;
    if (!templateRaw) continue;
    const templateId = Number(templateRaw);
    if (!Number.isFinite(templateId)) continue;
    const rarity = (r.rarity || r.Rarity || 'Common').trim();
    const name = (r.card_name || r.name || r.Name || `Card ${templateId}`).trim();
    templates.push({
      templateId,
      name,
      rarity,
    });
  }
  // Deduplicate on template id (keep first occurrence)
  const seen = new Set<number>();
  const unique: TemplateRow[] = [];
  for (const tmpl of templates) {
    if (seen.has(tmpl.templateId)) continue;
    seen.add(tmpl.templateId);
    unique.push(tmpl);
  }
  return unique;
}

async function vaultPdas(program: Program, vaultState: PublicKey) {
  const [vaultAuth, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), vaultState.toBuffer()],
    PROGRAM_ID
  );
  return { vaultAuth, bump };
}

async function mintCoreToVault(connection: Connection, payer: Keypair, owner: PublicKey, uri: string, name: string) {
  // Use Umi helpers because mpl-core JS SDK is Umi-first.
  const umi = createUmi(RPC);
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(payer.secretKey);
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(keypairIdentity(signer));

  const asset = generateSigner(umi);
  await createV1(umi, {
    asset,
    payer: signer,
    owner: umiPublicKey(owner.toBase58()),
    updateAuthority: signer,
    name,
    uri,
  }).sendAndConfirm(umi);

  return new PublicKey(asset.publicKey.toString());
}

async function depositCard(program: Program, accounts: any, templateId: number, rarity: string) {
  const rarityKey = rarity.replace(/\s+/g, '').toLowerCase();
  const rarityEnum =
    rarityKey === 'uncommon'
      ? { uncommon: {} }
      : rarityKey === 'rare'
      ? { rare: {} }
      : rarityKey === 'ultrarare'
      ? { ultraRare: {} }
      : rarityKey === 'doublerare'
      ? { doubleRare: {} }
      : rarityKey === 'illustrationrare'
      ? { illustrationRare: {} }
      : rarityKey === 'specialillustrationrare'
      ? { specialIllustrationRare: {} }
      : rarityKey === 'megahyperrare'
      ? { megaHyperRare: {} }
      : rarityKey === 'energy'
      ? { energy: {} }
      : { common: {} };

  await program.methods
    .depositCard(new BN(templateId), rarityEnum as any)
    .accounts(accounts)
    .rpc();
}

async function ensureVaultInitialized(
  program: Program,
  vaultState: PublicKey,
  vaultAuth: PublicKey,
  usdcMint?: PublicKey
) {
  const info = await program.provider.connection.getAccountInfo(vaultState);
  if (info) {
    console.log('VaultState already exists:', vaultState.toBase58());
    return;
  }
  const packPriceSol = new BN(100_000_000); // 0.1 SOL in lamports
  const packPriceUsdc = new BN(10_000_000); // adjust to your USDC decimals (assumes 6)
  const buybackBps = 9000;
  const claimWindowSeconds = new BN(3600);
  const marketplaceFeeBps = 200;
  const coreCollection = null;
  const usdcMintOpt = usdcMint || null;

  console.log('Initializing vault state...');
  await program.methods
    .initializeVault(
      packPriceSol,
      packPriceUsdc,
      buybackBps,
      claimWindowSeconds,
      marketplaceFeeBps,
      coreCollection,
      usdcMintOpt
    )
    .accounts({
      admin: program.provider.wallet.publicKey,
      vaultState,
      vaultAuthority: vaultAuth,
      systemProgram: PublicKey.default,
    })
    .rpc();
}

async function main() {
  const payer = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC, 'confirmed');
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl as Idl, provider);

  const vaultState = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], PROGRAM_ID)[0];
  const { vaultAuth } = await vaultPdas(program, vaultState);
  const usdcMint = process.env.USDC_MINT ? new PublicKey(process.env.USDC_MINT) : null;

  await ensureVaultInitialized(program, vaultState, vaultAuth, usdcMint || undefined);

  const templates = loadTemplates().sort((a, b) => a.templateId - b.templateId);
  const maxCount = process.env.CORE_TEMPLATE_LIMIT ? Number(process.env.CORE_TEMPLATE_LIMIT) : null;
  const offset = process.env.CORE_TEMPLATE_OFFSET ? Number(process.env.CORE_TEMPLATE_OFFSET) : 0;
  const sliced = offset > 0 ? templates.slice(offset) : templates;
  const selected = maxCount && maxCount > 0 ? sliced.slice(0, maxCount) : sliced;
  console.log(
    `Minting ${selected.length} assets to vault authority ${vaultAuth.toBase58()} (offset ${offset})`
  );

  for (const row of selected) {
    const tokenId = String(row.templateId).padStart(3, '0');
    const jsonUri = `${JSON_BASE}/${tokenId}.json`;
    const name = `${row.name} #${tokenId}`;
    const coreAsset = await mintCoreToVault(connection, payer, vaultAuth, jsonUri, name);
    const [cardRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from('card_record'), vaultState.toBuffer(), coreAsset.toBuffer()],
      PROGRAM_ID
    );
    const existing = await connection.getAccountInfo(cardRecord);
    if (existing) {
      console.log(`CardRecord already exists for asset ${coreAsset.toBase58()}, skipping`);
      continue;
    }
    await depositCard(
      program,
      {
        admin: payer.publicKey,
        vaultState,
        vaultAuthority: vaultAuth,
        cardRecord,
        coreAsset,
        systemProgram: SystemProgram.programId,
        mplCoreProgram: MPL_CORE_PROGRAM_ID,
      },
      row.templateId,
      row.rarity
    );
    console.log(`Minted and deposited template ${row.templateId} (${row.rarity}) -> ${coreAsset.toBase58()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
