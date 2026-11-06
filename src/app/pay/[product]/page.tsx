import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PayForm } from '@/components/PayForm';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { guestApi, type GuestPlan, type GuestService } from '@/lib/guestApi';
import { PRODUCTS, productBySlug } from '@/lib/quickpay';

type Props = { params: Promise<{ product: string }> };

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ product: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = productBySlug((await params).product);
  return product ? { title: `Buy ${product.title} online`, description: product.blurb } : {};
}

export default async function PayProductPage({ params }: Props) {
  const product = productBySlug((await params).product);
  if (!product) notFound();
  // What's on sale right now: providers, prices, and anything paused in the back office.
  let service: GuestService | undefined;
  let plans: GuestPlan[] = [];
  let unavailable: string | null = null;
  try {
    service = (await guestApi.services()).find((s) => s.id === product.serviceId);
    if (!service || !service.available) unavailable = service?.pausedMessage ?? 'This isn’t available on the web right now.';
    else if (product.priced === 'plan' && product.provider) plans = await guestApi.plans(product.serviceId, product.provider);
  } catch {
    unavailable = 'We couldn’t load prices right now. Try again in a moment.';
  }
  const providers = (service?.providers ?? []).filter((p) => !product.provider || p.code === product.provider);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Link href="/pay" className="text-sm text-ink-muted hover:text-brand">
          ← Everything you can pay
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-brand-deep">{product.title}</h1>
        <p className="mt-2 text-ink-muted">{product.blurb}</p>
        {unavailable ? (
          <p className="mt-8 rounded-2xl bg-white p-6 text-ink-muted ring-1 ring-line">{unavailable}</p>
        ) : (
          <PayForm product={product} providers={providers} plans={plans} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
