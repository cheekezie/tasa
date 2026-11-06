import { ArrowRight, GraduationCap, Lightbulb, ShieldCheck, Smartphone, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { PRODUCTS, type ProductSlug } from '@/lib/quickpay';

export const metadata: Metadata = {
  title: 'Pay a bill without the app',
  description: 'Buy a JAMB or WAEC PIN, an electricity token or airtime on the web. Pay by bank transfer; your PIN or token is texted to you.',
};

const icons: Record<ProductSlug, LucideIcon> = { jamb: GraduationCap, waec: GraduationCap, electricity: Lightbulb, airtime: Smartphone };

export default function PayPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent-hot">No app needed</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-brand-deep sm:text-4xl">Pay a one-off bill on the web</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Pick what you need, pay by bank transfer, and get your PIN or token here and by SMS. For anything you pay regularly, the Tela app is faster.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {PRODUCTS.map((p) => {
            const Icon = icons[p.slug];
            return (
              <Link key={p.slug} href={`/pay/${p.slug}`} className="group flex items-start gap-4 rounded-3xl bg-white p-6 ring-1 ring-line transition hover:ring-brand">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mint text-brand">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <span className="flex-1">
                  <span className="block text-lg font-semibold text-brand-deep">{p.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-muted">{p.blurb}</span>
                </span>
                <ArrowRight className="mt-1 h-5 w-5 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
              </Link>
            );
          })}
        </div>
        <p className="mt-8 flex items-start gap-2 text-sm text-ink-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-light" aria-hidden />
          If anything goes wrong, your money is kept safe in a Tela wallet for your phone number. Sign up with that number in the app to use it.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
