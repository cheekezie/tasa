'use client';

import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ProviderSelect } from '@/components/ProviderSelect';
import { GuestApiError, guestApi, type GuestPlan, type GuestProvider, type Verified } from '@/lib/guestApi';
import { MAX_NAIRA, naira, type Product } from '@/lib/quickpay';
import { cn } from '@/lib/utils';

const PHONE = /^(\+?234|0)[789][01]\d{8}$/;
const cleanPhone = (v: string) => v.replace(/[\s()-]/g, '');

const field = 'mt-1.5 w-full rounded-2xl border border-line bg-white px-4 py-3 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15';
const label = 'block text-sm font-medium text-ink';

/**
 * The order form: what to buy, checked with the provider (the meter's or candidate's name),
 * and the phone number the PIN or token goes to. Ordering issues a one-time account to pay into.
 */
export function PayForm({ product, providers, plans }: { product: Product; providers: GuestProvider[]; plans: GuestPlan[] }) {
  const router = useRouter();
  const [provider, setProvider] = useState(product.provider ?? '');
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? '');
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [verified, setVerified] = useState<Verified | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Why the meter or profile couldn't be confirmed, shown right under it. */
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const plan = plans.find((p) => p.code === planCode);
  const selectedProvider = providers.find((p) => p.code === provider);
  const naira_ = Number(amount) || 0;
  const min = providers.find((p) => p.code === provider)?.minAmount ? providers.find((p) => p.code === provider)!.minAmount! / 100 : (product.minAmount ?? 1);
  const bill = {
    serviceId: product.serviceId,
    provider,
    account: product.accountInput === 'tel' ? cleanPhone(account) : account.trim(),
    ...(product.priced === 'plan' ? { planCode } : { amount: Math.round(naira_ * 100) }),
    ...(product.serviceId === 'electricity' && { meterType }),
    ...(product.serviceId === 'airtime' && { product: 'airtime' }),
  };
  // Only once they've typed something: an empty field isn't an error yet.
  const amountError =
    product.priced !== 'amount' || !amount
      ? null
      : naira_ < min
        ? `The least you can pay${selectedProvider ? ` for ${selectedProvider.name}` : ''} is ₦${min.toLocaleString('en-NG')}.`
        : naira_ > MAX_NAIRA
          ? `On the website you can pay up to ₦${MAX_NAIRA.toLocaleString('en-NG')}. Use the Tela app for more.`
          : null;
  const accountLooksRight = product.accountInput === 'tel' ? PHONE.test(cleanPhone(account)) : account.trim().length >= 6;
  // For airtime and WAEC the number they're topping up is usually their own.
  const receiptPhone = phone || (product.accountInput === 'tel' ? account : '');
  const ready =
    !!provider &&
    accountLooksRight &&
    (!product.verify || !!verified) &&
    (product.priced === 'plan' ? !!plan : naira_ >= min && naira_ <= MAX_NAIRA) &&
    PHONE.test(cleanPhone(receiptPhone));

  // A new meter, provider or meter type needs checking again.
  const verifyKey = `${provider}|${bill.account}|${meterType}|${planCode}`;
  useEffect(() => {
    if (!product.verify || !provider || !accountLooksRight) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      setVerifyError(null);
      try {
        const result = await guestApi.verify({ serviceId: product.serviceId, provider, account: bill.account, meterType, ...(planCode && { planCode }) });
        if (!cancelled) setVerified(result);
      } catch (err) {
        if (!cancelled) {
          setVerified(null);
          setVerifyError(err instanceof Error ? err.message : 'We couldn’t check that number.');
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyKey]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await guestApi.order({ bill, phone: cleanPhone(receiptPhone), ...(email.trim() && { email: email.trim() }) });
      router.push(`/pay/order/${order.reference}?key=${order.key}`);
    } catch (err) {
      setError(err instanceof GuestApiError ? err.message : 'Something went wrong. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-5 rounded-3xl bg-white p-6 ring-1 ring-line sm:p-8">
      {product.serviceId === 'electricity' && (
        <ProviderSelect
          label="Your DisCo"
          placeholder="Choose your electricity company"
          providers={[...providers].sort((a, b) => a.name.localeCompare(b.name))}
          value={provider}
          onChange={(code) => {
            setProvider(code);
            setVerified(null);
          }}
        />
      )}

      {/* Four networks: quicker as buttons, with their logos. */}
      {!product.provider && product.serviceId !== 'electricity' && (
        <div>
          <span className={label}>Network</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {providers.map((p) => (
              <button
                key={p.code}
                type="button"
                aria-pressed={provider === p.code}
                onClick={() => {
                  setProvider(p.code);
                  setVerified(null);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm transition',
                  provider === p.code ? 'border-brand bg-mint text-brand-deep' : 'border-line hover:border-brand/50',
                )}>
                {p.logo && (
                  // Provider logos come from VTpass.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.logo} alt="" className="h-6 w-6 rounded-md object-contain" />
                )}
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {product.serviceId === 'electricity' && (
        <div className="flex gap-2" role="radiogroup" aria-label="Meter type">
          {(['prepaid', 'postpaid'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={meterType === t}
              onClick={() => setMeterType(t)}
              className={cn('flex-1 rounded-full border px-4 py-2 text-sm capitalize transition', meterType === t ? 'border-brand bg-brand text-white' : 'border-line')}>
              {t}
            </button>
          ))}
        </div>
      )}

      {product.priced === 'plan' && (
        <label className="block">
          <span className={label}>What you’re buying</span>
          <select className={field} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
            {plans.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} · {naira(p.amount)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className={label}>{product.accountLabel}</span>
        <input
          className={cn(field, verifyError && !checking && 'border-red-400 focus:border-red-500 focus:ring-red-200')}
          inputMode={product.accountInput}
          autoComplete={product.accountInput === 'tel' ? 'tel' : 'off'}
          aria-invalid={!!verifyError}
          aria-describedby="account-status"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            setVerified(null);
            setVerifyError(null);
          }}
        />
        <span className="mt-1.5 block text-xs text-ink-subtle">{product.accountHint}</span>
      </label>
      <div id="account-status" aria-live="polite">
        {verifyError && !checking && (
          <div className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="block font-semibold">
                {product.serviceId === 'electricity'
                  ? `We couldn’t confirm this meter${selectedProvider ? ` with ${selectedProvider.name}` : ''}`
                  : 'We couldn’t confirm this number'}
              </span>
              <span className="block">{verifyError}</span>
              {product.serviceId === 'electricity' && (
                <span className="mt-1 block text-red-600/80">Check the number, and that the DisCo and meter type ({meterType}) are right.</span>
              )}
            </span>
          </div>
        )}
        {product.verify && !provider && accountLooksRight && (
          <p className="text-sm text-ink-muted">Choose your {product.serviceId === 'electricity' ? 'DisCo' : 'provider'} above so we can check this number.</p>
        )}
      </div>
      {checking && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…
        </p>
      )}
      {verified?.customer && !checking && (
        <p className="flex items-start gap-2 rounded-2xl bg-mint px-4 py-3 text-sm text-brand-deep">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">{verified.customer.name}</span>
            {verified.customer.address && <span className="block text-ink-muted">{verified.customer.address}</span>}
          </span>
        </p>
      )}

      {product.priced === 'amount' && (
        <label className="block">
          <span className={label}>Amount (₦)</span>
          <input
            className={cn(field, amountError && 'border-red-400 focus:border-red-500 focus:ring-red-200')}
            inputMode="numeric"
            placeholder={product.serviceId === 'electricity' ? '5,000' : '1,000'}
            aria-invalid={!!amountError}
            aria-describedby="amount-error"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
          />
          {amountError && (
            <span id="amount-error" className="mt-1.5 block text-sm text-red-700">
              {amountError}
            </span>
          )}
        </label>
      )}

      <label className="block">
        <span className={label}>Phone number for your {product.priced === 'plan' ? 'PIN' : product.serviceId === 'electricity' ? 'token' : 'receipt'}</span>
        <input
          className={field}
          inputMode="tel"
          autoComplete="tel"
          placeholder={product.accountInput === 'tel' && account ? cleanPhone(account) : '080…'}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <span className="mt-1.5 block text-xs text-ink-subtle">We text it here. If anything goes wrong, the money waits in a Tela wallet for this number.</span>
      </label>

      <label className="block">
        <span className={label}>
          Email <span className="font-normal text-ink-subtle">(optional)</span>
        </span>
        <input className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <span className="mt-1.5 block text-xs text-ink-subtle">
          We’ll email your {product.priced === 'plan' ? 'PIN' : product.serviceId === 'electricity' ? 'token' : 'receipt'} too, so you always have a copy.
        </span>
      </label>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {product.verify && accountLooksRight && provider && !verified && !checking && (
        <p className="text-center text-xs text-ink-muted">
          {verifyError ? 'Fix the number above to continue.' : 'We’ll confirm the number before you can continue.'}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready || submitting}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3.5 font-semibold text-white transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50">
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {product.priced === 'plan' && plan ? `Continue · ${naira(plan.amount)}` : naira_ ? `Continue · ${naira(naira_ * 100)}` : 'Continue'}
      </button>
      <p className="text-center text-xs text-ink-subtle">Next you’ll see the total, with any charge, and an account to transfer it to.</p>
    </form>
  );
}
