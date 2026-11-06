import { randomCode } from '../../../lib/crypto';
import { providerError, unprocessable } from '../../../lib/errors';
import type { BillerGateway, BillerWebhook, PlanOption, VendResult } from './biller';

/**
 * VTpass (https://vtpass.com/documentation). Sandbox and live are different hosts with
 * different keys. GETs authenticate with api-key + public-key, POSTs with api-key +
 * secret-key. Amounts are naira numbers.
 *
 * Checked against the docs on 2026-10-28. Still UNVERIFIED — confirm in sandbox:
 *  - request bodies as JSON (the docs never state the content type);
 *  - `GET /balance` response shape (`contents.balance`);
 *  - TV verify: the docs mention Current_Bouquet but the sample and sandbox omit it, so it's only shown when present;
 *  - the webhook is unsigned, so we only ever use it as a cue to requery.
 */
export type VtpassConfig = { baseUrl: string; apiKey: string; publicKey: string; secretKey: string };

type VtpassResponse = {
  code?: string | number;
  response_description?: string;
  content?: {
    transactions?: { status?: string; transactionId?: string; total_amount?: number | string; amount?: number | string };
    error?: string;
    [k: string]: unknown;
  };
  purchased_code?: string;
  token?: string;
  /** WAEC registration PINs. */
  tokens?: string[];
  mainToken?: string;
  Pin?: string;
  units?: string;
  Units?: string;
  cards?: { Serial?: string; Pin?: string; serialNumber?: string; pin?: string }[];
  [k: string]: unknown;
};

class VtpassNetworkError extends Error { }

const toNaira = (kobo: number) => kobo / 100;
const toKobo = (naira: unknown) => Math.round(Number(naira ?? 0) * 100);

/** Africa/Lagos is UTC+1 all year. */
const lagosStamp = (now: Date) => new Date(now.getTime() + 3_600_000).toISOString().replace(/\D/g, '').slice(0, 12);

const PENDING_CODES = new Set(['099', '089', '083', '044', '001', '014']);
// Every documented rejection: nothing was vended and we weren't charged.
const FAILED_CODES = new Set([
  '016', '040', '091', '010', '011', '012', '013', '017', '018', '019', '021', '022', '023', '024', '025', '026',
  '027', '028', '030', '031', '032', '034', '035', '085', '087',
]);

const stripPrefix = (v: string | undefined) => v?.replace(/^\s*(token|pin)\s*:\s*/i, '').trim() || undefined;

/** Turns any pay/requery response into one outcome. Exported for tests. */
/**
 * VTpass sometimes lists one code more than once. A plan is bought by code alone, so exact copies
 * collapse into one, and a code shared by different plans is dropped: we can't tell which the
 * customer would get, or what it would cost.
 */
