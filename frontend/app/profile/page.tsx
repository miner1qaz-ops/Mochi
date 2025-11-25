'use client';

import { useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';

export default function ProfileRedirect() {
  const { publicKey } = useWallet();
  const router = useRouter();
  useEffect(() => {
    if (publicKey) {
      router.replace(`/profile/${publicKey.toBase58()}`);
    }
  }, [publicKey, router]);
  return <p className="text-white/60">Connect wallet to view profile.</p>;
}
