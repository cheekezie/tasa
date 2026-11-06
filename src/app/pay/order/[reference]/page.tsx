import type { Metadata } from 'next';

import { OrderStatus } from '@/components/OrderStatus';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

type Props = { params: Promise<{ reference: string }>; searchParams: Promise<{ key?: string }> };

export const metadata: Metadata = {
  title: 'Your order',
  // The link holds the order's secret key: keep it out of search engines and other sites' logs.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function OrderPage({ params, searchParams }: Props) {
  const { reference } = await params;
  const { key = '' } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <OrderStatus reference={reference} accessKey={key} />
      </main>
      <SiteFooter />
    </>
  );
}
