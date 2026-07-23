import type { Metadata } from 'next';
import { Inter, Geist_Mono } from 'next/font/google';

import { SiteHeader } from '@/components/site-header';
import { Providers } from '@/components/providers';

import './globals.css';
import './styles/primitives.css';
import './styles/home.css';
import './styles/docs.css';
import './styles/explore.css';
import './styles/app-surface.css';

// Variable Inter so the interface can use the 510 weight that reads as "medium but not bold".
const inter = Inter({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'PonsVault — Launch tokens with a vault attached',
  description:
    'A vault layer for pons launches on Robinhood Chain. Choose what your creator fees do — buy back and burn, fund a lottery, or split to a team — enforced on-chain.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
