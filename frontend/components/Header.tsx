'use client';

import Link from 'next/link';
import Image from 'next/image';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="md:sticky top-0 z-30 backdrop-blur bg-[#05070f]/80 border-b border-white/5">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 py-4 px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/mochi_icon.png" alt="Mochi" width={32} height={32} className="rounded-md" />
          <span className="text-xl font-semibold tracking-tight">Mochi</span>
        </Link>
        <nav className="hidden lg:flex gap-3 text-sm">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-full transition border border-transparent hover:border-white/10 ${
                  active ? 'bg-white/10 text-white' : 'text-white/80'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden lg:block">
          <WalletMultiButton className="!bg-sakura !text-ink !font-semibold !h-11 !px-4" />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="lg:hidden inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 p-2 text-white/80 hover:text-white hover:border-white/25 transition"
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          <span className="sr-only">Toggle navigation</span>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="stroke-current">
            {open ? (
              <path d="M6 6l12 12M6 18L18 6" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>
      {open && (
        <div className="lg:hidden border-t border-white/5 bg-[#05070f]/95 backdrop-blur px-6 pb-6">
          <div className="flex flex-col gap-3 py-4">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`w-full rounded-xl px-4 py-3 text-sm font-semibold border transition ${
                    active ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/80 hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <WalletMultiButton className="!w-full !justify-center !bg-sakura !text-ink !font-semibold !h-11" />
          </div>
        </div>
      )}
    </header>
  );
}
