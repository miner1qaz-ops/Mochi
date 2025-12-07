'use client';

import Link from 'next/link';
import Image from 'next/image';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Home' },
  { href: '/gacha', label: 'Gacha' },
  { href: '/market', label: 'Market' },
  { href: '/stadium', label: 'Stadium' },
  { href: '/profile', label: 'Profile' },
  { href: '/admin', label: 'Admin' }
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="md:sticky top-0 z-30 backdrop-blur bg-[#05070f]/70 border-b border-white/5">
      <div className="max-w-6xl mx-auto flex items-center justify-between py-4 px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/mochi_icon.png" alt="Mochi" width={32} height={32} className="rounded-md" />
          <span className="text-xl font-semibold tracking-tight">Mochi</span>
        </Link>
        <nav className="flex gap-4 text-sm">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1 rounded-full transition ${active ? 'bg-white/10' : 'hover:bg-white/5'}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <WalletMultiButton className="!bg-sakura !text-ink !font-semibold" />
      </div>
    </header>
  );
}
