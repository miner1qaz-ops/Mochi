import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { InstructionMeta } from './api';

export function decodeInstruction(meta: InstructionMeta): TransactionInstruction {
  const keys = meta.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.is_signer, isWritable: k.is_writable }));
  return new TransactionInstruction({ programId: new PublicKey(meta.program_id), keys, data: Buffer.from(meta.data, 'base64') });
}

export function buildV0Tx(
  payer: PublicKey,
  blockhash: string,
  metas: InstructionMeta[],
): VersionedTransaction {
  const instructions = metas.map(decodeInstruction);
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return new VersionedTransaction(msg);
}
