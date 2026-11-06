import Image from 'next/image';
import Link from 'next/link';

export function SiteFooter() {
  return (
    // mt-auto: on a short page, the space goes above the footer, never below it.
    <footer className="mt-auto bg-brand-deep text-white/80">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-4">
          <Image src="/brand/tela-logo-white.png" alt="Tela Africa" width={150} height={45} className="h-9 w-auto" />
          <p className="max-w-sm text-sm leading-relaxed">
            Bills, splits, dues and tickets in one app. Every charge shown before you pay, and your PIN on every payment.
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-white">Tela</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/#features" className="hover:text-white">Features</Link></li>
            <li><Link href="/pay" className="hover:text-white">Pay a bill</Link></li>
            <li><Link href="/#how-it-works" className="hover:text-white">How it works</Link></li>
            <li><Link href="/#why-tela" className="hover:text-white">Why Tela</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-white">Help</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/#faq" className="hover:text-white">FAQ</Link></li>
            <li><Link href="/#download" className="hover:text-white">Download</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-white/50 sm:px-6">© {new Date().getFullYear()} Tela Africa. All rights reserved.</p>
      </div>
    </footer>
  );
}
