'use client';

import { AlertCircle, Check, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { StoreButtons } from '@/components/StoreButtons';
import { GuestApiError, guestApi, type GuestOrder } from '@/lib/guestApi';
import { naira } from '@/lib/quickpay';

/** How often to look while waiting: for the transfer, then (faster) for the provider. */
const POLL_MS = { awaiting_payment: 5000, paying: 3000 } as const;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-line transition hover:ring-brand">
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * One website order, kept up to date: where to send the transfer, then the bill being paid,
 * then the PIN or token (also texted), or where the money is if it didn't go through.
 */
export function OrderStatus({ reference, accessKey }: { reference: string; accessKey: string }) {
  const [order, setOrder] = useState<GuestOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await guestApi.status(reference, accessKey);
        if (cancelled) return;
        setOrder(next);
        setError(null);
        if (next.status === 'awaiting_payment' || next.status === 'paying') timer = setTimeout(load, POLL_MS[next.status]);
      } catch (err) {
        if (cancelled) return;
        // Not found means a wrong link; anything else, keep trying quietly.
        if (err instanceof GuestApiError && err.code === 'NOT_FOUND') setError('We couldn’t find this order. Check the link you were given.');
        else timer = setTimeout(load, 8000);
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reference, accessKey]);

  if (error) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center ring-1 ring-line">
        <AlertCircle className="mx-auto h-10 w-10 text-accent-hot" aria-hidden />
        <p className="mt-4 text-ink">{error}</p>
        <Link href="/pay" className="mt-6 inline-block text-sm font-semibold text-brand">
          Start a new payment
        </Link>
      </div>
    );
  }
  if (!order) {
    return (
      <p className="flex items-center justify-center gap-2 py-20 text-ink-muted">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading your order…
      </p>
    );
  }

  const what = [order.bill.planName ?? order.bill.providerName, order.bill.account, order.bill.customerName].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink-muted">Order {order.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-brand-deep">
          {order.status === 'awaiting_payment' && 'Transfer to complete your payment'}
          {order.status === 'paying' && 'Payment received. Paying your bill…'}
          {order.status === 'delivered' && 'Done. Here it is.'}
          {order.status === 'failed' && 'This didn’t go through'}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{what}</p>
      </div>

      {order.status === 'awaiting_payment' && order.payTo && (
        <div className="rounded-3xl bg-white p-6 ring-1 ring-line sm:p-8">
          <p className="text-sm text-ink-muted">Transfer exactly</p>
          <div className="mt-1 flex items-center justify-between gap-4">
            <p className="text-3xl font-semibold text-brand-deep">{naira(order.total)}</p>
            <CopyButton value={(order.total / 100).toFixed(2)} label="Copy amount" />
          </div>
          <p className="mt-1 text-xs text-ink-subtle">
            {naira(order.amount)}
            {order.fee > 0 ? ` + ${naira(order.fee)} charge` : ''}
          </p>
          <div className="mt-6 space-y-3 rounded-2xl bg-track p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-ink-muted">Account number</p>
                <p className="font-mono text-xl font-semibold tracking-wider text-ink">{order.payTo.accountNumber}</p>
              </div>
              <CopyButton value={order.payTo.accountNumber} label="Copy account number" />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-ink-muted">Bank</p>
                <p className="text-ink">{order.payTo.bankName}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Account name</p>
                <p className="text-ink">{order.payTo.accountName}</p>
              </div>
            </div>
          </div>
          <p className="mt-5 flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Waiting for your transfer. This page updates by itself.
          </p>
          {order.payTo.expiresAt && (
            <p className="mt-2 text-xs text-ink-subtle">
              {order.payTo.expired
                ? 'This account has expired for new transfers. If you already sent the money, keep this page open: we’ll still pick it up.'
                : `Use this account by ${new Date(order.payTo.expiresAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}. It’s for this payment only.`}
            </p>
          )}
        </div>
      )}

      {order.status === 'paying' && (
        <div className="flex items-center gap-4 rounded-3xl bg-white p-6 ring-1 ring-line">
          <Loader2 className="h-8 w-8 shrink-0 animate-spin text-brand" aria-hidden />
          <p className="text-sm leading-relaxed text-ink-muted">
            We have your {naira(order.total)}. {order.bill.providerName} usually answers in a few seconds, sometimes a minute. Your
            {order.bill.serviceId === 'jamb' ? ' PIN' : order.bill.serviceId === 'electricity' ? ' token' : ' receipt'} will show here and be texted to {order.phone}.
          </p>
        </div>
      )}

      {order.status === 'delivered' && order.result && (
        <div className="rounded-3xl bg-white p-6 ring-1 ring-line sm:p-8">
          <CheckCircle2 className="h-9 w-9 text-brand-light" aria-hidden />
          {order.result.pins.map((p, i) => (
            <div key={`${p.pin}-${i}`} className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-track p-4">
              <div>
                <p className="text-xs text-ink-muted">PIN{p.serial ? ` · serial ${p.serial}` : ''}</p>
                <p className="font-mono text-xl font-semibold tracking-wider text-ink">{p.pin}</p>
              </div>
              <CopyButton value={p.pin} label="Copy PIN" />
            </div>
          ))}
          {order.result.token && (
            <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-track p-4">
              <div>
                <p className="text-xs text-ink-muted">Token{order.result.units ? ` · ${order.result.units}` : ''}</p>
                <p className="font-mono text-xl font-semibold tracking-wider text-ink">{order.result.token.replace(/^Token\s*:\s*/i, '')}</p>
              </div>
              <CopyButton value={order.result.token.replace(/^Token\s*:\s*/i, '')} label="Copy token" />
            </div>
          )}
          {!order.result.token && order.result.pins.length === 0 && (
            <p className="mt-4 text-ink">
              {naira(order.amount)} {order.bill.providerName} sent to {order.bill.account}.
            </p>
          )}
          <p className="mt-5 text-sm text-ink-muted">
            We’ve also texted it to {order.phone}. Reference {order.result.reference}.
            {order.result.pins.length > 0 && ' Keep your PIN safe: it can only be used once.'}
          </p>
        </div>
      )}

      {order.status === 'failed' && (
        <div className="rounded-3xl bg-white p-6 ring-1 ring-line sm:p-8">
          <AlertCircle className="h-9 w-9 text-accent-hot" aria-hidden />
          <p className="mt-4 text-ink">{order.failureReason ?? 'The provider didn’t complete the payment.'}</p>
          {order.inWallet > 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Your {naira(order.inWallet)} is safe in a Tela wallet for {order.phone}. Get the app and sign up with that number to use it, or to try again.
            </p>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">No money was taken.</p>
          )}
        </div>
      )}

      {(order.status === 'delivered' || order.status === 'failed') && (
        <div className="rounded-3xl bg-brand p-6 text-center text-white sm:p-8">
          <p className="text-lg font-semibold">Next time, it takes seconds</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/75">
            With the Tela app you pay from your wallet: no transfer to wait for, and your PINs and tokens are always there.
          </p>
          <StoreButtons tone="light" className="mt-5 justify-center" />
        </div>
      )}
    </div>
  );
}