export function uniquePlans(plans: PlanOption[], serviceID: string) {
  const byCode = new Map<string, PlanOption[]>();
  for (const plan of plans) byCode.set(plan.code, [...(byCode.get(plan.code) ?? []), plan]);
  return [...byCode.values()].flatMap((sameCode) => {
    const [first] = sameCode as [PlanOption, ...PlanOption[]];
    if (sameCode.every((plan) => plan.name === first.name && plan.amount === first.amount)) return [first];
    console.warn(`[vtpass] ${serviceID}: hiding ambiguous code ${first.code}: ${sameCode.map((plan) => plan.name).join(' | ')}`);
    return [];
  });
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function classify(json: VtpassResponse): VendResult {
  const code = String(json.code ?? '').padStart(3, '0');
  const tx = json.content?.transactions;
  const base: VendResult = {
    outcome: 'unknown',
    code,
    message: json.response_description,
    ...(tx?.transactionId && { providerTransactionId: String(tx.transactionId) }),
  };
  if (code === '015') return { ...base, outcome: 'not_found' };
  if (FAILED_CODES.has(code)) return { ...base, outcome: 'failed' };
  if (PENDING_CODES.has(code)) return { ...base, outcome: 'pending' };
  if (code !== '000') return base;

  const status = (tx?.status ?? '').toLowerCase();
  if (status === 'failed' || status === 'reversed') return { ...base, outcome: 'failed' };
  if (status !== 'delivered') return { ...base, outcome: status === 'pending' || status === 'initiated' ? 'pending' : 'unknown' };

  const pins = (json.cards ?? [])
    .map((c) => ({ pin: String(c.Pin ?? c.pin ?? ''), ...((c.Serial ?? c.serialNumber) && { serial: String(c.Serial ?? c.serialNumber) }) }))
    .filter((c) => c.pin);
  const token = pins.length ? undefined : stripPrefix(json.tokens?.[0] ?? json.token ?? json.mainToken ?? json.Pin ?? json.purchased_code);
  const units = json.units ?? json.Units;
  return {
    ...base,
    outcome: 'delivered',
    ...(token && { token }),
    ...(units && { units: String(units) }),
    ...(pins.length && { pins }),
    ...(tx?.total_amount != null && { cost: toKobo(tx.total_amount) }),
  };
}

export function createVtpassGateway(cfg: VtpassConfig): BillerGateway {
  async function call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, timeoutMs = 60_000) {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method,
        headers: {
          'api-key': cfg.apiKey,
          ...(method === 'GET' ? { 'public-key': cfg.publicKey } : { 'secret-key': cfg.secretKey }),
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new VtpassNetworkError(`VTpass ${method} ${path}: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as VtpassResponse;
    return { ok: res.ok, status: res.status, json };
  }

  /** Never throws: anything we can't read is `unknown`, which holds the money for requery. */
  async function transact(path: string, body: Record<string, unknown>): Promise<VendResult> {
    try {
      const { status, json } = await call('POST', path, body);
      if (status >= 500) return { outcome: 'unknown', message: `HTTP ${status}` };
      return classify(json);
    } catch (err) {
      return { outcome: 'unknown', message: (err as Error).message };
    }
  }

  /** The call and errors every account lookup shares. Each `verify*` reads its own fields. */
  async function lookup(path: string, body: Record<string, unknown>) {
    let json: VtpassResponse;
    try {
      ({ json } = await call('POST', path, body, 30_000));
    } catch {
      throw providerError();
    }
    console.log('json:', body);

    const code = String(json.code ?? '');
    if (code === '030') throw providerError('The provider is unreachable right now. Try again shortly');
    const content = (json.content ?? {}) as Record<string, unknown>;
    const name = clean(content.Customer_Name);
    if (code !== '000' || content.error || content.WrongBillersCode === true || !name) {
      // VTpass says what's wrong ("not a valid Abuja prepaid meter"), which beats anything generic.
      const reason = clean(content.error) || "We couldn't verify this account with the provider. Check the number and try again.";
      throw unprocessable(reason, 'ACCOUNT_NOT_VERIFIED');
    }
    return { name, content };
  }

  return {
    name: 'vtpass',

    newRequestId: (now = new Date()) => `${lagosStamp(now)}${randomCode(12)}`,

    async plans(serviceID) {
      let json: VtpassResponse;
      try {
        ({ json } = await call('GET', `/service-variations?serviceID=${encodeURIComponent(serviceID)}`, undefined, 20_000));
      } catch {
        throw providerError('We could not load plans right now. Try again shortly');
      }
      const content = json.content as { variations?: unknown[]; varations?: unknown[] } | undefined;
      const rows = (content?.variations ?? content?.varations ?? []) as { variation_code: string; name: string; variation_amount: string }[];
      if (!rows.length) throw providerError('We could not load plans right now. Try again shortly');
      return uniquePlans(rows.map((v): PlanOption => ({ code: v.variation_code, name: v.name, amount: toKobo(v.variation_amount) })), serviceID);
    },

    async verifyMeter(serviceID, meterNumber, meterType) {
      const { name, content } = await lookup('/merchant-verify', { serviceID, billersCode: meterNumber, type: meterType });
      const type = clean(content.Meter_Type);
      return {
        name,
        ...(content.Address ? { address: clean(content.Address) } : {}),
        ...(type && { detail: { label: 'Meter type', value: type[0]!.toUpperCase() + type.slice(1).toLowerCase() } }),
        ...(Number(content.Min_Purchase_Amount) > 0 && { minAmount: toKobo(content.Min_Purchase_Amount) }),
      };
    },

    async verifySmartCard(serviceID, smartCardNumber) {
      const { name, content } = await lookup('/merchant-verify', { serviceID, billersCode: smartCardNumber });
      const bouquet = clean(content.Current_Bouquet);
      return {
        name,
        ...(bouquet && { currentPlan: bouquet, detail: { label: 'Current plan', value: bouquet } }),
      };
    },

    /** Smile customers give an email; bills are paid into the account id it returns. */
    async verifySmile(serviceID, email) {
      const { name, content } = await lookup('/merchant-verify/smile/email', { serviceID, billersCode: email });
      const accounts = content.AccountList as { Account?: { AccountId?: string | number }[] } | undefined;
      const accountId = accounts?.Account?.[0]?.AccountId;
      if (accountId == null) throw unprocessable("We couldn't find a Smile account for that email", 'ACCOUNT_NOT_VERIFIED');
      return { name, billersCode: String(accountId) };
    },

    async verifyJamb(serviceID, profileId, planCode) {
      const { name } = await lookup('/merchant-verify', { serviceID, billersCode: profileId, type: planCode });
      return { name };
    },

    vend(req) {
      return transact('/pay', {
        request_id: req.requestId,
        serviceID: req.serviceID,
        phone: req.phone,
        ...(req.billersCode && { billersCode: req.billersCode }),
        ...(req.variationCode && { variation_code: req.variationCode }),
        ...(req.amount != null && { amount: toNaira(req.amount) }),
        ...(req.subscriptionType && { subscription_type: req.subscriptionType }),
        ...(req.quantity && { quantity: req.quantity }),
      });
    },

    requery: (requestId) => transact('/requery', { request_id: requestId }),

    async balance() {
      const { json } = await call('GET', '/balance', undefined, 15_000);
      const balance = (json.contents as { balance?: number } | undefined)?.balance;
      if (balance == null) throw providerError('VTpass did not return a balance');
      return toKobo(balance);
    },

    parseWebhook(rawBody): BillerWebhook | null {
      try {
        const body = JSON.parse(rawBody) as { type?: string; data?: { requestId?: string; serviceID?: string } };
        if (body.type === 'transaction-update' && body.data?.requestId) return { kind: 'transaction', requestId: String(body.data.requestId) };
        if (body.type?.startsWith('variation')) return { kind: 'variations', ...(body.data?.serviceID && { serviceID: body.data.serviceID }) };
        return null;
      } catch {
        return null;
      }
    },
  };
}
