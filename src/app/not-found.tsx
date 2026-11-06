import Link from 'next/link';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent-hot">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-brand-deep">This page isn’t here</h1>
        <p className="mt-4 text-ink-muted">The link may be old or mistyped.</p>
        <Link href="/" className="mt-8 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep">
          Back to Tela
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
