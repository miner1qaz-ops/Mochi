import { PublicKey } from '@solana/web3.js';

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvoter91bhDybDc6rz1bHwjSpssj1eA9pM7r3');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export async function deriveAta(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const [addr] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return addr;
}
