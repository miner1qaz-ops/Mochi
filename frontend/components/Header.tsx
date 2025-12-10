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
  { href: '/stadium', label: 'Play' },
  { href: '/profile', label: 'Profile' },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="md:sticky top-0 z-30 bg-[#05070f]/90 border-b border-white/5 backdrop-blur">
      <div className="max-w-6xl lg:max-w-7xl 2xl:max-w-[90rem] mx-auto px-6 lg:px-8 xl:px-12 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/mochi_icon.png" alt="Mochi" width={36} height={36} className="rounded-md animate-pulse" />
            <span className="text-xl font-semibold tracking-tight text-white">Mochi</span>
          </Link>
          <div className="hidden lg:flex flex-1 items-center justify-center gap-3">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    active
                      ? 'cta-primary h-10 px-4 text-xs !text-ink shadow-[0_0_18px_rgba(33,212,253,0.35)]'
                      : 'cta-ghost h-10 px-4 text-xs border-white/15 text-white/80 hover:text-white hover:border-white/30'
                  }
                  data-tone={active ? 'aurora' : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
          <div className="hidden lg:block">
            <WalletMultiButton className="!bg-white/10 !text-white !font-semibold !h-10 !px-4 !border !border-white/20 hover:!bg-white/20 hover:!text-white" />
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
          <div className="lg:hidden border-t border-white/5 bg-[#05070f]/95 backdrop-blur px-1 pb-4">
            <div className="flex flex-col gap-2 py-3">
              {links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`w-full rounded-xl px-4 py-3 text-sm font-semibold border transition ${
                      active
                        ? 'bg-gradient-to-r from-aurora/80 to-sakura/70 border-aurora/40 text-[#05070f] font-bold'
                        : 'bg-white/5 border-white/10 text-white/80 hover:text-white'
                    }`}
                    onClick={() => setOpen(false)}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <WalletMultiButton className="!w-full !justify-center !bg-white/10 !text-white !font-semibold !h-11 !border !border-white/20 hover:!bg-white/20 hover:!text-white" />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
