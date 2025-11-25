import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { WalletProvider } from '../components/WalletProvider';
import { Header } from '../components/Header';

const space = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Mochi v2 - RWA Pokémon Vault',
  description: 'Tokenized graded Pokémon cards on Solana with gacha packs and marketplace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={space.className}>
        <WalletProvider>
          <Header />
          <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
