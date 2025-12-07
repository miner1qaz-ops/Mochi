'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PricingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/market');
  }, [router]);
  return <p className="text-white/70">Redirecting to Market…</p>;
}
