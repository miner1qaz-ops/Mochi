import { AnchorProvider, BN, Program, Wallet, web3 } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import idlRaw from '../anchor-program/target/idl/mochi_v2_vault.json';

const RPC = process.env.SOLANA_RPC || 'https://devnet.helius-rpc.com/?api-key=fdb761c1-284a-436f-8881-144c788743b7';
const KEYPAIR_PATH = process.env.ADMIN_KEYPAIR_PATH || '/root/mochi/anchor-program/keys/dev-authority.json';

function loadKeypair(path: string): Keypair {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = require(path);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const admin = loadKeypair(KEYPAIR_PATH);
  const wallet = new Wallet(admin);
  const connection = new Connection(RPC, 'confirmed');
  // Strip account layouts (missing type info in IDL) to avoid Anchor ctor crash.
  const idl: any = { ...(idlRaw as any), accounts: [] };
  console.log('idl accounts length', Array.isArray(idl.accounts) ? idl.accounts.length : 'n/a');
  const programId = new PublicKey(idl.address);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  // Casts to loosen Anchor's generic typing for this one-off script.
  const program = new Program(idl as any, programId, provider as any);

  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], programId);

  const packPriceSolLamports = new BN(120_000_000); // 0.12 SOL
  const packPriceUsdc = new BN(12_000_000); // 12 USDC (6 decimals)
  const buybackBps = 9000; // 90% sell-back
  const claimWindowSeconds = new BN(3600); // 1 hour claim window
  const marketplaceFeeBps = 200; // 2% fee
  const usdcMint = new PublicKey('GWRsfsckjMn2vRZjUf3756AdZiNJULG6E6oTvbK6SvRu');
  const mochiMint = new PublicKey('2iL86tZQkt3MB4iVbFwNefEdTeR3Dh5QNNxDfuF16yjT');
  const rewardPerPack = new BN(100_000_000); // 100 MOCHI @ 6 decimals

  console.log('Migrating vault state', vaultState.toBase58());

  const sig = await program.methods
    .migrateVaultState(
      packPriceSolLamports,
      packPriceUsdc,
      buybackBps,
      claimWindowSeconds,
      marketplaceFeeBps,
      usdcMint,
      mochiMint,
      rewardPerPack,
    )
    .accounts({
      admin: admin.publicKey,
      vaultState,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();

  console.log('Migration tx', sig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
