import { site } from '@/lib/site';

/**
 * The API's no-sign-in routes for paying on the website, called from the site's server and from
 * the browser alike (the API must allow this site in `CORS_ORIGINS`).
 */
const base = () => site.apiUrl;

export class GuestApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { next?: { revalidate: number } }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new GuestApiError('We couldn’t reach Tasa. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => null)) as { data?: T; message?: string; code?: string } | null;
  if (!res.ok || !body) throw new GuestApiError(body?.message ?? 'Something went wrong. Try again.', body?.code);
  return body.data as T;
}

export type GuestProvider = { code: string; name: string; logo?: string; minAmount?: number };
export type GuestService = { id: string; name: string; available: boolean; pausedMessage: string | null; providers: GuestProvider[] };
export type GuestPlan = { code: string; name: string; amount: number };
export type Verified = { account: string; customer: { name: string; address?: string } | null };
export type GuestOrder = {
  reference: string;
  status: 'awaiting_payment' | 'paying' | 'delivered' | 'failed';
  bill: { serviceId: string; provider: string; providerName: string; account: string; planName: string | null; customerName: string | null };
  amount: number;
  fee: number;
  total: number;
  phone: string;
  payTo: { accountNumber: string; bankName: string; accountName: string; expiresAt: string | null; expired: boolean } | null;
  result: { reference: string; token: string | null; units: string | null; pins: { pin: string; serial: string | null }[] } | null;
  failureReason: string | null;
  inWallet: number;
  createdAt: string;
};

export const guestApi = {
  services: () => call<GuestService[]>('/guest/services', { next: { revalidate: 60 } }),
  plans: (serviceId: string, provider: string) =>
    call<GuestPlan[]>(`/guest/services/${serviceId}/providers/${encodeURIComponent(provider)}/plans`, { next: { revalidate: 300 } }),
  verify: (bill: Record<string, unknown>) => call<Verified>('/guest/verify', { method: 'POST', body: JSON.stringify(bill) }),
  order: (input: { bill: Record<string, unknown>; phone: string; email?: string }) =>
    call<GuestOrder & { key: string }>('/guest/orders', { method: 'POST', body: JSON.stringify(input) }),
  status: (reference: string, key: string) => call<GuestOrder>(`/guest/orders/${encodeURIComponent(reference)}?key=${encodeURIComponent(key)}`, { cache: 'no-store' }),
};
