import type { Metadata, Viewport } from 'next';
import { Sora } from 'next/font/google';

import { site } from '@/lib/site';
import './globals.css';

// The app's typeface, so the site reads like Tela.
const sora = Sora({ subsets: ['latin'], display: 'swap', variable: '--font-sora' });

const description =
  'Pay electricity, airtime, data and TV in seconds, split bills with friends, collect group dues and sell event tickets. Every charge shown before you pay.';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: 'Tela: pay bills, split them, collect dues', template: '%s · Tela' },
  description,
  applicationName: 'Tela',
  openGraph: { type: 'website', siteName: 'Tela', title: 'Tela: pay bills, split them, collect dues', description, url: '/' },
  twitter: { card: 'summary_large_image', title: 'Tela', description },
};

export const viewport: Viewport = {
  themeColor: '#0A4D3C',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" className={sora.variable}>
      <body className="flex min-h-screen flex-col bg-surface">{children}</body>
    </html>
  );
}
