import Image from 'next/image';
import Link from 'next/link';

const nav = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#why-tela', label: 'Why Tela' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/pay', label: 'Pay a bill' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Tela home" className="shrink-0">
          <Image src="/brand/tela-logo.png" alt="Tela Africa" width={140} height={42} priority className="h-8 w-auto" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 text-sm text-ink-muted md:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-brand">
              {item.label}
            </Link>
          ))}
        </nav>
        <Link href="/#download" className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep">
          Get the app
        </Link>
      </div>
    </header>
  );
}
