import { hmac512, safeEqual } from '../../../lib/crypto';
import { providerError, unprocessable } from '../../../lib/errors';
import type { CollectionAccount, GatewayStatus, PaymentGateway, WebhookNotice } from './gateway';

/**
 * SaySwitch (https://documentation.sayswitchgroup.com) — wallet funding by bank transfer and
 * dedicated (beneficiary) accounts. Bills go through VTpass. One host for test and live; the key
 * (`sk_test_…` / `sk_live_…`) selects the mode. Amounts are decimal naira strings.
 *
 * Checked against the docs on 2026-10-28. Still UNVERIFIED — confirm in sandbox before go-live:
 *  - dedicated accounts: the webhook's `transferDetails` fields that carry the receiving
 *    account number.
 *  - bank-transfer path: docs show `/api/s2s/banktransfer/initialize` (default wallet) and
 *    `/api/s2s/v1/banktransfer/initialize/wallet` (named wallet).
 *  - payouts (`/api/v1/bank_transfer`, `/api/v1/payout/:reference`), read 2026-11-01:
 *    · `amount` and `fee` are naira (confirmed with SaySwitch), despite the docs saying "smallest
 *      currency unit"; we convert from and to kobo at this boundary, like every other call.
 *    · statuses differ per page (`pending`/`completed`/`failed` on create, `success`/`pending`/
 *      `reversed`/"etc" on read); anything unlisted stays pending.
 *    · whether a reused `reference` is rejected isn't stated.
 *  - Confirmed with SaySwitch: the payout `fee` is taken from our wallet on top of `amount` (the
 *    recipient gets all of `amount`), and it comes back on create, on status and in the webhook.
 *    · no payout webhook is documented; one that arrives only triggers a status check.
 */
export type SaySwitchConfig = {
  baseUrl: string;
  secretKey: string;
  publicKey: string;
};

type Envelope<T> = { success?: boolean; status?: boolean; code?: string; message?: string; data: T };

/** Thrown for anything that isn't a clean success. `status` 0 = network/timeout. */
export class SaySwitchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'SaySwitchError';
  }
  /** We can't know what happened on their side. */
  get indeterminate() {
    return this.status === 0 || this.status >= 500;
  }
}

const header = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** SaySwitch's payout statuses, as far as the docs list them. Anything else is still pending. */
function payoutOutcome(status: string | undefined): 'success' | 'failed' | 'pending' {
  const s = (status ?? '').toLowerCase();
  if (s === 'success' || s === 'successful' || s === 'completed') return 'success';
  if (s === 'failed' || s === 'reversed') return 'failed';
  return 'pending';
}

const toNaira = (kobo: number) => (kobo % 100 === 0 ? String(kobo / 100) : (kobo / 100).toFixed(2));
const fromNaira = (amount: string | number | undefined) => Math.round(Number(amount ?? 0) * 100);

export function splitName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { firstName: first || name, lastName: rest.join(' ') || first || name };
}

