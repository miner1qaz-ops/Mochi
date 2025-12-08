import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { WalletProvider } from '../components/WalletProvider';
import { Header } from '../components/Header';

const space = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Mochi – Phygital Pokémon Cards on Solana',
  description:
    'Mochi is a Web3 “Real World Asset” platform on Solana that bridges physical Pokémon cards with digital NFTs to create a phygital marketplace and gaming ecosystem.',
  openGraph: {
    title: 'Mochi – Phygital Pokémon Cards on Solana',
    description:
      'Bridge physical Pokémon cards with digital NFTs. Open packs, list on the marketplace, and redeem physical cards via Mochi on Solana.',
    url: 'https://getmochi.fun',
    siteName: 'Mochi',
    type: 'website',
  },
  metadataBase: new URL('https://getmochi.fun'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Mochi',
              url: 'https://getmochi.fun',
              description:
                'Mochi is a Web3 RWA platform on Solana bridging physical Pokémon cards with digital NFTs to create a phygital marketplace and gaming ecosystem.',
            }),
          }}
        />
      </head>
      <body className={space.className}>
        <WalletProvider>
          <Header />
          <main className="mx-auto w-full max-w-6xl lg:max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 xl:px-12 py-10 space-y-10">
            {children}
          </main>
        </WalletProvider>
      </body>
    </html>
  );
}
