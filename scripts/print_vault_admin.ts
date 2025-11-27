import { AnchorProvider, Idl, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import idl from '../anchor-program/target/idl/mochi_v2_vault.json';

const PROGRAM_ID = new PublicKey('Gc7u33eCs81jPcfzgX4nh6xsiEtRYuZUyHKFjmf5asfx');
const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.ADMIN_KEYPAIR_PATH || '/root/mochi/anchor-program/keys/passkey.json';

function loadKeypair(path: string): Keypair {
  const raw = require(path);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const payer = loadKeypair(KEYPAIR_PATH);
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(new Connection(RPC, 'confirmed'), wallet, {
    commitment: 'confirmed',
  });
  const program = new Program(idl as Idl, provider);
  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], PROGRAM_ID);
  const state = await program.account.vaultState.fetch(vaultState);
  console.log('admin', state.admin.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