export function createSaySwitchGateway(cfg: SaySwitchConfig): PaymentGateway {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Envelope<T>> {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new SaySwitchError(`SaySwitch ${method} ${path}: ${(err as Error).message}`, 0, null);
    }
    const json = (await res.json().catch(() => ({}))) as Envelope<T>;
    const ok = res.ok && (json.success ?? json.status) !== false;
    if (!ok) {
      throw new SaySwitchError(`SaySwitch ${method} ${path} → ${res.status}: ${json.message ?? 'no message'}`, res.status, json);
    }
    return json;
  }

  return {
    name: 'sayswitch',

    async listBanks() {
      try {
        const { data } = await call<{ bankCode: string; bankName: string }[]>('GET', '/api/v1/bank_list');
        return data.map((bank) => ({ code: bank.bankCode, name: bank.bankName.trim() }));
      } catch {
        throw providerError('We could not load the bank list. Try again shortly');
      }
    },

    async resolveAccount(bankCode, accountNumber) {
      try {
        const { data } = await call<string>('POST', '/api/v1/account_name_verify', {
          bank_code: bankCode,
          account_number: accountNumber,
          currency: 'NGN',
        });
        return data.trim();
      } catch (err) {
        // A 4xx is the bank's answer; anything else says nothing about the account.
        if (err instanceof SaySwitchError && err.status >= 400 && err.status < 500) {
          throw unprocessable("We couldn't find that account. Check the number and bank", 'ACCOUNT_NOT_FOUND');
        }
        throw providerError('We could not check that account. Try again shortly');
      }
    },

    async collectByTransfer({ reference, amount, customer }): Promise<CollectionAccount> {
      const path = '/api/s2s/banktransfer/initialize';
      try {
        const { data } = await call<{ account_name: string; account_number: string; bank_name: string }>('POST', path, {
          email: customer.email,
          amount: toNaira(amount),
          currency: 'NGN',
          reference,
        });
        return { accountNumber: data.account_number, bankName: data.bank_name, accountName: data.account_name };
      } catch (err) {
        throw providerError('We could not generate a funding account right now. Try again shortly');
      }
    },

    async verify(reference): Promise<GatewayStatus> {
      try {
        type Customer = { customer_code?: string };
        const res = await call<{ status: string; amount: string; fees?: string; reference: string; id?: number; message?: string; customer?: Customer }>(
          'GET',
          `/api/v1/transaction/verify/${encodeURIComponent(reference)}`,
        );
        const data = res.data;
        // The docs show `customer` beside `data`; accept it inside too.
        const customerCode = data.customer?.customer_code ?? (res as { customer?: Customer }).customer?.customer_code;
        const s = (data.status ?? '').toLowerCase();
        const status = s === 'success' || s === 'successful' ? 'success' : s === 'failed' || s === 'expired' ? 'failed' : 'pending';
        return {
          status,
          amountPaid: status === 'success' ? fromNaira(data.amount) : 0,
          ...(status === 'success' && data.fees !== undefined && { providerFee: fromNaira(data.fees) }),
          ...(data.id !== undefined && { providerReference: String(data.id) }),
          ...(customerCode && { customerCode }),
          ...(data.message && { message: data.message }),
        };
      } catch (err) {
        // "Transaction not found" before the customer has paid is just "pending" for us.
        if (err instanceof SaySwitchError && /not found/i.test(err.message)) return { status: 'pending', amountPaid: 0 };
        throw err;
      }
    },

    // Two steps: a customer, then a dedicated account for that customer.
    async createDedicatedAccount(customer) {
      try {
        const { data: created } = await call<{ customer_code: string }>('POST', '/api/v1/customer', {
          email: customer.email,
          phone: customer.phone,
          first_name: customer.firstName,
          last_name: customer.lastName,
        });
        // Checked on sandbox 2026-10-31: `bank.name` is "SaySwitch" there; live may name a partner bank.
        const { data } = await call<{
          account_number: string;
          account_name?: string;
          bank_name?: string;
          bank?: { name?: string };
        }>('POST', '/api/v1/dedicated_virtual_account', { customer: created.customer_code });
        return {
          customerCode: created.customer_code,
          accountNumber: data.account_number,
          accountName: data.account_name ?? `${customer.firstName} ${customer.lastName}`,
          bankName: data.bank_name ?? data.bank?.name ?? 'SaySwitch',
        };
      } catch {
        throw providerError('We could not create an account number right now. Try again shortly');
      }
    },

    /** Both headers must match: HMAC-SHA512(secret, raw body) and HMAC-SHA512(secret, public key), hex. */
    async payout(p) {
      type Payout = { status?: string; fee?: string; message?: string };
      try {
        const { data, message } = await call<Payout>('POST', '/api/v1/bank_transfer', {
          account_name: p.accountName,
          account_number: p.accountNumber,
          amount: toNaira(p.amount),
          bank_code: p.bankCode,
          bank_name: p.bankName,
          currency: 'NGN',
          narration: p.narration,
          reference: p.reference,
        });
        const outcome = payoutOutcome(data?.status);
        return { outcome, ...(data?.fee !== undefined && { providerFee: fromNaira(data.fee) }), message: data?.message ?? message };
      } catch (err) {
        // A 4xx may still mean "already have that reference": only a status check can say it never went.
        const message = (err as Error).message;
        return { outcome: err instanceof SaySwitchError && !err.indeterminate ? 'not_found' : 'unknown', message };
      }
    },

    async payoutStatus(reference) {
      type Payout = { status?: string; fee?: string; gateway_response?: string | null };
      try {
        const { data } = await call<Payout>('GET', `/api/v1/payout/${encodeURIComponent(reference)}`);
        const outcome = payoutOutcome(data?.status);
        return {
          outcome,
          ...(data?.fee !== undefined && { providerFee: fromNaira(data.fee) }),
          ...(data?.gateway_response && { message: data.gateway_response }),
          ...(!data?.gateway_response && data?.status && { message: data.status }),
        };
      } catch (err) {
        if (err instanceof SaySwitchError && (err.status === 404 || /not found/i.test(err.message))) return { outcome: 'not_found', message: err.message };
        return { outcome: 'unknown', message: (err as Error).message };
      }
    },

    verifyWebhook(rawBody, headers) {
      const payloadSig = header(headers, 'payloadSignature');
      const merchantSig = header(headers, 'merchantSignature');
      if (!payloadSig || !merchantSig) return false;
      return (
        safeEqual(hmac512(cfg.secretKey, rawBody), payloadSig.toLowerCase()) &&
        safeEqual(hmac512(cfg.secretKey, cfg.publicKey), merchantSig.toLowerCase())
      );
    },

    parseWebhook(rawBody): WebhookNotice | null {
      try {
        const body = JSON.parse(rawBody) as {
          notify?: string;
          notifyType?: string;
          data?: {
            reference?: string;
            fees?: string | number;
            /** Payouts call it `fee`; collections `fees`. */
            fee?: string | number;
            customer?: { customer_code?: string };
            transferDetails?: Record<string, unknown>;
            dedicated_account?: { account_number?: string };
            account_number?: string;
          };
        };
        if ((body.notify !== 'transaction' && body.notify !== 'payout') || !body.data?.reference) return null;
        if (body.notifyType !== 'successful' && body.notifyType !== 'failed') return null;
        const t = body.data.transferDetails ?? {};
        // UNVERIFIED: where a dedicated-account collection names the receiving account.
        const accountNumber =
          (t.receiver_account_number as string | undefined) ??
          (t.account_number as string | undefined) ??
          (t.accountNumber as string | undefined) ??
          body.data.dedicated_account?.account_number;
        return {
          kind: body.notify,
          outcome: body.notifyType,
          reference: body.data.reference,
          ...(accountNumber && { accountNumber: String(accountNumber) }),
          ...((body.data.fee ?? body.data.fees) != null && (body.data.fee ?? body.data.fees) !== '' && { fee: fromNaira(body.data.fee ?? body.data.fees) }),
          ...(body.data.customer?.customer_code && { customerCode: body.data.customer.customer_code }),
        };
      } catch {
        return null;
      }
    },
  };
}
