import { Types } from 'mongoose';
import { lagosParts } from '../modules/recurring/schedule';
import { SellerModel, TicketModel } from '../modules/tickets/models/ticket.model';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { devOtp, env, resolveDevOtp } from '../config/env';
import { sms } from '../modules/notifications/channels/sms';
import { connectDB } from '../lib/db';
import { closeQueues, getQueue } from '../lib/queue';
import { r2 } from '../lib/r2';
import { redis } from '../lib/redis';
import { ChargesService } from '../modules/charges/charges.service';
import { LedgerEntryModel } from '../modules/ledger/models/ledger-entry.model';
import { WalletModel } from '../modules/ledger/models/wallet.model';
import { TransactionModel } from '../modules/transactions/models/transaction.model';
import { WebhookEventModel } from '../modules/webhooks/models/webhook-event.model';
import { WebhooksService } from '../modules/webhooks/webhooks.service';
import { periodRange } from '../modules/transactions/spending.service';
import { RecurringBillModel } from '../modules/recurring/models/recurring-bill.model';
import { RecurringService } from '../modules/recurring/recurring.service';
import { registerBeneficiaries } from '../modules/beneficiaries/beneficiaries.listeners';
import { BeneficiariesService } from '../modules/beneficiaries/beneficiaries.service';
import { BeneficiaryModel } from '../modules/beneficiaries/models/beneficiary.model';
import { PointsBalanceModel, PointsEntryModel } from '../modules/points/models/points.model';
import { registerPoints } from '../modules/points/points.listeners';
import { PointsService, pointsFor } from '../modules/points/points.service';
import { BillsService } from '../modules/bills/bills.service';
import { pushAllowed } from '../modules/notifications/notifications.service';
import { STORAGE_QUEUE } from '../modules/users/avatars.service';
import { UserModel } from '../modules/users/models/user.model';
import { DedicatedAccountModel } from '../modules/wallet/models/dedicated-account.model';
import bcrypt from 'bcryptjs';
import { buildApp } from '../app';
import { AdminAuditModel } from '../modules/admins/models/admin-audit.model';
import { AdminModel } from '../modules/admins/models/admin.model';
import { REVEAL_ROUTE } from '../modules/users/users.service';
import { CouponClaimModel, CouponModel } from '../modules/coupons/models/coupon.model';
import { CouponsService } from '../modules/coupons/coupons.service';
import { SELLER_TERMS_VERSION } from '../modules/tickets/tickets.schema';
import ExcelJS from 'exceljs';
import { bus } from '../lib/events';
import { GROUPS_QUEUE, GroupsService, PAYOUT_CHANGE_COOLING_OFF_MS } from '../modules/groups/groups.service';
import { GroupPayoutChangeModel } from '../modules/groups/models/group.model';
import { SPLITS_QUEUE, SplitsService } from '../modules/splits/splits.service';
import { GUEST_QUEUE, GuestService } from '../modules/guest/guest.service';
import { GuestOrderModel } from '../modules/guest/models/guest-order.model';
import { SplitModel } from '../modules/splits/models/split.model';
import { planCacheKey } from '../modules/bills/bills.catalog';
import { AppSettingsModel } from '../modules/config/models/app-settings.model';
import { ConfigService } from '../modules/config/config.service';
import { PAYOUT_REQUERY_DELAYS_MS, TICKETS_QUEUE, TicketsService } from '../modules/tickets/tickets.service';
import { Accounts, LedgerService } from '../modules/ledger/ledger.service';

/**
 * End-to-end through the HTTP API with a real replica set (so Mongo transactions are real)
 * and SaySwitch + VTpass faked at the network boundary. Every test ends by checking the books.
 */

type Handler = (body: Record<string, unknown>) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>;
type Call = { host: 'say' | 'vt'; path: string; body: Record<string, unknown> };

// ── Fake SaySwitch (funding, beneficiary accounts) ───────────────────────
const say = {
  verify: new Map<string, { status: string; amount: string; fees?: string; customer_code?: string }>(),
  seq: 0,
  /** Payouts SaySwitch knows about, by our reference. Absent = "not found". */
  payouts: new Map<string, { status: string; fee: string }>(),
  /** What POST /bank_transfer does; by default it logs the payout as pending. */
  payout: ((b) => {
    say.payouts.set(String(b.reference), { status: 'pending', fee: '15' });
    return { json: { success: true, message: 'Transfer successfully logged and Processing', data: { ...b, fee: '15', status: 'pending' } } };
  }) as Handler,
};
const sayRoutes: Record<string, Handler> = {
  'POST /api/s2s/banktransfer/initialize': () => ({
    json: { status: true, data: { account_name: 'SAYSWITCH/TASA', account_number: '8787652431', bank_name: 'Wema Bank' } },
  }),
  'GET /api/v1/bank_list': () => ({ json: { success: true, data: [{ bankName: 'Wema Test Bank ', bankCode: '035', logo: '' }] } }),
  'POST /api/v1/account_name_verify': (b) => {
    const name = ({ '9876543210': 'WEMA TEST USER', '1234567890': 'ACCSA UNILAG', '5555555555': 'SOMEONE ELSE' } as Record<string, string>)[String(b.account_number)];
    return name ? { json: { success: true, data: name } } : { status: 400, json: { success: false, message: 'Invalid account details supplied' } };
  },
  'POST /api/v1/bank_transfer': (b) => say.payout(b),
  'POST /api/v1/customer': () => ({ json: { success: true, data: { customer_code: `CUS_${++say.seq}` } } }),
  'POST /api/v1/dedicated_virtual_account': (b) => ({
    json: {
      success: true,
      data: { account_number: `99${String(b.customer).replace(/\D/g, '').padStart(8, '0')}`, account_name: 'TASA/CUSTOMER', bank_name: 'Providus Bank' },
    },
  }),
};

const sayPayoutDefault = say.payout;

// ── Fake VTpass (bills) ──────────────────────────────────────────────────
/** A delivered /pay or /requery body; VTpass keeps 1% commission. */
const delivered = (b: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  json: {
    code: '000',
    response_description: 'TRANSACTION SUCCESSFUL',
    requestId: b.request_id,
    content: { transactions: { status: 'delivered', transactionId: `VT-${String(b.request_id)}`, total_amount: Number(b.amount ?? 0) * 0.99 } },
    ...extra,
  },
});
const vt = {
  pay: ((b) => delivered(b)) as Handler,
  /** request_id → requery response; absent = 015 (VTpass never saw it). */
  requery: new Map<string, unknown>(),
  plans: {
    'mtn-data': [{ variation_code: 'mtn-1gb', name: 'MTN 1GB - 30 days', variation_amount: '1000.00' }],
    dstv: [{ variation_code: 'dstv-padi', name: 'DStv Padi', variation_amount: '4400.00' }],
    jamb: [{ variation_code: 'utme-mock', name: 'UTME PIN (with mock)', variation_amount: '7700.00' }],
    waec: [{ variation_code: 'waecdirect', name: 'WASSCE/GCE', variation_amount: '900.00' }],
    'waec-registration': [{ variation_code: 'waec-registraion', name: 'WASSCE for Private Candidates', variation_amount: '14450.00' }],
  } as Record<string, unknown[]>,
};
const vtRoutes: Record<string, Handler> = {
  'POST /api/merchant-verify': (b) => {
    if (String(b.billersCode).startsWith('000')) return { json: { code: '000', content: { error: 'This number is not valid' } } };
    if (b.serviceID === 'dstv') return { json: { code: '000', content: { Customer_Name: 'CHIDI OKAFOR', Current_Bouquet: 'DStv Compact', Renewal_Amount: 15700 } } };
    if (b.serviceID === 'jamb') return { json: { code: '000', content: { Customer_Name: 'Capital James' } } };
    return { json: { code: '000', content: { Customer_Name: 'ADAEZE  OKAFOR', Meter_Type: 'PREPAID', WrongBillersCode: false } } };
  },
  'POST /api/merchant-verify/smile/email': (b) =>
    String(b.billersCode).startsWith('nobody')
      ? { json: { code: '000', content: { error: 'No Smile account for this email' } } }
      : { json: { code: '000', content: { Customer_Name: 'ADA SMILE', AccountList: { Account: [{ AccountId: 1402 }] } } } },
  'POST /api/pay': (b) => vt.pay(b),
  'POST /api/requery': (b) => ({ json: vt.requery.get(String(b.request_id)) ?? { code: '015', response_description: 'INVALID REQUEST ID' } }),
};

const calls: Call[] = [];
const vtCalls = (path: string) => calls.filter((c) => c.host === 'vt' && c.path === path);

const realFetch = globalThis.fetch;
// ── Fake R2 (profile photos) ─────────────────────────────────────────────
const r2Objects = new Map<string, { size: number; contentType: string; body?: Buffer }>();
const r2Deleted: string[] = [];

vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname.endsWith('r2.cloudflarestorage.com')) {
    const key = decodeURIComponent(url.pathname.replace(/^\/(tasa-test\/)?/, ''));
    const method = input instanceof Request ? input.method : init?.method;
    if (method === 'DELETE') {
      r2Deleted.push(key);
      return new Response(null, { status: 204 });
    }
    if (method === 'GET') {
      const stored = r2Objects.get(key);
      return stored?.body ? new Response(new Uint8Array(stored.body), { status: 200 }) : new Response(null, { status: 404 });
    }
    const body = input instanceof Request ? await input.arrayBuffer() : (init?.body as ArrayBuffer);
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    r2Objects.set(key, { size: body.byteLength, contentType: headers.get('content-type') ?? '', body: Buffer.from(body) });
    return new Response(null, { status: 200, headers: { etag: '"fake"' } });
  }
  const host = url.origin === env.SAYSWITCH_BASE_URL ? 'say' : url.href.startsWith(env.VTPASS_BASE_URL) ? 'vt' : null;
  if (!host) return realFetch(input, init);
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  calls.push({ host, path: url.pathname, body });

  if (host === 'say') {
    const verifyMatch = url.pathname.match(/^\/api\/v1\/transaction\/verify\/(.+)$/);
    if (verifyMatch) {
      const v = say.verify.get(decodeURIComponent(verifyMatch[1]!));
      return v
        ? Response.json({
            success: true,
            data: { ...v, reference: verifyMatch[1] },
            ...(v.customer_code && { customer: { customer_code: v.customer_code } }),
          })
        : Response.json({ success: false, message: 'Transaction not found' }, { status: 404 });
    }
    const payoutMatch = url.pathname.match(/^\/api\/v1\/payout\/(.+)$/);
    if (payoutMatch) {
      const p = say.payouts.get(decodeURIComponent(payoutMatch[1]!));
      return p
        ? Response.json({ success: true, message: 'Payout retrieved', data: { ...p, reference: payoutMatch[1] } })
        : Response.json({ success: false, message: 'Payout not found' }, { status: 404 });
    }
  }
  if (host === 'vt' && url.pathname === '/api/service-variations') {
    const rows = vt.plans[url.searchParams.get('serviceID') ?? ''];
    return Response.json({ response_description: '000', content: { variations: rows ?? [] } });
  }
  const handler = (host === 'say' ? sayRoutes : vtRoutes)[`${method} ${url.pathname}`];
  if (!handler) return Response.json({ message: `no fake for ${host} ${method} ${url.pathname}` }, { status: 500 });
  const { status = 200, json } = await handler(body);
  return Response.json(json, { status });
});

const signed = (payload: unknown) => {
  const raw = JSON.stringify(payload);
  const sig = (v: string) => createHmac('sha512', env.SAYSWITCH_SECRET_KEY).update(v).digest('hex');
  return { raw, headers: { 'content-type': 'application/json', payloadsignature: sig(raw), merchantsignature: sig(env.SAYSWITCH_PUBLIC_KEY) } };
};

// ── Harness ───────────────────────────────────────────────────────────────
let mongo: MongoMemoryReplSet;
let app: FastifyInstance;
let phoneSeq = 0;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDB(mongo.getUri('tasa-test'));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  if (!env.REDIS_URL.endsWith('/15')) throw new Error('Refusing to flush a Redis db that is not the test db');
  await redis.flushdb();
  await ChargesService.ensureDefaults();
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await closeQueues();
  await mongoose.disconnect();
  await mongo?.stop();
  redis.disconnect();
});

beforeEach(() => {
  vt.pay = (b) => delivered(b);
  calls.length = 0;
});

type Api = { status: number; body: { success: boolean; code?: string; message?: string; errors?: Record<string, string>; data: any } };
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token?: string, payload?: unknown): Promise<Api> {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload !== undefined && { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.json() };
}

async function signUp(username?: string) {
  const phone = `0803${String(1_000_000 + ++phoneSeq).slice(-7)}`;
  const otp = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: phone });
  expect(otp.status).toBe(200);
  const verified = await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: phone, code: otp.body.data.code });
  expect(verified.status).toBe(200);
  const token = verified.body.data.accessToken as string;
  expect((await call('PUT', '/api/me/pin', token, { pin: '2580' })).status).toBe(200);
  if (username) expect((await call('PATCH', '/api/me', token, { username })).status).toBe(200);
  return { token, phone, userId: verified.body.data.user.id as string, refreshToken: verified.body.data.refreshToken as string };
}

/** Quote → account → signed webhook → verified credit. */
async function fund(token: string, amount: number) {
  const quote = await call('POST', '/api/quotes', token, { kind: 'funding', amount });
  expect(quote.status).toBe(201);
  const funding = await call('POST', '/api/wallet/fundings', token, { quoteId: quote.body.data.id });
  expect(funding.status).toBe(201);
  const reference = funding.body.data.reference as string;
  say.verify.set(reference, { status: 'success', amount: (quote.body.data.total / 100).toFixed(2) });
  const { raw, headers } = signed({ notify: 'transaction', notifyType: 'successful', data: { reference } });
  const hook = await app.inject({ method: 'POST', url: '/api/webhooks/sayswitch', headers, payload: raw });
  expect(hook.statusCode).toBe(200);
  const event = await WebhookEventModel.findOne({ reference }).sort({ createdAt: -1 });
  await WebhooksService.process(event!.id); // the queue worker isn't running in tests
  return { quote: quote.body.data, reference };
}

const balance = async (token: string) => (await call('GET', '/api/wallet', token)).body.data.balance as number;

let adminToken: string | undefined;
async function asAdmin() {
  if (adminToken) return adminToken;
  await AdminModel.create({ name: 'Finance', email: 'fin@tasa.test', role: 'finance', passwordHash: await bcrypt.hash('correct-horse', 4) });
  const res = await call('POST', '/api/auth/admin/login', undefined, { email: 'fin@tasa.test', password: 'correct-horse' });
  adminToken = res.body.data.accessToken as string;
  return adminToken;
}

let supportToken: string | undefined;
async function asSupport() {
  if (supportToken) return supportToken;
  await AdminModel.create({ name: 'Support', email: 'help@tasa.test', role: 'support', passwordHash: await bcrypt.hash('correct-horse', 4) });
  const res = await call('POST', '/api/auth/admin/login', undefined, { email: 'help@tasa.test', password: 'correct-horse' });
  supportToken = res.body.data.accessToken as string;
  return supportToken;
}

let complianceToken: string | undefined;
async function asCompliance() {
  if (complianceToken) return complianceToken;
  await AdminModel.create({ name: 'Compliance', email: 'kyc@tasa.test', role: 'compliance', passwordHash: await bcrypt.hash('correct-horse', 4) });
  const res = await call('POST', '/api/auth/admin/login', undefined, { email: 'kyc@tasa.test', password: 'correct-horse' });
  complianceToken = res.body.data.accessToken as string;
  return complianceToken;
}

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
async function createPromo(body: Record<string, unknown>) {
  const res = await call('POST', '/api/admin/promotions', await asAdmin(), { title: 'Test promo', expiresAt: inAMonth(), ...body });
  expect(res.status).toBe(201);
  return res.body.data as { promo: { id: string; code: string }; warnings: string[] };
}

const pay = (token: string, quoteId: string) => call('POST', '/api/bills/purchases', token, { quoteId, pin: '2580' });
const airtimeQuote = (token: string, phone: string, amount: number, extra: Record<string, unknown> = {}) =>
  call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'airtime', provider: 'MTN', account: phone, amount, ...extra });

async function electricityQuote(token: string, amount: number, extra: Record<string, unknown> = {}) {
  return call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'electricity', provider: 'ikedc', account: '45098273614', amount, ...extra });
}

/** The books must balance after every flow: postings sum to zero, cached wallets match the ledger. */
async function expectBooksBalanced() {
  const [all] = await LedgerEntryModel.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
  expect(all?.total ?? 0).toBe(0);
  const perPosting = await LedgerEntryModel.aggregate<{ _id: string; total: number }>([
    { $group: { _id: '$posting', total: { $sum: '$amount' } } },
    { $match: { total: { $ne: 0 } } },
  ]);
  expect(perPosting).toEqual([]);
  for (const w of await WalletModel.find()) {
    const [row] = await LedgerEntryModel.aggregate<{ total: number }>([
      { $match: { account: `wallet:${w.user.toString()}` } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    expect(w.balance + (row?.total ?? 0)).toBe(0);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('auth', () => {
  it('signs up by OTP, rotates refresh tokens, and revokes the family on reuse', async () => {
    const { refreshToken } = await signUp();
    const first = await call('POST', '/api/auth/refresh', undefined, { refreshToken });
    expect(first.status).toBe(200);
    expect((await call('POST', '/api/auth/refresh', undefined, { refreshToken })).status).toBe(401); // reuse
    expect((await call('POST', '/api/auth/refresh', undefined, { refreshToken: first.body.data.refreshToken })).status).toBe(401);
  });

  it('rejects a wrong code', async () => {
    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: '08099990000' });
    const wrong = otp.body.data.code === '000000' ? '111111' : '000000';
    expect((await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: '08099990000', code: wrong })).status).toBe(401);
  });
});

describe('funding', () => {
  it('quotes the charge, issues an account, and credits only after SaySwitch confirms', async () => {
    const { token } = await signUp();
    const quote = await call('POST', '/api/quotes', token, { kind: 'funding', amount: 1_000_000 });
    // Funding looks free: Tasa absorbs SaySwitch's fee.
    expect(quote.body.data).toMatchObject({ amount: 1_000_000, fee: 0, total: 1_000_000, charges: [] });

    const started = await call('POST', '/api/wallet/fundings', token, { quoteId: quote.body.data.id });
    expect(started.body.data).toMatchObject({ status: 'pending', total: 1_000_000, funding: { accountNumber: '8787652431' } });
    expect(calls.find((c) => c.path.includes('banktransfer'))!.body.amount).toBe('10000');

    // Same quote again → same account, no second SaySwitch call.
    const again = await call('POST', '/api/wallet/fundings', token, { quoteId: quote.body.data.id });
    expect(again.body.data.reference).toBe(started.body.data.reference);
    expect(calls.filter((c) => c.path.includes('banktransfer'))).toHaveLength(1);

    // Polling before payment: still pending, nothing credited.
    expect((await call('GET', `/api/wallet/fundings/${started.body.data.reference}`, token)).body.data.status).toBe('pending');
    expect(await balance(token)).toBe(0);

    // An unsigned webhook is rejected outright.
    const forged = await app.inject({
      method: 'POST',
      url: '/api/webhooks/sayswitch',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ notify: 'transaction', notifyType: 'successful', data: { reference: started.body.data.reference } }),
    });
    expect(forged.statusCode).toBe(401);
    expect(await balance(token)).toBe(0);
  });

  it('credits once however many webhooks and polls race', async () => {
    const { token } = await signUp();
    const { reference } = await fund(token, 2_000_000);
    expect(await balance(token)).toBe(2_000_000);

    const events = await WebhookEventModel.find({ reference });
    await Promise.all([
      ...events.map((e) => WebhooksService.process(e.id)),
      call('GET', `/api/wallet/fundings/${reference}`, token),
      WebhooksService.process(events[0]!.id),
    ]);
    expect(await balance(token)).toBe(2_000_000);
    await expectBooksBalanced();
  });

  it('credits what actually arrived when the user sends a different amount', async () => {
    const { token } = await signUp();
    const quote = await call('POST', '/api/quotes', token, { kind: 'funding', amount: 1_000_000 });
    const started = await call('POST', '/api/wallet/fundings', token, { quoteId: quote.body.data.id });
    say.verify.set(started.body.data.reference, { status: 'success', amount: '5000.00' });
    const polled = await call('GET', `/api/wallet/fundings/${started.body.data.reference}`, token);
    expect(polled.body.data).toMatchObject({ status: 'success', amount: 500_000, fee: 0 });
    expect(await balance(token)).toBe(500_000);
    await expectBooksBalanced();
  });
});

describe('bills', () => {
  it('checks who a meter or smart card belongs to without pricing anything', async () => {
    const { token } = await signUp();
    const verify = (body: Record<string, unknown>) => call('POST', '/api/bills/verify', token, body);
    expect((await verify({ serviceId: 'electricity', provider: 'IKEDC', account: '45678901234', meterType: 'prepaid' })).body.data).toMatchObject({
      account: '45678901234',
      customer: { name: 'ADAEZE OKAFOR' },
    });
    expect((await verify({ serviceId: 'tv', provider: 'DSTV', account: '7023456789' })).body.data.customer).toMatchObject({ name: 'CHIDI OKAFOR', currentPlan: 'DStv Compact' });
    expect((await verify({ serviceId: 'electricity', provider: 'IKEDC', account: '00012345678' })).status).toBe(422);
    expect((await verify({ serviceId: 'electricity', provider: 'IKEDC', account: '12' })).status).toBe(400);
  });

  it('verifies the meter, shows charges, and delivers a token', async () => {
    const { token } = await signUp();
    await fund(token, 5_000_000);

    const quote = await electricityQuote(token, 2_200_000);
    expect(quote.status).toBe(201);
    expect(quote.body.data).toMatchObject({
      amount: 2_200_000,
      fee: 10_000,
      total: 2_210_000,
      bill: { provider: 'IKEDC', customer: { name: 'ADAEZE OKAFOR', detail: { value: 'Prepaid' } } },
    });

    vt.pay = (b) => delivered(b, { purchased_code: 'Token : 26362054405982757802', units: '79.9 kWh' });
    const paid = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(paid.status).toBe(201);
    expect(paid.body.data).toMatchObject({ status: 'success', total: 2_210_000, bill: { token: '26362054405982757802', units: '79.9 kWh' } });
    expect(await balance(token)).toBe(5_000_000 - 2_210_000);

    const [sent] = vtCalls('/api/pay');
    expect(sent!.body).toMatchObject({ serviceID: 'ikeja-electric', billersCode: '45098273614', variation_code: 'prepaid', amount: 22_000 });
    expect(String(sent!.body.request_id)).toMatch(/^\d{12}[0-9A-Z]{12}$/);

    // VTpass took ₦21,780 for a ₦22,000 bill; the ₦220 difference is booked as commission.
    expect(await LedgerService.balance('revenue:commission:electricity')).toBeLessThanOrEqual(-22_000);

    // Double-tap with the same quote: same transaction, no second vend.
    const again = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(again.body.data.reference).toBe(paid.body.data.reference);
    expect(vtCalls('/api/pay')).toHaveLength(1);
    await expectBooksBalanced();
  });

  it('refuses an unverifiable meter before any money moves', async () => {
    const { token } = await signUp();
    const quote = await electricityQuote(token, 500_000, { account: '0001234567' });
    expect(quote.status).toBe(422);
    expect(quote.body.code).toBe('ACCOUNT_NOT_VERIFIED');
  });

  it('needs the right PIN and locks after five wrong tries', async () => {
    const { token } = await signUp();
    await fund(token, 1_000_000);
    const quote = await electricityQuote(token, 500_000);
    const wrong = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '1111' });
    expect(wrong.body.code).toBe('PIN_INCORRECT');
    for (let i = 0; i < 4; i++) await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '1111' });
    const locked = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(locked.status).toBe(423);
    expect(await balance(token)).toBe(1_000_000);
  });

  it('keeps the quote usable after INSUFFICIENT_FUNDS, so topping up and retrying works', async () => {
    const { token } = await signUp();
    await fund(token, 500_000);
    const quote = await electricityQuote(token, 1_000_000);
    const short = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(short.status).toBe(422);
    expect(short.body).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await TransactionModel.countDocuments({ quote: quote.body.data.id })).toBe(0);

    await fund(token, 600_000);
    const ok = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(ok.body.data.status).toBe('success');
    await expectBooksBalanced();
  });

  it('never overdraws when two purchases race for the same money', async () => {
    const { token } = await signUp();
    await fund(token, 1_500_000);
    const [a, b] = await Promise.all([electricityQuote(token, 1_000_000), electricityQuote(token, 1_000_000)]);
    const results = await Promise.all([
      call('POST', '/api/bills/purchases', token, { quoteId: a.body.data.id, pin: '2580' }),
      call('POST', '/api/bills/purchases', token, { quoteId: b.body.data.id, pin: '2580' }),
    ]);
    expect(results.map((r) => r.body.data?.status ?? r.body.code).sort()).toEqual(['INSUFFICIENT_FUNDS', 'success']);
    expect(await balance(token)).toBe(1_500_000 - 1_010_000);
    await expectBooksBalanced();
  });

  it('refunds in full when VTpass rejects the vend', async () => {
    const { token } = await signUp();
    await fund(token, 1_000_000);
    vt.pay = () => ({ json: { code: '018', response_description: 'LOW WALLET BALANCE' } });
    const quote = await electricityQuote(token, 500_000);
    const paid = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(paid.body.data).toMatchObject({ status: 'failed' });
    expect(await balance(token)).toBe(1_000_000);
    await expectBooksBalanced();
  });

  it('holds the money when the outcome is unknown, until a requery answers', async () => {
    const { token } = await signUp();
    await fund(token, 1_000_000);
    vt.pay = () => ({ status: 504, json: { message: 'Gateway timeout' } });
    const quote = await electricityQuote(token, 500_000);
    const paid = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(paid.status).toBe(202);
    expect(paid.body.data.status).toBe('pending');
    expect(await balance(token)).toBe(1_000_000 - 510_000); // not refunded on a guess

    // VTpass's (unsigned) webhook only names the request; we requery to learn the outcome.
    const tx = await TransactionModel.findOne({ reference: paid.body.data.reference });
    const requestId = tx!.providerData!.requestId!;
    vt.requery.set(requestId, delivered({ request_id: requestId, amount: 5000 }, { purchased_code: 'Token : 1111' }).json);
    const hook = await app.inject({
      method: 'POST',
      url: '/api/webhooks/vtpass',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'transaction-update', data: { requestId, code: '000', content: { transactions: { status: 'delivered' } } } }),
    });
    expect(hook.json()).toEqual({ response: 'success' });
    const event = await WebhookEventModel.findOne({ provider: 'vtpass', reference: requestId });
    await WebhooksService.process(event!.id);
    expect((await call('GET', `/api/transactions/${paid.body.data.reference}`, token)).body.data).toMatchObject({
      status: 'success',
      bill: { token: '1111' },
    });
    await expectBooksBalanced();
  });

  it('ignores a forged VTpass webhook body and trusts only the requery', async () => {
    const { token } = await signUp();
    await fund(token, 1_000_000);
    vt.pay = () => ({ json: { code: '099', response_description: 'TRANSACTION IS PROCESSING' } });
    const quote = await electricityQuote(token, 500_000);
    const paid = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    const requestId = (await TransactionModel.findOne({ reference: paid.body.data.reference }))!.providerData!.requestId!;

    // Body claims "reversed", but VTpass says it's still processing → nothing changes.
    vt.requery.set(requestId, { code: '099' });
    await app.inject({
      method: 'POST',
      url: '/api/webhooks/vtpass',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'transaction-update', data: { requestId, code: '040', content: { transactions: { status: 'reversed' } } } }),
    });
    await WebhooksService.process((await WebhookEventModel.findOne({ provider: 'vtpass', reference: requestId }))!.id);
    expect((await call('GET', `/api/transactions/${paid.body.data.reference}`, token)).body.data.status).toBe('pending');
    expect(await balance(token)).toBe(490_000);
  });

  it('refunds "VTpass never received it" only after the grace period', async () => {
    const { token } = await signUp();
    await fund(token, 1_000_000);
    vt.pay = () => ({ status: 503, json: {} });
    const quote = await electricityQuote(token, 500_000);
    const paid = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    const { BillsService, NOT_FOUND_GRACE_MS } = await import('../modules/bills/bills.service');
    const tx = await TransactionModel.findOne({ reference: paid.body.data.reference });

    await BillsService.requery(tx!.id, 1); // 015 straight away: could still be in flight
    expect((await TransactionModel.findById(tx!._id))!.status).toBe('pending');

    await TransactionModel.updateOne({ _id: tx!._id }, { 'providerData.sentAt': new Date(Date.now() - NOT_FOUND_GRACE_MS - 1000) });
    await BillsService.requery(tx!.id, 2);
    expect((await TransactionModel.findById(tx!._id))!.status).toBe('failed');
    expect(await balance(token)).toBe(1_000_000);
    await expectBooksBalanced();
  });

  it('sells a JAMB PIN after verifying the profile ID', async () => {
    const { token } = await signUp();
    await fund(token, 1_000_000);
    const quote = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'jamb', provider: 'JAMB', account: '0123456789', planCode: 'utme-mock' });
    expect(quote.body.data).toMatchObject({ amount: 770_000, fee: 15_000, bill: { planName: 'UTME PIN (with mock)', customer: { name: 'Capital James' } } });
    vt.pay = (b) => delivered(b, { Pin: 'Pin : 3678251321392432' });
    const paid = await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(paid.body.data).toMatchObject({ status: 'success', bill: { token: '3678251321392432' }, subtitle: '0123456789 · PIN delivered' });
    expect(vtCalls('/api/pay')[0]!.body).toMatchObject({ serviceID: 'jamb', billersCode: '0123456789', variation_code: 'utme-mock' });
    await expectBooksBalanced();
  });

  it('sells both WAEC PINs under one provider, each through its own VTpass product', async () => {
    const { token } = await signUp();
    await fund(token, 3_000_000);
    const plans = await call('GET', '/api/bills/services/jamb/providers/WAEC/plans', token);
    expect(plans.body.data.map((p: { name: string }) => p.name)).toEqual(['Result Checker PIN: WASSCE/GCE', 'Registration PIN: WASSCE for Private Candidates']);

    const registration = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'jamb', provider: 'WAEC', account: '08031112222', planCode: 'waec-registraion' });
    expect(registration.body.data).toMatchObject({ amount: 1_445_000, bill: { planName: 'Registration PIN: WASSCE for Private Candidates' } });
    vt.pay = (b) => delivered(b, { tokens: ['0100070365657400875'], purchased_code: 'Token: 0100070365657400875' });
    const paid = await call('POST', '/api/bills/purchases', token, { quoteId: registration.body.data.id, pin: '2580' });
    expect(paid.body.data).toMatchObject({ status: 'success', bill: { token: '0100070365657400875' } });
    expect(vtCalls('/api/pay')[0]!.body).toMatchObject({ serviceID: 'waec-registration', variation_code: 'waec-registraion' });

    const checker = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'jamb', provider: 'WAEC', account: '08031112222', planCode: 'waecdirect' });
    vt.pay = (b) => delivered(b, { cards: [{ Serial: 'WRN1', Pin: '0987' }] });
    const checked = await call('POST', '/api/bills/purchases', token, { quoteId: checker.body.data.id, pin: '2580' });
    expect(checked.body.data).toMatchObject({ status: 'success', bill: { pins: [{ pin: '0987', serial: 'WRN1' }] } });
    expect(vtCalls('/api/pay')[1]!.body).toMatchObject({ serviceID: 'waec', variation_code: 'waecdirect' });
    await expectBooksBalanced();
  });

  it('always needs a TV package, and renewing is buying the same one', async () => {
    const { token } = await signUp();
    await fund(token, 3_000_000);
    const none = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'tv', provider: 'DStv', account: '1212121212' });
    expect(none.body.code).toBe('PLAN_REQUIRED');
    const quote = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'tv', provider: 'DStv', account: '1212121212', planCode: 'dstv-padi' });
    expect(quote.body.data).toMatchObject({ amount: 440_000, bill: { planName: 'DStv Padi', customer: { name: 'CHIDI OKAFOR', detail: { value: 'DStv Compact' } } } });
    await pay(token, quote.body.data.id);
    expect(vtCalls('/api/pay')[0]!.body).toMatchObject({ serviceID: 'dstv', subscription_type: 'change', variation_code: 'dstv-padi' });
  });

  it("doesn't send StarTimes a subscription type", async () => {
    const { token } = await signUp();
    await fund(token, 3_000_000);
    vt.plans.startimes = [{ variation_code: 'nova', name: 'Nova', variation_amount: '1500.00' }];
    const quote = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'tv', provider: 'StarTimes', account: '1212121212', planCode: 'nova' });
    await pay(token, quote.body.data.id);
    expect(vtCalls('/api/pay')[0]!.body).toMatchObject({ serviceID: 'startimes', variation_code: 'nova' });
    expect(vtCalls('/api/pay')[0]!.body.subscription_type).toBeUndefined();
  });

  it('buys data bundles from the plan list', async () => {
    const { token, phone } = await signUp();
    await fund(token, 500_000);
    const plans = await call('GET', '/api/bills/services/airtime/providers/mtn/plans', token);
    expect(plans.body.data).toEqual([{ code: 'mtn-1gb', name: 'MTN 1GB - 30 days', amount: 100_000 }]);
    const quote = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'airtime', product: 'data', provider: 'MTN', account: phone, planCode: 'mtn-1gb' });
    expect(quote.body.data).toMatchObject({ amount: 100_000, fee: 2_000, total: 102_000 });
    await call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(vtCalls('/api/pay')[0]!.body).toMatchObject({ serviceID: 'mtn-data', billersCode: phone, variation_code: 'mtn-1gb' });
  });

  it('reports water as unavailable instead of pretending', async () => {
    const { token } = await signUp();
    const services = (await call('GET', '/api/bills/services', token)).body.data as { id: string; available: boolean }[];
    expect(services.filter((s) => !s.available).map((s) => s.id)).toEqual(['water']);
    const quote = await call('POST', '/api/quotes', token, { kind: 'bill', serviceId: 'water', provider: 'LWC', account: '12345678', amount: 350_000 });
    expect(quote.body.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('transfers', () => {
  it('moves money between wallets with a preview of who receives it', async () => {
    const alice = await signUp('alice_t');
    const bob = await signUp('bob_t');
    await fund(alice.token, 1_000_000);
    const quote = await call('POST', '/api/quotes', alice.token, { kind: 'transfer', recipient: { type: 'username', value: '@Bob_T' }, amount: 250_000 });
    expect(quote.body.data.transfer).toMatchObject({ username: 'bob_t' });
    const sent = await call('POST', '/api/transfers', alice.token, { quoteId: quote.body.data.id, pin: '2580' });
    expect(sent.status).toBe(201);
    expect(quote.body.data).toMatchObject({ fee: 1_000, total: 251_000 });
    expect(await balance(alice.token)).toBe(749_000);
    expect(await balance(bob.token)).toBe(250_000);
    const bobFeed = await call('GET', '/api/transactions?kind=transfer_in', bob.token);
    expect(bobFeed.body.data.items[0]).toMatchObject({ direction: 'credit', subtitle: 'From @alice_t' });
    await expectBooksBalanced();
  });
});

describe('coupons and gifts', () => {
  it('funds a coupon pool, discounts other users, and returns the rest on cancel', async () => {
    const owner = await signUp();
    const user = await signUp();
    await fund(owner.token, 2_000_000);
    await fund(user.token, 1_000_000);

    const cq = await call('POST', '/api/quotes', owner.token, {
      kind: 'coupon',
      title: 'Light Up Lagos',
      amount: 300_000,
      quantity: 3,
      services: ['electricity'],
      code: 'LIGHT-UP-T1',
    });
    expect(cq.body.data).toMatchObject({ amount: 900_000, fee: 9_000, total: 909_000 }); // 1% coupon charge
    const created = await call('POST', '/api/coupons', owner.token, { quoteId: cq.body.data.id, pin: '2580' });
    expect(created.status).toBe(201);
    expect(await balance(owner.token)).toBe(1_091_000);

    const bq = await electricityQuote(user.token, 500_000, { couponCode: 'light-up-t1' });
    expect(bq.body.data).toMatchObject({ amount: 500_000, fee: 10_000, discount: 300_000, total: 210_000 });
    const paid = await call('POST', '/api/bills/purchases', user.token, { quoteId: bq.body.data.id, pin: '2580' });
    expect(paid.body.data.status).toBe('success');
    expect(await balance(user.token)).toBe(1_000_000 - 210_000);

    // Their ₦3,000 is spent; the code can't give them more.
    expect((await electricityQuote(user.token, 500_000, { couponCode: 'LIGHT-UP-T1' })).body.code).toBe('COUPON_BALANCE_EMPTY');

    await call('POST', `/api/coupons/${created.body.data.coupon.id}/cancel`, owner.token);
    expect(await balance(owner.token)).toBe(1_091_000 + 600_000);
    await expectBooksBalanced();
  });

  it('gives a failed bill its coupon slot and discount back', async () => {
    const owner = await signUp();
    const user = await signUp();
    await fund(owner.token, 1_000_000);
    const cq = await call('POST', '/api/quotes', owner.token, { kind: 'coupon', title: 'One shot', amount: 200_000, quantity: 1 });
    const created = await call('POST', '/api/coupons', owner.token, { quoteId: cq.body.data.id, pin: '2580' });
    const code = created.body.data.coupon.code as string;

    await fund(user.token, 500_000);
    vt.pay = () => ({ json: { code: '016', response_description: 'TRANSACTION FAILED' } });
    const bq = await electricityQuote(user.token, 500_000, { couponCode: code });
    const failed = await call('POST', '/api/bills/purchases', user.token, { quoteId: bq.body.data.id, pin: '2580' });
    expect(failed.body.data.status).toBe('failed');
    expect(await balance(user.token)).toBe(500_000);
    expect((await call('GET', `/api/coupons/code/${code}`, owner.token)).body.data).toMatchObject({ redeemed: 0, status: 'active' });
    await expectBooksBalanced();
  });

  it('reserves a gift for the recipient phone only', async () => {
    const sender = await signUp();
    const recipient = await signUp();
    const stranger = await signUp();
    await fund(sender.token, 1_000_000);
    const gq = await call('POST', '/api/quotes', sender.token, { kind: 'gift', recipient: { type: 'phone', value: recipient.phone }, serviceId: 'airtime', amount: 150_000 });
    const gift = await call('POST', '/api/gifts', sender.token, { quoteId: gq.body.data.id, pin: '2580' });
    expect(gift.status).toBe(201);
    const code = gift.body.data.coupon.code as string;

    const strangerTry = await call('POST', '/api/quotes', stranger.token, {
      kind: 'bill', serviceId: 'airtime', provider: 'MTN', account: stranger.phone, amount: 150_000, couponCode: code,
    });
    expect(strangerTry.body.code).toBe('COUPON_NOT_YOURS');

    const received = await call('GET', '/api/gifts/received', recipient.token);
    expect(received.body.data[0]).toMatchObject({ code, amount: 150_000 });
    await fund(recipient.token, 10_000); // the gift covers the bill; the ₦20 charge is theirs
    const bq = await call('POST', '/api/quotes', recipient.token, {
      kind: 'bill', serviceId: 'airtime', provider: 'mtn', account: recipient.phone, amount: 150_000, couponCode: code,
    });
    expect(bq.body.data).toMatchObject({ fee: 2_000, discount: 150_000, total: 2_000 });
    const paid = await call('POST', '/api/bills/purchases', recipient.token, { quoteId: bq.body.data.id, pin: '2580' });
    expect(paid.body.data.status).toBe('success');
    expect(vtCalls('/api/pay')[0]!.body).toMatchObject({ serviceID: 'mtn', phone: recipient.phone, amount: 1500 });
    await expectBooksBalanced();
  });
});

describe('beneficiaries', () => {
  /** A signed SaySwitch webhook for a transfer SaySwitch says belongs to `customerCode`. */
  async function transferIn(providerRef: string, customerCode: string, naira: string, body: Record<string, unknown> = {}) {
    say.verify.set(providerRef, { status: 'success', amount: naira, customer_code: customerCode });
    const { raw, headers } = signed({ notify: 'transaction', notifyType: 'successful', data: { reference: providerRef, ...body } });
    await app.inject({ method: 'POST', url: '/api/webhooks/sayswitch', headers, payload: raw });
    const event = await WebhookEventModel.findOne({ reference: providerRef }).sort({ createdAt: -1 });
    await WebhooksService.process(event!.id);
    return event!;
  }
  const customerOfAccount = async (accountNumber: string) => (await DedicatedAccountModel.findOne({ accountNumber }))!.customerCode;

  it('issues an account number only after the user accepts the auto-pay terms', async () => {
    const { token } = await signUp();
    const created = await call('POST', '/api/beneficiaries', token, { label: "Mama's Shop", serviceId: 'electricity', provider: 'IKEDC', account: '45098273614', meterType: 'prepaid' });
    expect(created.body.data).toMatchObject({ virtualAccount: null, autoPay: false });
    const id = created.body.data.id as string;

    expect((await call('PATCH', `/api/beneficiaries/${id}`, token, { autoPay: true })).body.code).toBe('OPT_IN_REQUIRED');
    const terms = (await call('GET', '/api/beneficiaries/auto-pay-terms', token)).body.data;
    expect(terms).toMatchObject({ version: expect.any(String), url: expect.any(String) });
    expect((await call('POST', `/api/beneficiaries/${id}/virtual-account`, token, { acceptTerms: false, termsVersion: terms.version })).status).toBe(400);
    expect((await call('POST', `/api/beneficiaries/${id}/virtual-account`, token, { acceptTerms: true, termsVersion: '1999-01-01' })).body.code).toBe('TERMS_OUTDATED');

    const optedIn = await call('POST', `/api/beneficiaries/${id}/virtual-account`, token, { acceptTerms: true, termsVersion: terms.version });
    expect(optedIn.body.data).toMatchObject({ autoPay: true, virtualAccount: { bankName: 'Providus Bank' }, termsAccepted: { version: terms.version } });
    const account = await DedicatedAccountModel.findOne({ beneficiary: id });
    expect(account!.consent).toMatchObject({ termsVersion: terms.version, ip: expect.any(String) });
  });

  it('buys the electricity automatically when money lands in the meter account', async () => {
    const { token } = await signUp();
    const id = (await call('POST', '/api/beneficiaries', token, { label: 'Home meter', serviceId: 'electricity', provider: 'IKEDC', account: '45098273614', meterType: 'prepaid' })).body.data.id;
    const terms = (await call('GET', '/api/beneficiaries/auto-pay-terms', token)).body.data;
    const number = (await call('POST', `/api/beneficiaries/${id}/virtual-account`, token, { acceptTerms: true, termsVersion: terms.version })).body.data.virtualAccount.accountNumber;

    const event = await transferIn('SSW_77', await customerOfAccount(number), '10150.00');
    await WebhooksService.process(event.id); // replay is harmless

    // ₦10,150 in (funding is free) → ₦10,050 electricity + ₦100 charge.
    const feed = await call('GET', `/api/transactions?beneficiaryId=${id}`, token);
    expect(feed.body.data.items.map((t: { kind: string; amount: number }) => [t.kind, t.amount])).toEqual([
      ['bill', 1_005_000],
      ['beneficiary_collection', 1_015_000],
    ]);
    expect(await balance(token)).toBe(0);
    await expectBooksBalanced();
  });

  it('keeps the money in the wallet when auto-pay is off or the beneficiary is removed', async () => {
    const { token } = await signUp();
    const id = (await call('POST', '/api/beneficiaries', token, { label: 'Shop', serviceId: 'electricity', provider: 'IKEDC', account: '45098273699', meterType: 'prepaid' })).body.data.id;
    const terms = (await call('GET', '/api/beneficiaries/auto-pay-terms', token)).body.data;
    const number = (await call('POST', `/api/beneficiaries/${id}/virtual-account`, token, { acceptTerms: true, termsVersion: terms.version })).body.data.virtualAccount.accountNumber;
    await call('PATCH', `/api/beneficiaries/${id}`, token, { autoPay: false });
    await transferIn('SSW_OFF1', await customerOfAccount(number), '5000.00');
    await call('DELETE', `/api/beneficiaries/${id}`, token);
    await transferIn('SSW_OFF2', await customerOfAccount(number), '2000.00');
    expect(await balance(token)).toBe(700_000);
    expect(await TransactionModel.countDocuments({ beneficiary: id, kind: 'bill' })).toBe(0);
    await expectBooksBalanced();
  });
});

describe('permanent wallet account', () => {
  async function transferIn(providerRef: string, customerCode: string | undefined, naira: string, body: Record<string, unknown> = {}) {
    say.verify.set(providerRef, { status: 'success', amount: naira, ...(customerCode && { customer_code: customerCode }) });
    const { raw, headers } = signed({ notify: 'transaction', notifyType: 'successful', data: { reference: providerRef, ...body } });
    await app.inject({ method: 'POST', url: '/api/webhooks/sayswitch', headers, payload: raw });
    await WebhooksService.process((await WebhookEventModel.findOne({ reference: providerRef }).sort({ createdAt: -1 }))!.id);
  }

  it('gives a wallet one permanent account and credits transfers into it, once', async () => {
    const { token, userId } = await signUp();
    const first = await call('POST', '/api/wallet/account', token);
    const again = await call('POST', '/api/wallet/account', token);
    expect(again.body.data.accountNumber).toBe(first.body.data.accountNumber);
    expect((await call('GET', '/api/wallet', token)).body.data).toMatchObject({ balance: 0, account: first.body.data });

    const tapped = new Date();
    const code = (await DedicatedAccountModel.findOne({ user: userId, purpose: 'wallet' }))!.customerCode;
    await transferIn('SSW_W1', code, '15000.00', { fees: '75.00', customer: { customer_code: code } });
    await transferIn('SSW_W1', code, '15000.00'); // duplicate webhook
    expect(await balance(token)).toBe(1_500_000);

    const credits = await call('GET', `/api/wallet/account/credits?since=${tapped.toISOString()}`, token);
    expect(credits.body.data).toHaveLength(1);
    expect(credits.body.data[0]).toMatchObject({ kind: 'funding', amount: 1_500_000, funding: { accountNumber: first.body.data.accountNumber } });
    const tx = await TransactionModel.findOne({ reference: credits.body.data[0].reference });
    expect(tx!.funding).toMatchObject({ channel: 'dedicated', providerFee: 7_500 });
    await expectBooksBalanced();
  });

  it("credits whoever SaySwitch's verify says, never whoever the webhook body names", async () => {
    const victim = await signUp();
    const payer = await signUp();
    await call('POST', '/api/wallet/account', victim.token);
    await call('POST', '/api/wallet/account', payer.token);
    const victimCode = (await DedicatedAccountModel.findOne({ user: victim.userId }))!.customerCode;
    const payerCode = (await DedicatedAccountModel.findOne({ user: payer.userId }))!.customerCode;
    // The body says victim; SaySwitch's own record says payer.
    await transferIn('SSW_W2', payerCode, '1000.00', { customer: { customer_code: victimCode } });
    expect(await balance(payer.token)).toBe(100_000);
    expect(await balance(victim.token)).toBe(0);
  });

  it('ignores money for a customer that is not one of our accounts', async () => {
    const before = await TransactionModel.countDocuments({ kind: 'funding', 'funding.channel': 'dedicated' });
    await transferIn('SSW_W3', 'CUS_SOMEONE_ELSE', '1000.00');
    expect(await TransactionModel.countDocuments({ kind: 'funding', 'funding.channel': 'dedicated' })).toBe(before);
    expect((await WebhookEventModel.findOne({ reference: 'SSW_W3' }))!.result).toMatch(/no account for customer/);
  });

  it('lets support credit a transfer whose webhook never came, by its SaySwitch reference', async () => {
    const { token, userId } = await signUp();
    await call('POST', '/api/wallet/account', token);
    const code = (await DedicatedAccountModel.findOne({ user: userId }))!.customerCode;
    say.verify.set('SSW_MISSED', { status: 'success', amount: '2500.00', customer_code: code });
    const first = await call('POST', '/api/admin/collections', await asAdmin(), { reference: 'SSW_MISSED' });
    expect(first.body.data).toMatchObject({ status: 'credited', userId });
    expect((await call('POST', '/api/admin/collections', await asAdmin(), { reference: 'SSW_MISSED' })).body.data.status).toBe('already_credited');
    expect((await call('POST', '/api/admin/collections', await asAdmin(), { reference: 'SSW_NEVER_PAID' })).body.data.status).toBe('not_paid');
    expect(await balance(token)).toBe(250_000);
    await expectBooksBalanced();
  });
});

describe('polling by reference', () => {
  it('re-checks a pending bill with VTpass when the app polls it', async () => {
    const { token } = await signUp();
    await fund(token, 1_000_000);
    vt.pay = () => ({ json: { code: '099' } });
    const paid = await pay(token, (await electricityQuote(token, 500_000)).body.data.id);
    expect(paid.body.data.status).toBe('pending');
    const requestId = (await TransactionModel.findOne({ reference: paid.body.data.reference }))!.providerData!.requestId!;
    vt.requery.set(requestId, delivered({ request_id: requestId, amount: 5000 }, { purchased_code: 'Token : 4242' }).json);

    const polled = await call('GET', `/api/transactions/${paid.body.data.reference}`, token);
    expect(polled.body.data).toMatchObject({ status: 'success', bill: { token: '4242' } });
    const requeries = vtCalls('/api/requery').length;
    await call('GET', `/api/transactions/${paid.body.data.reference}`, token);
    expect(vtCalls('/api/requery').length).toBe(requeries); // settled: no more provider calls
  });

  it('re-checks a one-time funding when polled through the generic endpoint', async () => {
    const { token } = await signUp();
    const q = await call('POST', '/api/quotes', token, { kind: 'funding', amount: 300_000 });
    const started = await call('POST', '/api/wallet/fundings', token, { quoteId: q.body.data.id });
    say.verify.set(started.body.data.reference, { status: 'success', amount: '3000.00' });
    expect((await call('GET', `/api/transactions/${started.body.data.reference}`, token)).body.data.status).toBe('success');
    expect(await balance(token)).toBe(300_000);
  });
});

describe('recurring', () => {
  it('pays a due schedule from the wallet and moves to the next cycle', async () => {
    const { token } = await signUp();
    await fund(token, 3_000_000);
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    const created = await call('POST', '/api/recurring', token, {
      label: 'Home meter',
      serviceId: 'electricity',
      provider: 'IKEDC',
      account: '45098273615',
      amount: 1_000_000,
      frequency: 'monthly',
      startDate: today,
      pin: '2580',
    });
    expect(created.status).toBe(201);

    const { RecurringBillModel } = await import('../modules/recurring/models/recurring-bill.model');
    const { RecurringService } = await import('../modules/recurring/recurring.service');
    await RecurringBillModel.updateOne({ _id: created.body.data.id }, { nextRunAt: new Date(Date.now() - 1000) });
    await RecurringService.runDue();

    const after = (await call('GET', '/api/recurring', token)).body.data[0];
    expect(after.lastRun.status).toBe('success');
    expect(new Date(after.nextDate).getTime()).toBeGreaterThan(Date.now() + 20 * 86_400_000);
    expect(await balance(token)).toBe(3_000_000 - 1_010_000);
    await expectBooksBalanced();
  });
});

describe('insights', () => {
  it('sums successful bills per month', async () => {
    const { token } = await signUp();
    await fund(token, 2_000_000);
    const q = await electricityQuote(token, 700_000);
    await call('POST', '/api/bills/purchases', token, { quoteId: q.body.data.id, pin: '2580' });
    const res = await call('GET', '/api/insights/electricity?months=3', token);
    expect(res.body.data.series).toHaveLength(3);
    expect(res.body.data.series.at(-1).amount).toBe(700_000);
  });
});

describe('coupon balances', () => {
  it('lets a claimant spend a coupon across several bills, then returns the unused money at expiry', async () => {
    const owner = await signUp();
    const user = await signUp();
    await fund(owner.token, 2_000_000);
    await fund(user.token, 1_000_000);
    const cq = await call('POST', '/api/quotes', owner.token, { kind: 'coupon', title: 'Two fivers', amount: 500_000, quantity: 2 });
    const created = await call('POST', '/api/coupons', owner.token, { quoteId: cq.body.data.id, pin: '2580' });
    const code = created.body.data.coupon.code as string;

    // ₦2,000 airtime with a ₦5,000 coupon: they pay only the ₦20 charge; ₦3,000 stays on the code.
    const q1 = await airtimeQuote(user.token, user.phone, 200_000, { couponCode: code });
    expect(q1.body.data).toMatchObject({ discount: 200_000, total: 2_000, coupon: { kind: 'coupon', fundedBy: 'user', auto: false } });
    expect((await pay(user.token, q1.body.data.id)).body.data.status).toBe('success');
    const balances = await call('GET', '/api/coupons/balances', user.token);
    expect(balances.body.data[0]).toMatchObject({ code, myBalance: { allowance: 500_000, used: 200_000, left: 300_000 } });

    // ₦5,000 electricity: the remaining ₦3,000 comes off; the wallet pays the rest.
    const q2 = await electricityQuote(user.token, 500_000, { couponCode: code });
    expect(q2.body.data).toMatchObject({ discount: 300_000, total: 500_000 + 10_000 - 300_000 });
    expect((await pay(user.token, q2.body.data.id)).body.data.status).toBe('success');
    expect((await call('GET', '/api/coupons/balances', user.token)).body.data).toEqual([]);
    expect(await balance(user.token)).toBe(1_000_000 - 2_000 - 210_000);

    // Only one of two slots was claimed. At expiry the other ₦5,000 goes back to the owner.
    const ownerBefore = await balance(owner.token);
    await CouponModel.updateOne({ code }, { expiresAt: new Date(Date.now() - 1000) });
    await CouponsService.sweep();
    expect(await balance(owner.token)).toBe(ownerBefore + 500_000);
    await expectBooksBalanced();
  });

  it('keeps a gift balance for the recipient', async () => {
    const sender = await signUp();
    const recipient = await signUp();
    await fund(sender.token, 1_000_000);
    const gq = await call('POST', '/api/quotes', sender.token, { kind: 'gift', recipient: { type: 'phone', value: recipient.phone }, amount: 500_000 });
    const code = (await call('POST', '/api/gifts', sender.token, { quoteId: gq.body.data.id, pin: '2580' })).body.data.coupon.code;
    await fund(recipient.token, 10_000);
    const q = await airtimeQuote(recipient.token, recipient.phone, 100_000, { couponCode: code });
    await pay(recipient.token, q.body.data.id);
    const received = await call('GET', '/api/gifts/received', recipient.token);
    expect(received.body.data[0]).toMatchObject({ code, myBalance: { left: 400_000 } });
    await expectBooksBalanced();
  });
});

describe('Tasa promotions', () => {
  it('rejects an uncapped percentage and warns on a fixed promo with no minimum spend', async () => {
    const bad = await call('POST', '/api/admin/promotions', await asAdmin(), {
      code: 'NOCAP', title: 'No cap', valueType: 'percent', value: 50, budget: 100_000, expiresAt: inAMonth(),
    });
    expect(bad.body.errors).toHaveProperty('maxDiscount');
    const { warnings } = await createPromo({ code: 'FIVEHUNDRED', valueType: 'fixed', value: 50_000, budget: 1_000_000 });
    expect(warnings.join(' ')).toMatch(/minimum spend/);
    // A user can't create promos.
    const { token } = await signUp();
    expect((await call('POST', '/api/admin/promotions', token, { code: 'HACK' })).status).toBe(403);
  });

  it('applies 50% up to the cap, enforces min spend, per-user uses and the budget, and books the cost', async () => {
    const { promo: dec } = await createPromo({ code: 'DECEMBER50', valueType: 'percent', value: 50, maxDiscount: 200_000, minSpend: 100_000, budget: 300_000 });
    const a = await signUp();
    const b = await signUp();
    const c = await signUp();
    for (const u of [a, b, c]) await fund(u.token, 2_000_000);

    expect((await airtimeQuote(a.token, a.phone, 50_000, { couponCode: 'december50' })).body.code).toBe('COUPON_MIN_SPEND');

    const qa = await electricityQuote(a.token, 1_000_000, { couponCode: 'DECEMBER50' });
    // Charge is still on the full ₦10,000; 50% of ₦10,000 is capped at ₦2,000.
    expect(qa.body.data).toMatchObject({ amount: 1_000_000, fee: 10_000, discount: 200_000, total: 810_000, coupon: { kind: 'promo', title: 'Test promo' } });
    expect((await pay(a.token, qa.body.data.id)).body.data.status).toBe('success');
    expect(await LedgerService.balance(`expense:promotions:${dec.id}`)).toBe(200_000);

    expect((await electricityQuote(a.token, 1_000_000, { couponCode: 'DECEMBER50' })).body.code).toBe('COUPON_LIMIT_REACHED');

    // ₦1,000 of budget left: B gets that, not ₦2,000.
    const qb = await electricityQuote(b.token, 1_000_000, { couponCode: 'DECEMBER50' });
    expect(qb.body.data.discount).toBe(100_000);
    await pay(b.token, qb.body.data.id);
    expect((await electricityQuote(c.token, 1_000_000, { couponCode: 'DECEMBER50' })).body.code).toBe('PROMO_ENDED');

    const promos = await call('GET', '/api/admin/promotions', await asAdmin());
    const row = promos.body.data.items.find((p: { code: string }) => p.code === 'DECEMBER50');
    expect(row.stats).toEqual({ uses: 2, users: 2, spent: 300_000, budgetLeft: 0 });
    await expectBooksBalanced();
  });

  it('cannot be used twice by one user even when both payments race', async () => {
    await createPromo({ code: 'ONCEONLY', valueType: 'fixed', value: 50_000, minSpend: 100_000, budget: 10_000_000 });
    const { token } = await signUp();
    await fund(token, 3_000_000);
    const [q1, q2] = await Promise.all([
      electricityQuote(token, 1_000_000, { couponCode: 'ONCEONLY' }),
      electricityQuote(token, 1_000_000, { couponCode: 'ONCEONLY' }),
    ]);
    const results = await Promise.all([pay(token, q1.body.data.id), pay(token, q2.body.data.id)]);
    expect(results.map((r) => r.body.data?.status ?? r.body.code).sort()).toEqual(['COUPON_LIMIT_REACHED', 'success']);
    expect(await balance(token)).toBe(3_000_000 - (1_010_000 - 50_000));
    await expectBooksBalanced();
  });

  it('gives the use and the budget back when the bill fails', async () => {
    await createPromo({ code: 'RETRYME', valueType: 'fixed', value: 50_000, minSpend: 100_000, budget: 50_000 });
    const { token, phone } = await signUp();
    await fund(token, 1_000_000);
    vt.pay = () => ({ json: { code: '016', response_description: 'TRANSACTION FAILED' } });
    const q = await airtimeQuote(token, phone, 200_000, { couponCode: 'RETRYME' });
    expect((await pay(token, q.body.data.id)).body.data.status).toBe('failed');
    expect(await balance(token)).toBe(1_000_000);

    vt.pay = (b) => delivered(b);
    const again = await airtimeQuote(token, phone, 200_000, { couponCode: 'RETRYME' });
    expect(again.body.data.discount).toBe(50_000); // budget and use both restored
    expect((await pay(token, again.body.data.id)).body.data.status).toBe('success');
    await expectBooksBalanced();
  });

  it('limits a first-bill promo to people who have never paid a bill', async () => {
    await createPromo({ code: 'WELCOME', valueType: 'fixed', value: 30_000, minSpend: 100_000, budget: 10_000_000, audience: 'first_bill' });
    const { token, phone } = await signUp();
    await fund(token, 1_000_000);
    const q = await airtimeQuote(token, phone, 100_000, { couponCode: 'WELCOME' });
    expect(q.body.data.discount).toBe(30_000);
    await pay(token, q.body.data.id);
    const listed = (await call('GET', '/api/promotions', token)).body.data.map((p: { code: string }) => p.code);
    expect(listed).not.toContain('WELCOME'); // used up for them
    const veteran = await signUp();
    await fund(veteran.token, 1_000_000);
    await pay(veteran.token, (await airtimeQuote(veteran.token, veteran.phone, 100_000)).body.data.id);
    expect((await airtimeQuote(veteran.token, veteran.phone, 100_000, { couponCode: 'WELCOME' })).body.code).toBe('COUPON_AUDIENCE');
  });

  it('auto-applies a "free service charge" promo without a code, only on the services it covers', async () => {
    const { promo } = await createPromo({
      code: 'FREECHARGE', valueType: 'percent', value: 100, maxDiscount: 50_000, appliesTo: 'fee', budget: 10_000_000, usesPerUser: 5, autoApply: true,
      services: ['electricity'],
    });
    const { token, phone } = await signUp();
    await fund(token, 2_000_000);
    const q = await electricityQuote(token, 1_000_000);
    expect(q.body.data).toMatchObject({ fee: 10_000, discount: 10_000, total: 1_000_000, coupon: { code: 'FREECHARGE', auto: true } });
    expect((await pay(token, q.body.data.id)).body.data.status).toBe('success');

    expect((await airtimeQuote(token, phone, 100_000)).body.data.coupon).toBeUndefined(); // not in scope
    expect((await electricityQuote(token, 1_000_000, { autoApply: false })).body.data.discount).toBe(0);

    // Paused promos stop applying immediately.
    await call('PATCH', `/api/admin/promotions/${promo.id}`, await asAdmin(), { status: 'paused' });
    expect((await electricityQuote(token, 1_000_000)).body.data.discount).toBe(0);
    await call('POST', `/api/admin/promotions/${promo.id}/end`, await asAdmin());
    await expectBooksBalanced();
  });
});

describe('Tasa giveaways', () => {
  it('books a giveaway coupon to expense:giveaways as it is used, and tracks what it could still cost', async () => {
    const admin = await asAdmin();
    const created = await call('POST', '/api/admin/coupons', admin, {
      kind: 'coupon', title: 'Launch giveaway', code: 'TASA-LAUNCH', amount: 100_000, quantity: 2, expiresAt: inAMonth(),
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ fundedBy: 'tasa', owner: null, stats: { cost: 0, maxExposure: 200_000, exposureLeft: 200_000 } });
    const id = created.body.data.id as string;

    const { token, phone } = await signUp();
    await fund(token, 100_000);
    const q = await airtimeQuote(token, phone, 100_000, { couponCode: 'TASA-LAUNCH' });
    expect(q.body.data).toMatchObject({ discount: 100_000, total: 2_000, coupon: { fundedBy: 'tasa' } });
    expect((await pay(token, q.body.data.id)).body.data.status).toBe('success');

    expect(await LedgerService.balance(`expense:giveaways:${id}`)).toBe(100_000);
    const detail = await call('GET', `/api/admin/coupons/${id}`, admin);
    expect(detail.body.data.stats).toMatchObject({ claims: 1, uses: 1, used: 100_000, cost: 100_000, exposureLeft: 100_000 });

    const report = await call('GET', '/api/admin/reports/giveaways', admin);
    const row = report.body.data.items.find((i: { code: string }) => i.code === 'TASA-LAUNCH');
    expect(row).toMatchObject({ kind: 'coupon', uses: 1, people: 1, costToDate: 100_000, maxCost: 200_000, exposureLeft: 100_000 });

    // Closing stops further cost; nobody is "refunded" because Tasa never set money aside.
    await call('POST', `/api/admin/coupons/${id}/close`, admin);
    const after = await call('GET', '/api/admin/reports/giveaways', admin);
    expect(after.body.data.items.find((i: { code: string }) => i.code === 'TASA-LAUNCH').exposureLeft).toBeLessThanOrEqual(100_000);
    const other = await signUp();
    expect((await airtimeQuote(other.token, other.phone, 100_000, { couponCode: 'TASA-LAUNCH' })).body.code).toBe('COUPON_USED_UP');
    await expectBooksBalanced();
  });

  it('sends a Tasa-funded gift to a phone number', async () => {
    const { token, phone } = await signUp();
    const gift = await call('POST', '/api/admin/coupons', await asAdmin(), {
      kind: 'gift', title: 'Sorry about your token', amount: 50_000, recipient: { type: 'phone', value: phone }, expiresAt: inAMonth(),
    });
    expect(gift.body.data).toMatchObject({ kind: 'gift', fundedBy: 'tasa', recipient: { label: phone, user: expect.any(String) } });
    expect((await call('GET', '/api/gifts/received', token)).body.data[0]).toMatchObject({ code: gift.body.data.code, fundedBy: 'tasa' });
  });

  it('only lets finance create giveaways', async () => {
    const support = await AdminModel.create({ name: 'Support', email: 'sup@tasa.test', role: 'support', passwordHash: await bcrypt.hash('correct-horse', 4) });
    const login = await call('POST', '/api/auth/admin/login', undefined, { email: support.email, password: 'correct-horse' });
    const res = await call('POST', '/api/admin/coupons', login.body.data.accessToken, { kind: 'coupon', title: 'x', amount: 10_000, expiresAt: inAMonth() });
    expect(res.status).toBe(403);
  });
});

describe('profit and loss', () => {
  const today = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const pnl = async () => (await call('GET', `/api/admin/reports/pnl?from=${today()}&to=${today()}`, await asAdmin())).body.data;

  it('adds up charges, VTpass commission, absorbed funding fees and giveaways from the ledger', async () => {
    const before = await pnl();
    const { token, phone } = await signUp();

    // Funding ₦20,000: the user is credited ₦20,000; SaySwitch keeps ₦50, which is our cost.
    const fq = await call('POST', '/api/quotes', token, { kind: 'funding', amount: 2_000_000 });
    const started = await call('POST', '/api/wallet/fundings', token, { quoteId: fq.body.data.id });
    say.verify.set(started.body.data.reference, { status: 'success', amount: '20000.00', fees: '50.00' });
    await call('GET', `/api/wallet/fundings/${started.body.data.reference}`, token);
    expect(await balance(token)).toBe(2_000_000);

    // Electricity ₦10,000: ₦100 charge, VTpass takes ₦9,900 → ₦100 commission.
    const eq = await electricityQuote(token, 1_000_000);
    await pay(token, eq.body.data.id);

    // A failed bill: its ₦20 charge is reversed, so it nets to nothing.
    vt.pay = () => ({ json: { code: '016' } });
    await pay(token, (await airtimeQuote(token, phone, 100_000)).body.data.id);
    vt.pay = (b) => delivered(b);

    // A ₦500 Tasa giveaway, used in full on a ₦500 airtime (+₦20 charge).
    await call('POST', '/api/admin/coupons', await asAdmin(), { kind: 'coupon', title: 'PnL test', code: 'PNL-500', amount: 50_000, quantity: 1, expiresAt: inAMonth() });
    await pay(token, (await airtimeQuote(token, phone, 50_000, { couponCode: 'PNL-500' })).body.data.id);

    const after = await pnl();
    const d = (f: (r: any) => number) => f(after) - f(before);
    expect(d((r) => r.revenue.charges.byScope.bill?.byService?.electricity ?? 0)).toBe(10_000);
    expect(d((r) => r.revenue.charges.byScope.bill?.byService?.airtime ?? 0)).toBe(2_000); // the failed one reversed
    expect(d((r) => r.revenue.commission.byService.electricity ?? 0)).toBe(10_000);
    expect(d((r) => r.costs.fundingFees.bySource.funding ?? 0)).toBe(5_000);
    expect(d((r) => r.costs.giveaways.total)).toBe(50_000);
    expect(d((r) => r.net)).toBe(10_000 + 2_000 + 10_000 + 500 /* airtime commission */ - 5_000 - 50_000);
    expect(after.series.at(-1)).toMatchObject({ day: today() });
    await expectBooksBalanced();
  });

  it('flags fundings where SaySwitch did not report its fee', async () => {
    const before = (await pnl()).costs.fundingFees.unreportedCount;
    const { token } = await signUp();
    await fund(token, 100_000); // the fake verify reports no `fees`
    expect((await pnl()).costs.fundingFees.unreportedCount).toBe(before + 1);
  });

  it('shows the overview dashboard', async () => {
    const res = await call('GET', `/api/admin/reports/overview?from=${today()}&to=${today()}`, await asAdmin());
    expect(res.body.data).toMatchObject({ users: { total: expect.any(Number) }, bills: { count: expect.any(Number) }, attention: expect.any(Object) });
    expect(res.body.data.walletLiability).toBeGreaterThan(0);
  });
});

describe('staff', () => {
  it("tells an admin a mistyped current password apart from a lost session", async () => {
    await AdminModel.create({ name: 'Pat', email: 'pat@tasa.test', role: 'support', passwordHash: await bcrypt.hash('correct-horse', 4) });
    const pat = (await call('POST', '/api/auth/admin/login', undefined, { email: 'pat@tasa.test', password: 'correct-horse' })).body.data;
    const wrong = await call('POST', '/api/admin/me/password', pat.accessToken, { currentPassword: 'not-it', newPassword: 'a-much-longer-pass' });
    expect(wrong).toMatchObject({ status: 422, body: { code: 'PASSWORD_INCORRECT' } });
    expect((await call('POST', '/api/admin/me/password', pat.accessToken, { currentPassword: 'correct-horse', newPassword: 'a-much-longer-pass' })).status).toBe(200);
    // Every session ends, this one's refresh token included.
    expect((await call('POST', '/api/auth/refresh', undefined, { refreshToken: pat.refreshToken })).status).toBe(401);
  });

  it('lets a super admin manage staff, and a deactivation takes effect on the next request', async () => {
    await AdminModel.create({ name: 'Boss', email: 'boss@tasa.test', role: 'super_admin', passwordHash: await bcrypt.hash('correct-horse', 4) });
    const boss = (await call('POST', '/api/auth/admin/login', undefined, { email: 'boss@tasa.test', password: 'correct-horse' })).body.data;

    const created = await call('POST', '/api/admin/staff', boss.accessToken, { name: 'New Finance', email: 'nf@tasa.test', role: 'finance', password: 'a-long-password-1' });
    expect(created.status).toBe(201);
    const nf = (await call('POST', '/api/auth/admin/login', undefined, { email: 'nf@tasa.test', password: 'a-long-password-1' })).body.data;
    expect((await call('GET', '/api/admin/charges', nf.accessToken)).status).toBe(200);
    expect((await call('GET', '/api/admin/staff', nf.accessToken)).status).toBe(403);

    await call('PATCH', `/api/admin/staff/${created.body.data.id}`, boss.accessToken, { isActive: false });
    expect((await call('GET', '/api/admin/charges', nf.accessToken)).status).toBe(401); // token still unexpired
    expect((await call('POST', '/api/auth/refresh', undefined, { refreshToken: nf.refreshToken })).status).toBe(401);

    // The last super admin can't be demoted or deactivated.
    const self = await call('PATCH', `/api/admin/staff/${boss.admin.id}`, boss.accessToken, { role: 'finance' });
    expect(self.status).toBe(403);
  });
});

describe('sign-in by email', () => {
  let emailSeq = 0;
  async function signUpByEmail() {
    const address = `user${++emailSeq}@example.com`;
    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'email', value: address.toUpperCase() });
    expect(otp.body.data).toMatchObject({ channel: 'email' });
    const verified = await call('POST', '/api/auth/otp/verify', undefined, { type: 'email', value: address, code: otp.body.data.code });
    expect(verified.status).toBe(200);
    const token = verified.body.data.accessToken as string;
    await call('PUT', '/api/me/pin', token, { pin: '2580' });
    return { token, address, user: verified.body.data.user };
  }

  it('creates an account with just an email, and that account can fund and pay bills', async () => {
    const { token, user, address } = await signUpByEmail();
    expect(user).toMatchObject({ email: address, phone: null });
    await fund(token, 1_000_000);
    expect(calls.find((c) => c.path.includes('banktransfer'))!.body.email).toBe(address);
    expect((await pay(token, (await electricityQuote(token, 500_000)).body.data.id)).body.data.status).toBe('success');
    // VTpass needs a customer phone; this user has none, so the business number goes.
    expect(vtCalls('/api/pay')[0]!.body.phone).toBe(env.BUSINESS_PHONE);
  });

  it('a code sent to an email cannot be used for a phone, or for linking', async () => {
    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'email', value: 'cross@example.com' });
    expect((await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: '08099990001', code: otp.body.data.code })).status).toBe(401);
  });

  it("never shows an email-only user other people's gifts", async () => {
    const sender = await signUp();
    const someone = await signUp();
    await fund(sender.token, 500_000);
    const gq = await call('POST', '/api/quotes', sender.token, { kind: 'gift', recipient: { type: 'phone', value: someone.phone }, amount: 100_000 });
    await call('POST', '/api/gifts', sender.token, { quoteId: gq.body.data.id, pin: '2580' });
    const { token } = await signUpByEmail();
    expect((await call('GET', '/api/gifts/received', token)).body.data).toEqual([]);
  });

  it('adds a phone only after verifying it, and then either one signs in to the same account', async () => {
    const { token, user } = await signUpByEmail();
    const phone = '08077712345';
    const sent = await call('POST', '/api/me/contacts/otp', token, { type: 'phone', value: phone });
    expect((await call('POST', '/api/me/contacts/verify', token, { type: 'phone', value: phone, code: '000000' === sent.body.data.code ? '111111' : '000000' })).status).toBe(401);
    const linked = await call('POST', '/api/me/contacts/verify', token, { type: 'phone', value: phone, code: sent.body.data.code });
    expect(linked.body.data).toMatchObject({ id: user.id, phone: '+2348077712345' });

    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: phone });
    const viaPhone = await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: phone, code: otp.body.data.code });
    expect(viaPhone.body.data).toMatchObject({ isNewUser: false, user: { id: user.id } });
  });

  it("refuses to link a phone or email that belongs to someone else, and won't take email from PATCH", async () => {
    const other = await signUp();
    const { token, address } = await signUpByEmail();
    expect((await call('POST', '/api/me/contacts/otp', token, { type: 'phone', value: other.phone })).body.code).toBe('CONTACT_TAKEN');
    const patched = await call('PATCH', '/api/me', other.token, { email: address, username: 'other_x' });
    expect(patched.body.data.email).toBeNull(); // ignored: an unverified email would hijack sign-in
  });
});

describe('SaySwitch fees', () => {
  it('books the fee carried by the signed webhook', async () => {
    const { token } = await signUp();
    const quote = await call('POST', '/api/quotes', token, { kind: 'funding', amount: 500_000 });
    const started = await call('POST', '/api/wallet/fundings', token, { quoteId: quote.body.data.id });
    const reference = started.body.data.reference as string;
    say.verify.set(reference, { status: 'success', amount: '5000.00' }); // verify without fees
    const { raw, headers } = signed({ notify: 'transaction', notifyType: 'successful', data: { reference, amount: '5000.00', fees: '75.00' } });
    await app.inject({ method: 'POST', url: '/api/webhooks/sayswitch', headers, payload: raw });
    await WebhooksService.process((await WebhookEventModel.findOne({ reference }))!.id);

    const tx = await TransactionModel.findOne({ reference });
    expect(tx!.funding).toMatchObject({ providerFee: 7_500, providerFeeReported: true });
    expect(await balance(token)).toBe(500_000); // the user never sees the fee
    await expectBooksBalanced();
  });

  it('books a fee that arrives after polling already credited the funding, exactly once', async () => {
    const { token } = await signUp();
    const quote = await call('POST', '/api/quotes', token, { kind: 'funding', amount: 500_000 });
    const started = await call('POST', '/api/wallet/fundings', token, { quoteId: quote.body.data.id });
    const reference = started.body.data.reference as string;
    say.verify.set(reference, { status: 'success', amount: '5000.00' });
    expect((await call('GET', `/api/wallet/fundings/${reference}`, token)).body.data.status).toBe('success');
    expect((await TransactionModel.findOne({ reference }))!.funding!.providerFeeReported).toBe(false);

    const { raw, headers } = signed({ notify: 'transaction', notifyType: 'successful', data: { reference, fees: '75.00' } });
    await app.inject({ method: 'POST', url: '/api/webhooks/sayswitch', headers, payload: raw });
    const event = (await WebhookEventModel.findOne({ reference }))!;
    await WebhooksService.process(event.id);
    await WebhooksService.process(event.id); // replay

    const feeLines = await LedgerEntryModel.find({ posting: `funding:${reference}:fee` });
    expect(feeLines.map((l) => [l.account, l.amount]).sort()).toEqual([
      ['expense:provider_fees:funding', 7_500],
      ['provider:sayswitch', -7_500],
    ]);
    expect(await balance(token)).toBe(500_000);
    await expectBooksBalanced();
  });
});

describe('recipient lookup', () => {
  async function emailUser(address: string) {
    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'email', value: address });
    const v = await call('POST', '/api/auth/otp/verify', undefined, { type: 'email', value: address, code: otp.body.data.code });
    await call('PUT', '/api/me/pin', v.body.data.accessToken, { pin: '2580' });
    return { token: v.body.data.accessToken as string, id: v.body.data.user.id as string };
  }

  it('finds a Tasa user by username, phone or email without revealing their contact details', async () => {
    const ada = await signUp('ada_look');
    await call('POST', '/api/me/contacts/verify', ada.token, {
      type: 'email', value: 'ada.look@example.com',
      code: (await call('POST', '/api/me/contacts/otp', ada.token, { type: 'email', value: 'ada.look@example.com' })).body.data.code,
    });
    await call('PATCH', '/api/me', ada.token, { fullName: 'Adaeze Okafor' });
    const me = await signUp();

    for (const r of [
      { type: 'username', value: '@Ada_Look' },
      { type: 'phone', value: ada.phone },
      { type: 'email', value: 'ADA.LOOK@example.com' },
    ]) {
      const res = await call('POST', '/api/users/lookup', me.token, r);
      expect(res.body.data).toEqual({ found: true, isSelf: false, user: { username: 'ada_look', name: 'Adaeze O.' } });
    }
    expect((await call('POST', '/api/users/lookup', ada.token, { type: 'username', value: 'ada_look' })).body.data.isSelf).toBe(true);
  });

  it('says whether someone not on Tasa can still be invited', async () => {
    const { token } = await signUp();
    expect((await call('POST', '/api/users/lookup', token, { type: 'phone', value: '08055500001' })).body.data).toEqual({ found: false, canInvite: true });
    expect((await call('POST', '/api/users/lookup', token, { type: 'username', value: 'nobody_here' })).body.data).toEqual({ found: false, canInvite: false });
    expect((await call('POST', '/api/users/lookup', token, { type: 'email', value: 'not-an-email' })).status).toBe(400);
  });

  it('locks a gift sent by username to that account, and shows the sender only what they typed', async () => {
    const sender = await signUp();
    const bob = await signUp('bob_gift');
    const stranger = await signUp();
    await fund(sender.token, 500_000);
    const gq = await call('POST', '/api/quotes', sender.token, { kind: 'gift', recipient: { type: 'username', value: 'bob_gift' }, amount: 100_000 });
    expect(gq.body.data.gift).toMatchObject({ recipient: '@bob_gift', onTasa: true });
    const code = (await call('POST', '/api/gifts', sender.token, { quoteId: gq.body.data.id, pin: '2580' })).body.data.coupon.code;

    expect((await call('GET', '/api/gifts/received', bob.token)).body.data[0]).toMatchObject({ code });
    expect((await call('GET', '/api/gifts/received', stranger.token)).body.data).toEqual([]);
    expect((await airtimeQuote(stranger.token, stranger.phone, 100_000, { couponCode: code })).body.code).toBe('COUPON_NOT_YOURS');

    const asSender = await call('GET', `/api/coupons/code/${code}`, sender.token);
    expect(asSender.body.data.recipient).toEqual({ label: '@bob_gift', name: '@bob_gift' });
    expect(JSON.stringify(asSender.body.data)).not.toContain(bob.phone.slice(1)); // never Bob's number
    expect((await call('POST', '/api/quotes', sender.token, { kind: 'gift', recipient: { type: 'username', value: 'ghost_user' }, amount: 100_000 })).status).toBe(404);
  });

  it('sends a gift to an email that is not on Tasa yet; it is waiting when they sign up', async () => {
    const sender = await signUp();
    await fund(sender.token, 500_000);
    const gq = await call('POST', '/api/quotes', sender.token, { kind: 'gift', recipient: { type: 'email', value: 'newbie@example.com' }, amount: 100_000 });
    expect(gq.body.data.gift).toMatchObject({ recipient: 'newbie@example.com', onTasa: false });
    const code = (await call('POST', '/api/gifts', sender.token, { quoteId: gq.body.data.id, pin: '2580' })).body.data.coupon.code;

    const newbie = await emailUser('newbie@example.com');
    expect((await call('GET', '/api/gifts/received', newbie.token)).body.data[0]).toMatchObject({ code });
    await fund(newbie.token, 10_000);
    const q = await airtimeQuote(newbie.token, '08011111111', 100_000, { couponCode: code });
    expect(q.body.data.discount).toBe(100_000);
    expect((await pay(newbie.token, q.body.data.id)).body.data.status).toBe('success');
    await expectBooksBalanced();
  });

  it('refuses gifting yourself by any of your details', async () => {
    const me = await signUp('self_giver');
    await fund(me.token, 500_000);
    for (const r of [{ type: 'username', value: 'self_giver' }, { type: 'phone', value: me.phone }]) {
      expect((await call('POST', '/api/quotes', me.token, { kind: 'gift', recipient: r, amount: 100_000 })).body.code).toBe('SELF_GIFT');
    }
  });

  it('transfers to a user found by email', async () => {
    const sender = await signUp();
    const receiver = await emailUser('receiver@example.com');
    await fund(sender.token, 500_000);
    const q = await call('POST', '/api/quotes', sender.token, { kind: 'transfer', recipient: { type: 'email', value: 'receiver@example.com' }, amount: 100_000 });
    expect(q.body.data.transfer).toEqual({ username: null, name: 'Tasa user' });
    expect((await call('POST', '/api/transfers', sender.token, { quoteId: q.body.data.id, pin: '2580' })).status).toBe(201);
    expect(await balance(receiver.token)).toBe(100_000);
    expect((await call('POST', '/api/quotes', sender.token, { kind: 'transfer', recipient: { type: 'phone', value: '08055500002' }, amount: 100_000 })).status).toBe(404);
  });
});

describe('gifts: auto-apply, pay their bill, inbox', () => {
  async function sendGift(sender: { token: string }, to: Record<string, string>, amount: number, extra: Record<string, unknown> = {}) {
    const gq = await call('POST', '/api/quotes', sender.token, { kind: 'gift', recipient: to, amount, ...extra });
    const res = await call('POST', '/api/gifts', sender.token, { quoteId: gq.body.data.id, pin: '2580' });
    expect(res.status).toBe(201);
    return res.body.data.coupon as { id: string; code: string };
  }

  it('applies a gift balance at checkout without a code, soonest-expiring first', async () => {
    const mum = await signUp('mum_gifts');
    const aunt = await signUp();
    const me = await signUp('me_gifts');
    await fund(mum.token, 1_000_000);
    await fund(aunt.token, 1_000_000);
    await fund(me.token, 1_000_000);
    const later = await sendGift(mum, { type: 'username', value: 'me_gifts' }, 300_000, { serviceId: 'electricity' });
    const sooner = await sendGift(aunt, { type: 'phone', value: me.phone }, 200_000);
    await CouponModel.updateOne({ _id: sooner.id }, { expiresAt: new Date(Date.now() + 86_400_000) });

    const q = await electricityQuote(me.token, 500_000);
    expect(q.body.data).toMatchObject({ discount: 200_000, coupon: { kind: 'gift', code: sooner.code, auto: true } });
    expect((await pay(me.token, q.body.data.id)).body.data.status).toBe('success');
    const q2 = await electricityQuote(me.token, 500_000);
    expect(q2.body.data.coupon).toMatchObject({ code: later.code, auto: true });
    expect((await electricityQuote(me.token, 500_000, { autoApply: false })).body.data.discount).toBe(0);
    await expectBooksBalanced();
  });

  it('pays a bill for someone; they get it in their inbox with the token, and the badge clears once seen', async () => {
    const sender = await signUp();
    const mum = await signUp('mum_bill');
    await fund(sender.token, 2_000_000);
    const q = await electricityQuote(sender.token, 1_000_000, { giftTo: { type: 'username', value: 'mum_bill' }, giftMessage: 'Light for the week ❤️' });
    expect(q.body.data.giftTo).toMatchObject({ recipient: '@mum_bill', onTasa: true });
    vt.pay = (b) => delivered(b, { purchased_code: 'Token : 5555-6666' });
    const paid = await pay(sender.token, q.body.data.id);
    expect(paid.body.data).toMatchObject({ status: 'success', title: expect.stringMatching(/^Gift: /), giftTo: { recipient: '@mum_bill' } });
    expect(await balance(sender.token)).toBe(2_000_000 - 1_010_000); // sender pays bill + charge

    const me = await call('GET', '/api/me', mum.token);
    expect(me.body.data.gifts).toEqual({ unseen: 1, balance: 0 });
    const inbox = await call('GET', '/api/gifts/inbox', mum.token);
    expect(inbox.body.data.items[0]).toMatchObject({
      type: 'bill_paid', serviceId: 'electricity', amount: 1_000_000, token: '5555-6666', message: 'Light for the week ❤️', seen: false,
    });
    // The inbox is built from the gift records themselves, not from notifications, so a
    // missed push/SMS (or a notification that was never sent) can't hide a gift.

    await call('POST', '/api/gifts/inbox/seen', mum.token, {});
    expect((await call('GET', '/api/me', mum.token)).body.data.gifts.unseen).toBe(0);
    // Not anyone else's gift.
    const stranger = await signUp();
    expect((await call('GET', '/api/gifts/inbox', stranger.token)).body.data.items).toEqual([]);
  });

  it('holds a "pay their bill" gift for a phone that is not on Tasa, and shows it once they join', async () => {
    const sender = await signUp();
    await fund(sender.token, 1_000_000);
    const newPhone = '08066600001';
    const q = await airtimeQuote(sender.token, newPhone, 100_000, { giftTo: { type: 'phone', value: newPhone } });
    expect(q.body.data.giftTo).toMatchObject({ onTasa: false });
    await pay(sender.token, q.body.data.id);

    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: newPhone });
    const joined = await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: newPhone, code: otp.body.data.code });
    const inbox = await call('GET', '/api/gifts/inbox', joined.body.data.accessToken);
    expect(inbox.body.data.items).toHaveLength(1);
    expect(inbox.body.data.items[0]).toMatchObject({ type: 'bill_paid', serviceId: 'airtime', amount: 100_000 });
  });

  it("shows gift balances in the inbox with what's left and who sent them", async () => {
    const sender = await signUp();
    await call('PATCH', '/api/me', sender.token, { fullName: 'Ngozi Eze' });
    const me = await signUp('inbox_bal');
    await fund(sender.token, 1_000_000);
    await sendGift(sender, { type: 'username', value: 'inbox_bal' }, 400_000, { message: 'For data' });
    const inbox = (await call('GET', '/api/gifts/inbox', me.token)).body.data;
    expect(inbox).toMatchObject({ unseen: 1, balance: 400_000 });
    expect(inbox.items[0]).toMatchObject({ type: 'balance', from: 'Ngozi E.', left: 400_000, message: 'For data' });
  });

  it("won't gift a bill to yourself or to an unknown username", async () => {
    const me = await signUp('self_bill');
    await fund(me.token, 1_000_000);
    expect((await electricityQuote(me.token, 500_000, { giftTo: { type: 'username', value: 'self_bill' } })).body.code).toBe('SELF_GIFT');
    expect((await electricityQuote(me.token, 500_000, { giftTo: { type: 'username', value: 'nobody_x' } })).status).toBe(404);
  });
});

describe('forgotten PIN', () => {
  const resetCode = async (token: string) => (await call('POST', '/api/me/pin/reset/otp', token, {})).body.data.code as string;

  it('proves a PIN without touching it, and counts wrong tries', async () => {
    const me = await signUp();
    expect((await call('POST', '/api/me/pin/verify', me.token, { pin: '2580' })).body.data).toEqual({ valid: true });
    const wrong = await call('POST', '/api/me/pin/verify', me.token, { pin: '1357' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('PIN_INCORRECT');
    expect(wrong.body.message).toContain('4 attempts');
  });

  it('resets by code, clears a lockout, and the new PIN can pay straight away', async () => {
    const me = await signUp();
    await fund(me.token, 1_000_000);
    for (let i = 0; i < 5; i += 1) await call('POST', '/api/me/pin/verify', me.token, { pin: '1357' });
    expect((await call('POST', '/api/me/pin/verify', me.token, { pin: '2580' })).status).toBe(423);

    const code = await resetCode(me.token);
    const bad = await call('POST', '/api/me/pin/reset', me.token, { code: code === '000000' ? '111111' : '000000', pin: '7913' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await call('POST', '/api/me/pin/reset', me.token, { code, pin: '1234' })).body.code).toBe('WEAK_PIN');
    const done = await call('POST', '/api/me/pin/reset', me.token, { code, pin: '7913' });
    expect(done.status).toBe(200);
    expect((await call('POST', '/api/me/pin/verify', me.token, { pin: '2580' })).status).toBe(422);

    const quote = await airtimeQuote(me.token, me.phone, 100_000);
    expect((await call('POST', '/api/bills/purchases', me.token, { quoteId: quote.body.data.id, pin: '7913' })).status).toBe(201);
    await expectBooksBalanced();
  });

  it('a code for sign-in cannot reset a PIN', async () => {
    const me = await signUp();
    await redis.del(`otp:cooldown:login:phone:+234${me.phone.slice(1)}`);
    const login = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: me.phone });
    expect((await call('POST', '/api/me/pin/reset', me.token, { code: login.body.data.code, pin: '7913' })).status).toBeGreaterThanOrEqual(400);
    expect((await call('POST', '/api/me/pin/verify', me.token, { pin: '2580' })).status).toBe(200);
  });
});

describe('suspended accounts', () => {
  it('cannot spend on a live token, and their sessions end at once', async () => {
    const me = await signUp();
    await fund(me.token, 1_000_000);
    const quote = await airtimeQuote(me.token, me.phone, 100_000);
    const res = await call('POST', `/api/admin/users/${me.userId}/status`, await asSupport(), { status: 'suspended' });
    expect(res.status).toBe(200);

    expect((await pay(me.token, quote.body.data.id)).status).toBe(403);
    expect(vtCalls('/api/pay')).toHaveLength(0);
    expect((await call('POST', '/api/auth/refresh', undefined, { refreshToken: me.refreshToken })).status).toBe(401);
    expect(await balance(me.token)).toBe(1_000_000);
    await expectBooksBalanced();
  });

  it('are skipped by system debits too', async () => {
    const me = await signUp();
    await fund(me.token, 1_000_000);
    const { id } = (await airtimeQuote(me.token, me.phone, 100_000)).body.data;
    await UserModel.updateOne({ _id: me.userId }, { status: 'suspended' });
    await expect(BillsService.purchase(me.userId, id, { system: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(vtCalls('/api/pay')).toHaveLength(0);
  });
});

describe('closing an account', () => {
  it('refuses while money is in it, then removes personal data and keeps the books', async () => {
    const me = await signUp('closing_user');
    await fund(me.token, 500_000);
    expect((await call('DELETE', '/api/me', me.token, { pin: '1357' })).body.code).toBe('PIN_INCORRECT');
    expect((await call('DELETE', '/api/me', me.token, { pin: '2580' })).body.code).toBe('ACCOUNT_HAS_BALANCE');

    // Charges are admin-set, so work out what's left after one and empty the wallet exactly.
    const probe = await airtimeQuote(me.token, me.phone, 100_000);
    const fee = (probe.body.data.total as number) - 100_000;
    const quote = await airtimeQuote(me.token, me.phone, 500_000 - fee);
    expect(quote.body.data.total).toBe(500_000);
    expect((await pay(me.token, quote.body.data.id)).status).toBe(201);
    expect(await balance(me.token)).toBe(0);

    expect((await call('DELETE', '/api/me', me.token, { pin: '2580' })).status).toBe(200);
    const closed = await UserModel.findById(me.userId).select('+pinHash +bvnCipher').lean();
    expect(closed).toMatchObject({ status: 'closed' });
    expect(closed?.phone).toBeUndefined();
    expect(closed?.username).toBeUndefined();
    expect(closed?.pinHash).toBeUndefined();
    expect((await call('POST', '/api/auth/refresh', undefined, { refreshToken: me.refreshToken })).status).toBe(401);
    expect(await TransactionModel.countDocuments({ user: me.userId })).toBeGreaterThan(0);
    await expectBooksBalanced();

    const support = await asSupport();
    expect((await call('POST', `/api/admin/users/${me.userId}/status`, support, { status: 'active' })).body.code).toBe('ACCOUNT_CLOSED');

    // The phone number is free again, and it starts a brand new account.
    await redis.del(`otp:cooldown:login:phone:+234${me.phone.slice(1)}`);
    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: me.phone });
    const again = await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: me.phone, code: otp.body.data.code });
    expect(again.body.data.isNewUser).toBe(true);
    expect(again.body.data.user.id).not.toBe(me.userId);
  });
});

describe('closing an account with a small balance', () => {
  async function leaveBalance(left: number) {
    const me = await signUp();
    await fund(me.token, 1_000_000);
    const probe = await airtimeQuote(me.token, me.phone, 100_000);
    const fee = (probe.body.data.total as number) - 100_000;
    const quote = await airtimeQuote(me.token, me.phone, 1_000_000 - fee - left);
    expect((await pay(me.token, quote.body.data.id)).status).toBe(201);
    expect(await balance(me.token)).toBe(left);
    return me;
  }
  const close = (token: string, body: object) => call('DELETE', '/api/me', token, { pin: '2580', ...body });

  it('forfeits it only when the exact amount is confirmed, and the books still balance', async () => {
    const me = await leaveBalance(4_000);
    const before = await LedgerService.balance(Accounts.forfeited);
    expect((await close(me.token, {})).body.code).toBe('ACCOUNT_BALANCE_CHANGED');
    const wrong = await close(me.token, { forfeitAmount: 3_000 });
    expect(wrong.body.code).toBe('ACCOUNT_BALANCE_CHANGED');
    expect(wrong.body.errors?.balance).toBe('4000');
    expect(await balance(me.token)).toBe(4_000);

    expect((await close(me.token, { forfeitAmount: 4_000 })).status).toBe(200);
    expect(await LedgerService.balance(Accounts.wallet(me.userId))).toBe(0);
    expect((await WalletModel.findOne({ user: me.userId }))?.balance).toBe(0);
    expect(await LedgerService.balance(Accounts.forfeited)).toBe(before - 4_000);
    expect(await TransactionModel.findOne({ user: me.userId, kind: 'balance_forfeited' })).toMatchObject({ amount: 4_000, status: 'success', direction: 'debit' });
    await expectBooksBalanced();
  });

  it('never forfeits ₦100 or more, whatever is confirmed', async () => {
    const me = await leaveBalance(10_000);
    expect((await close(me.token, { forfeitAmount: 10_000 })).body.code).toBe('ACCOUNT_HAS_BALANCE');
    expect(await balance(me.token)).toBe(10_000);
  });

  it('takes nothing on a wrong PIN or while a payment is pending', async () => {
    const me = await leaveBalance(4_000);
    expect((await call('DELETE', '/api/me', me.token, { pin: '1357', forfeitAmount: 4_000 })).body.code).toBe('PIN_INCORRECT');
    await TransactionModel.create({ reference: 'TSTESTPENDING1', user: me.userId, kind: 'bill', direction: 'debit', status: 'pending', amount: 1, fee: 0, total: 1 });
    expect((await close(me.token, { forfeitAmount: 4_000 })).body.code).toBe('ACCOUNT_HAS_PENDING');
    expect(await balance(me.token)).toBe(4_000);
    await TransactionModel.deleteOne({ reference: 'TSTESTPENDING1' });
  });
});

describe('sessions', () => {
  it('signs out every device', async () => {
    const me = await signUp();
    expect((await call('POST', '/api/auth/logout/all', me.token, {})).status).toBe(200);
    expect((await call('POST', '/api/auth/refresh', undefined, { refreshToken: me.refreshToken })).status).toBe(401);
  });
});

describe('notification preferences', () => {
  const prefs = { shortfallReminders: true, push: true, paymentReceipts: false, walletFunding: true, offers: false };

  it('silence only their own category, never security notices', () => {
    expect(pushAllowed(prefs, 'bill')).toBe(false);
    expect(pushAllowed(prefs, 'offer')).toBe(false);
    expect(pushAllowed(prefs, 'wallet')).toBe(true);
    expect(pushAllowed(prefs, 'system')).toBe(true);
    expect(pushAllowed({ ...prefs, push: false }, 'wallet')).toBe(false);
  });

  it('are saved', async () => {
    const me = await signUp();
    await call('PATCH', '/api/me', me.token, { notificationPrefs: { offers: false } });
    expect((await call('GET', '/api/me', me.token)).body.data.notificationPrefs).toMatchObject({ offers: false, paymentReceipts: true });
  });
});

describe('Smile accounts', () => {
  it('can be saved by email, once Smile knows the email', async () => {
    const me = await signUp();
    const body = { label: 'Home wifi', serviceId: 'internet', provider: 'Smile', account: 'Ada@Example.com' };
    const saved = await call('POST', '/api/beneficiaries', me.token, body);
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({ accountNumber: 'ada@example.com', customerName: 'ADA SMILE' });
    expect((await call('POST', '/api/beneficiaries', me.token, { ...body, account: 'not an account' })).status).toBe(400);
    expect((await call('POST', '/api/beneficiaries', me.token, { ...body, account: 'nobody@example.com' })).body.code).toBe('ACCOUNT_NOT_VERIFIED');
  });

  it('checks a meter or smart card with VTpass before saving it as a beneficiary, without a PIN', async () => {
    const me = await signUp();
    const meter = { label: 'Home meter', serviceId: 'electricity', provider: 'IKEDC', account: '45098273620' };
    expect((await call('POST', '/api/beneficiaries', me.token, meter)).body.code).toBe('METER_TYPE_REQUIRED');
    // The fake disco knows no meter starting 000.
    const bad = await call('POST', '/api/beneficiaries', me.token, { ...meter, account: '00098273620', meterType: 'prepaid' });
    expect(bad.status).toBe(422);
    expect(await BeneficiaryModel.countDocuments({ account: '00098273620' })).toBe(0);
    const good = await call('POST', '/api/beneficiaries', me.token, { ...meter, meterType: 'prepaid' });
    expect(good.status).toBe(201);
    expect(good.body.data).toMatchObject({ customerName: expect.stringContaining('OKAFOR'), meterType: 'prepaid' });

    const card = { label: 'Living room', serviceId: 'tv', provider: 'DSTV', account: '7023456789' };
    expect((await call('POST', '/api/beneficiaries', me.token, { ...card, account: '0001234567' })).status).toBe(422);
    expect((await call('POST', '/api/beneficiaries', me.token, card)).body.data).toMatchObject({ customerName: 'CHIDI OKAFOR' });
  });
});

describe('back office', () => {
  it('records a VTpass top-up once however often it is submitted', async () => {
    const token = await asAdmin();
    const body = { amount: 1_000_000, from: 'external', note: 'Opening balance', idempotencyKey: 'topup-test-0001' };
    const first = await call('POST', '/api/admin/ledger/vtpass-topups', token, body);
    const again = await call('POST', '/api/admin/ledger/vtpass-topups', token, body);
    expect(first.status).toBe(201);
    expect(first.body.data.duplicate).toBe(false);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ duplicate: true, books: first.body.data.books });
    await expectBooksBalanced();
  });

  it('audits changes, including refused ones, without storing passwords', async () => {
    const finance = await asAdmin();
    const support = await asSupport();
    const me = await signUp();
    await call('POST', `/api/admin/users/${me.userId}/status`, support, { status: 'suspended' });
    await call('POST', '/api/admin/staff', support, { name: 'Nope', email: 'nope@tasa.test', role: 'finance', password: 'a-very-long-password' });

    await vi.waitFor(async () => {
      const { items } = (await call('GET', '/api/admin/audit?limit=5', finance)).body.data;
      expect(items.find((i: { route: string }) => i.route.endsWith('/staff'))).toMatchObject({ statusCode: 403, method: 'POST' });
      const change = items.find((i: { route: string }) => i.route.endsWith('/status'));
      expect(change).toMatchObject({ statusCode: 200, details: { status: 'suspended' }, params: { id: me.userId } });
      expect(JSON.stringify(items)).not.toContain('a-very-long-password');
    });
    expect((await call('GET', '/api/admin/audit', support)).status).toBe(403);
  });

  it('keeps raw webhook bodies away from the list', async () => {
    const me = await signUp();
    await fund(me.token, 100_000);
    const support = await asSupport();
    const list = await call('GET', '/api/admin/webhooks', support);
    expect(list.body.data.items[0].rawBody).toBeUndefined();
    const { id } = list.body.data.items[0];
    expect((await call('GET', `/api/admin/webhooks/${id}`, support)).status).toBe(403);
    expect((await call('GET', `/api/admin/webhooks/${id}`, await asAdmin())).body.data.rawBody).toBeTruthy();
  });

  it('finds users by name and transactions by date', async () => {
    const me = await signUp();
    await call('PATCH', '/api/me', me.token, { fullName: 'Zainab Searchable' });
    const token = await asAdmin();
    expect((await call('GET', '/api/admin/users?search=Searchable', token)).body.data.total).toBe(1);
    await fund(me.token, 100_000);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await call('GET', `/api/admin/transactions?user=${me.userId}&from=${future}`, token)).body.data.total).toBe(0);
    expect((await call('GET', `/api/admin/transactions?user=${me.userId}&to=${future}`, token)).body.data.total).toBe(1);
  });
});

describe('profile photos', () => {
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

  async function upload(token: string, content: Buffer, type = 'image/jpeg') {
    const boundary = 'tasa-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.jpg"\r\nContent-Type: ${type}\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/avatar',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('stores under the user, typed from the bytes, and shows a public URL', async () => {
    const me = await signUp();
    const res = await upload(me.token, PNG, 'image/jpeg');
    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toMatch(new RegExp(`^https://cdn\\.tasa\\.test/avatars/${me.userId}/.+\\.png$`));
    const key = res.body.data.avatarUrl.replace('https://cdn.tasa.test/', '');
    expect(r2Objects.get(key)).toMatchObject({ contentType: 'image/png', size: PNG.length });
    expect((await call('GET', '/api/me', me.token)).body.data.avatarUrl).toBe(res.body.data.avatarUrl);
  });

  it('refuses a non-image however it is labelled, oversized files, and an empty form', async () => {
    const me = await signUp();
    const count = r2Objects.size;
    expect((await upload(me.token, Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg')).body.code).toBe('PHOTO_INVALID');
    expect((await upload(me.token, Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]))).body.code).toBe('PHOTO_TOO_LARGE');
    const none = await app.inject({ method: 'POST', url: '/api/me/avatar', headers: { authorization: `Bearer ${me.token}` } });
    expect(none.json().code).toBe('PHOTO_MISSING');
    expect(r2Objects.size).toBe(count);
    expect((await call('GET', '/api/me', me.token)).body.data.avatarUrl).toBeNull();
  });

  it('deletes the old photo on replace and remove, and on closing the account', async () => {
    const queued = async () => (await getQueue(STORAGE_QUEUE).getJobs(['waiting', 'delayed'])).map((j) => j.data.key as string);
    const keyOf = (url: string) => url.replace('https://cdn.tasa.test/', '');
    const me = await signUp();
    const first = keyOf((await upload(me.token, JPEG)).body.data.avatarUrl);
    const second = keyOf((await upload(me.token, PNG)).body.data.avatarUrl);
    expect(await queued()).toContain(first);

    expect((await call('DELETE', '/api/me', me.token, { pin: '2580' })).status).toBe(200);
    expect(await queued()).toContain(second);
    expect((await UserModel.findById(me.userId).lean())?.avatarKey).toBeUndefined();

    await r2.deleteFile(second);
    expect(r2Deleted.at(-1)).toBe(second);
  });
});

describe('access tokens', () => {
  it('rejects a token signed with another algorithm', async () => {
    const me = await signUp();
    const [, payload] = me.token.split('.');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
    expect((await call('GET', '/api/me', none)).status).toBe(401);
    const hs512 = createHmac('sha512', env.JWT_SECRET);
    const head = Buffer.from('{"alg":"HS512","typ":"JWT"}').toString('base64url');
    const forged = `${head}.${payload}.${hs512.update(`${head}.${payload}`).digest('base64url')}`;
    expect((await call('GET', '/api/me', forged)).status).toBe(401);
    expect((await call('GET', '/api/me', me.token)).status).toBe(200);
  });
});

describe('BVN review', () => {
  const submit = (token: string, bvn = '12345678901') => call('POST', '/api/me/bvn', token, { bvn });
  const review = async (id: string, body: object) => call('POST', `/api/admin/users/${id}/bvn`, await asCompliance(), body);
  const reveal = async (id: string, token: string, reason: unknown = 'Checking against NIBSS') =>
    call('POST', `/api/admin/users/${id}/bvn/reveal`, token, { reason });

  it('starts pending, showing last 4 only, and an approval can set the name, which locks', async () => {
    const me = await signUp();
    expect((await submit(me.token)).body.data.bvn).toEqual({ status: 'pending', last4: '8901', rejectionReason: null });
    expect((await submit(me.token)).body.code).toBe('BVN_LOCKED');

    const queue = await call('GET', '/api/admin/users?bvnStatus=pending&limit=100', await asSupport());
    expect(queue.body.data.items.map((u: { id: string }) => u.id)).toContain(me.userId);
    expect(JSON.stringify(queue.body)).not.toContain('12345678901');

    const done = await review(me.userId, { status: 'verified', fullName: 'Ada Eze' });
    expect(done.body.data.bvn.status).toBe('verified');
    expect(JSON.stringify(done.body)).not.toContain('12345678901');
    expect((await call('GET', '/api/me', me.token)).body.data.fullName).toBe('Ada Eze');
    expect((await call('PATCH', '/api/me', me.token, { fullName: 'Someone Else' })).body.code).toBe('NAME_LOCKED');
  });

  it('a rejection needs a reason, erases the BVN, tells the user, and allows a new one', async () => {
    const me = await signUp();
    await submit(me.token);
    expect((await review(me.userId, { status: 'rejected' })).status).toBe(400);
    expect((await review(me.userId, { status: 'rejected', reason: 'Name does not match' })).status).toBe(200);

    const stored = await UserModel.findById(me.userId).select('+bvnCipher').lean();
    expect(stored?.bvnCipher).toBeUndefined();
    expect((await call('GET', '/api/me', me.token)).body.data.bvn).toEqual({ status: 'rejected', last4: null, rejectionReason: 'Name does not match' });
    expect((await submit(me.token, '10987654321')).body.data.bvn).toEqual({ status: 'pending', last4: '4321', rejectionReason: null });
  });

  it('can only be decided once, and never without a pending BVN', async () => {
    const me = await signUp();
    expect((await review(me.userId, { status: 'verified' })).body.code).toBe('BVN_NOT_PENDING');
    await submit(me.token);
    const decisions = await Promise.all([review(me.userId, { status: 'verified' }), review(me.userId, { status: 'rejected', reason: 'Name does not match' })]);
    expect(decisions.map((d) => d.status).sort()).toEqual([200, 409]);
  });

  it('shows the full BVN to compliance only, with a reason, and only while pending', async () => {
    const me = await signUp();
    await submit(me.token);
    for (const token of [await asSupport(), await asAdmin(), me.token]) {
      const refused = await reveal(me.userId, token);
      expect(refused.status).toBeGreaterThanOrEqual(401);
      expect(JSON.stringify(refused.body)).not.toContain('12345678901');
    }
    expect((await review(me.userId, { status: 'verified' })).status).toBe(200);
    expect((await reveal(me.userId, await asCompliance())).body.code).toBe('BVN_NOT_PENDING');

    const other = await signUp();
    await submit(other.token);
    const token = await asCompliance();
    expect((await reveal(other.userId, token, 'x')).status).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${other.userId}/bvn/reveal`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'Checking against NIBSS' },
    });
    expect(res.json().data).toEqual({ bvn: '12345678901' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await call('GET', `/api/admin/users/${other.userId}`, token)).body.data.bvn.last4).toBe('8901');
  });

  it('records every reveal once, without the number, and support cannot decide any more', async () => {
    const me = await signUp();
    await submit(me.token);
    const before = await AdminAuditModel.countDocuments({ 'params.id': me.userId, route: REVEAL_ROUTE, statusCode: 200 });
    await reveal(me.userId, await asCompliance());
    await vi.waitFor(async () => {
      const rows = await AdminAuditModel.find({ 'params.id': me.userId, route: REVEAL_ROUTE, statusCode: 200 }).lean();
      expect(rows).toHaveLength(before + 1);
      expect(rows[0]).toMatchObject({ role: 'compliance', details: { reason: 'Checking against NIBSS' } });
      expect(JSON.stringify(rows)).not.toContain('12345678901');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await AdminAuditModel.countDocuments({ 'params.id': me.userId, route: REVEAL_ROUTE, statusCode: 200 })).toBe(1);
    expect((await call('POST', `/api/admin/users/${me.userId}/bvn`, await asSupport(), { status: 'verified' })).status).toBe(403);
    expect((await call('POST', `/api/admin/users/${me.userId}/bvn`, await asAdmin(), { status: 'verified' })).status).toBe(403);
  });

  it('shows nothing if the access cannot be logged', async () => {
    const me = await signUp();
    await submit(me.token);
    const failing = vi.spyOn(AdminAuditModel, 'create').mockRejectedValueOnce(new Error('audit down') as never);
    const res = await reveal(me.userId, await asCompliance());
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('12345678901');
    failing.mockRestore();
  });

  it('users cannot review their own', async () => {
    const me = await signUp();
    await submit(me.token);
    expect((await call('POST', `/api/admin/users/${me.userId}/bvn`, me.token, { status: 'verified' })).status).toBeGreaterThanOrEqual(401);
  });

  it('bvn_on_file promos wait for verification', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    const { promo } = await createPromo({ code: 'BVNONLY1', valueType: 'fixed', value: 10_000, minSpend: 100_000, budget: 1_000_000, audience: 'bvn_on_file' });
    await submit(me.token);
    expect((await electricityQuote(me.token, 500_000, { couponCode: promo.code })).body.code).toBe('COUPON_AUDIENCE');
    await review(me.userId, { status: 'verified' });
    expect((await electricityQuote(me.token, 500_000, { couponCode: promo.code })).body.data.discount).toBe(10_000);
  });

  it('counts the queue on the overview', async () => {
    const me = await signUp();
    await submit(me.token);
    const { attention } = (await call('GET', '/api/admin/reports/overview', await asAdmin())).body.data;
    expect(attention.pendingBvn).toBeGreaterThanOrEqual(1);
  });
});

describe('points', () => {
  beforeAll(() => registerPoints());

  const summary = async (token: string) => (await call('GET', '/api/points', token)).body.data;
  const redeem = (token: string, points: number, idempotencyKey: string) => call('POST', '/api/points/redeem', token, { points, idempotencyKey });
  const earned = (token: string, points: number) => vi.waitFor(async () => expect((await summary(token)).balance).toBe(points));
  /** What's on the balances must always equal the sum of the entries. */
  async function expectPointsConsistent(userId: string) {
    const [row] = await PointsEntryModel.aggregate<{ total: number }>([{ $match: { user: new mongoose.Types.ObjectId(userId) } }, { $group: { _id: null, total: { $sum: '$points' } } }]);
    const account = await PointsBalanceModel.findOne({ user: userId });
    expect(account?.balance ?? 0).toBe(row?.total ?? 0);
  }

  it("shows staff every user's points, and one user's history", async () => {
    const me = await signUp('points_person');
    await fund(me.token, 3_000_000);
    expect((await pay(me.token, (await electricityQuote(me.token, 2_000_000)).body.data.id)).status).toBe(201);
    await earned(me.token, 200);

    const admin = await asSupport();
    const found = (await call('GET', '/api/admin/points/balances?search=points_person', admin)).body.data;
    expect(found.items).toEqual([
      expect.objectContaining({ userId: me.userId, username: 'points_person', balance: 200, lifetimeEarned: 200, value: 2_000, lastActivityAt: expect.any(String) }),
    ]);
    const top = (await call('GET', '/api/admin/points/balances?sort=earned&limit=5', admin)).body.data;
    expect(top.items.map((r: { lifetimeEarned: number }) => r.lifetimeEarned)).toEqual([...top.items.map((r: { lifetimeEarned: number }) => r.lifetimeEarned)].sort((a, b) => b - a));

    const mine = (await call('GET', `/api/admin/users/${me.userId}/points`, admin)).body.data;
    expect(mine).toMatchObject({ balance: 200, lifetimeEarned: 200, value: 2_000 });
    expect(mine.history.items[0]).toMatchObject({ type: 'earn', points: 200, transaction: expect.objectContaining({ kind: 'bill' }) });
  });

  it('earns on what was paid, converts to wallet cash, and the books balance', async () => {
    const me = await signUp();
    await fund(me.token, 3_000_000);
    expect((await summary(me.token)).balance).toBe(0); // funding earns nothing
    const quote = await electricityQuote(me.token, 2_000_000);
    expect((await pay(me.token, quote.body.data.id)).status).toBe(201);
    await earned(me.token, 200); // ₦20,000 at 1 per ₦100
    expect((await summary(me.token)).value).toBe(2_000);

    const before = await balance(me.token);
    const done = await redeem(me.token, 150, 'redeem-one-0001');
    expect(done.status).toBe(201);
    expect(done.body.data.summary.balance).toBe(50);
    expect(done.body.data.transaction).toMatchObject({ kind: 'points_redemption', direction: 'credit', amount: 1_500, status: 'success' });
    expect(await balance(me.token)).toBe(before + 1_500);
    expect(await LedgerService.balance(Accounts.points)).toBeGreaterThanOrEqual(1_500);
    await expectPointsConsistent(me.userId);
    await expectBooksBalanced();
  });

  it('a retry with the same key converts once, even at the same moment', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    await earned(me.token, 100);
    const before = await balance(me.token);
    const results = await Promise.all([redeem(me.token, 100, 'same-key-00001'), redeem(me.token, 100, 'same-key-00001'), redeem(me.token, 100, 'same-key-00001')]);
    const references = results.filter((r) => r.status === 201).map((r) => r.body.data.transaction.reference);
    expect(new Set(references).size).toBe(1);
    expect(await balance(me.token)).toBe(before + 1_000);
    expect((await summary(me.token)).balance).toBe(0);
    await expectPointsConsistent(me.userId);
    await expectBooksBalanced();
  });

  it('two conversions cannot spend the same points', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    await earned(me.token, 100);
    const results = await Promise.all([redeem(me.token, 100, 'race-key-00001'), redeem(me.token, 100, 'race-key-00002')]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await summary(me.token)).balance).toBe(0);
    await expectPointsConsistent(me.userId);
    await expectBooksBalanced();
  });

  it('refuses below the minimum, over the balance, and for a suspended account', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    await earned(me.token, 100);
    expect((await redeem(me.token, 99, 'low-key-000001')).body.code).toBe('POINTS_BELOW_MINIMUM');
    expect((await redeem(me.token, 101, 'high-key-00001')).body.code).toBe('POINTS_INSUFFICIENT');
    await call('POST', `/api/admin/users/${me.userId}/status`, await asSupport(), { status: 'suspended' });
    expect((await redeem(me.token, 100, 'susp-key-00001')).status).toBe(403);
    expect((await summary(me.token)).balance).toBe(100);
  });

  it('never earns on a failed bill, or twice for one transaction', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    vt.pay = () => ({ json: { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } } });
    const failed = await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    await PointsService.earn(failed.body.data.id);
    expect((await summary(me.token)).balance).toBe(0);

    vt.pay = (b) => delivered(b);
    const paid = await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    await earned(me.token, 100);
    await Promise.all([PointsService.earn(paid.body.data.id), PointsService.earn(paid.body.data.id)]);
    expect((await summary(me.token)).balance).toBe(100);
    await expectPointsConsistent(me.userId);
  });

  it('discounts earn nothing, and looping transfers always loses money', () => {
    const rates = { billPointsPer100Naira: 1, transferPoints: 1 };
    expect(pointsFor({ kind: 'bill', amount: 1_000_000, discount: 400_000 }, rates)).toBe(60);
    expect(pointsFor({ kind: 'bill', amount: 500_000, discount: 500_000 }, rates)).toBe(0);
    expect(pointsFor({ kind: 'bill', amount: 5_000, discount: 0 }, rates)).toBe(0);
    expect(pointsFor({ kind: 'funding', amount: 9_000_000, discount: 0 }, rates)).toBe(0);
    expect(pointsFor({ kind: 'transfer_in', amount: 9_000_000, discount: 0 }, rates)).toBe(0);
    expect(pointsFor({ kind: 'transfer_out', amount: 100_000_000, discount: 0 }, rates)).toBe(1);
  });

  it('quotes show what will be earned, matching what is awarded', async () => {
    const me = await signUp();
    await fund(me.token, 3_000_000);
    const bill = await electricityQuote(me.token, 2_000_000);
    expect(bill.body.data.pointsToEarn).toBe(200);
    await pay(me.token, bill.body.data.id);
    await earned(me.token, 200);

    const other = await signUp('quote_points_to');
    const transfer = await call('POST', '/api/quotes', me.token, { kind: 'transfer', recipient: { type: 'username', value: 'quote_points_to' }, amount: 100_000 });
    expect(transfer.body.data.pointsToEarn).toBe(1);
    expect(other.userId).toBeTruthy();
    expect((await call('POST', '/api/quotes', me.token, { kind: 'funding', amount: 100_000 })).body.data.pointsToEarn).toBe(0);
    const coupon = await call('POST', '/api/quotes', me.token, { kind: 'coupon', title: 'No points', amount: 100_000, quantity: 1 });
    expect(coupon.body.data.pointsToEarn).toBe(0);

    const { promo } = await createPromo({ code: `PTS${Date.now()}`.slice(0, 20), valueType: 'fixed', value: 100_000, minSpend: 100_000, budget: 1_000_000, listed: false });
    const discounted = await electricityQuote(me.token, 500_000, { couponCode: promo.code });
    expect(discounted.body.data.discount).toBe(100_000);
    expect(discounted.body.data.pointsToEarn).toBe(40); // on ₦4,000 paid, not ₦5,000

    const finance = await asAdmin();
    await call('PATCH', '/api/admin/points', finance, { active: false });
    expect((await electricityQuote(me.token, 2_000_000)).body.data.pointsToEarn).toBe(0);
    await call('PATCH', '/api/admin/points', finance, { active: true });
  });

  it('the sender earns on a transfer, and the receiver does not', async () => {
    const [sender, receiver] = [await signUp('points_from'), await signUp('points_to')];
    await fund(sender.token, 1_000_000);
    const quote = await call('POST', '/api/quotes', sender.token, { kind: 'transfer', recipient: { type: 'username', value: 'points_to' }, amount: 100_000 });
    await call('POST', '/api/transfers', sender.token, { quoteId: quote.body.data.id, pin: '2580' });
    await earned(sender.token, 1);
    expect((await summary(receiver.token)).balance).toBe(0);
  });

  it('finance sets the rates, conversions show as a cost, and closing forfeits points', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    await earned(me.token, 100);
    const finance = await asAdmin();
    expect((await call('PATCH', '/api/admin/points', await asSupport(), { pointValue: 20 })).status).toBe(403);
    const updated = await call('PATCH', '/api/admin/points', finance, { pointValue: 20 });
    expect(updated.body.data.settings.pointValue).toBe(20);
    expect(updated.body.data.outstanding.points).toBeGreaterThanOrEqual(100);
    expect((await summary(me.token)).value).toBe(2_000);
    await call('PATCH', '/api/admin/points', finance, { pointValue: 10 });

    const costBefore = (await call('GET', '/api/admin/reports/pnl', finance)).body.data.costs.points.total;
    await redeem(me.token, 100, 'pnl-key-000001');
    expect((await call('GET', '/api/admin/reports/pnl', finance)).body.data.costs.points.total).toBe(costBefore + 1_000);

    await pay(me.token, (await electricityQuote(me.token, 500_000)).body.data.id);
    await earned(me.token, 50);
    await PointsService.forfeitAll(me.userId);
    expect((await summary(me.token)).balance).toBe(0);
    await expectPointsConsistent(me.userId);
    await expectBooksBalanced();
  });
});

describe('saving a beneficiary at checkout', () => {
  beforeAll(() => registerBeneficiaries());

  const buy = async (token: string, label?: string, amount = 500_000) => {
    const quote = await electricityQuote(token, amount);
    return call('POST', '/api/bills/purchases', token, { quoteId: quote.body.data.id, pin: '2580', ...(label && { saveBeneficiary: { label } }) });
  };
  const saved = async (token: string) => (await call('GET', '/api/beneficiaries', token)).body.data as { id: string; label: string; meterType: string }[];

  it('saves once the bill succeeds, with what was bought, and links the payment', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    const bought = await buy(me.token, 'Home meter');
    expect(bought.status).toBe(201);
    await vi.waitFor(async () => expect(await saved(me.token)).toHaveLength(1));
    expect((await saved(me.token))[0]).toMatchObject({ label: 'Home meter', serviceId: 'electricity', provider: 'IKEDC', accountNumber: '45098273614', meterType: 'prepaid' });
    await vi.waitFor(async () => {
      const tx = await call('GET', `/api/transactions/${bought.body.data.reference}`, me.token);
      expect(tx.body.data.beneficiaryId).toBe((await saved(me.token))[0]!.id);
    });
  });

  it('keeps the plan, so auto-pay can buy it later', async () => {
    const me = await signUp();
    await fund(me.token, 3_000_000);
    const quote = await call('POST', '/api/quotes', me.token, { kind: 'bill', serviceId: 'tv', provider: 'DStv', account: '1212121212', planCode: 'dstv-padi' });
    await call('POST', '/api/bills/purchases', me.token, { quoteId: quote.body.data.id, pin: '2580', saveBeneficiary: { label: 'Family TV' } });
    await vi.waitFor(async () => expect((await saved(me.token))[0]).toMatchObject({ planCode: 'dstv-padi' }));
  });

  it('waits for a pending bill, and saves when it succeeds', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    vt.pay = () => ({ json: { code: '099', response_description: 'TRANSACTION IS PROCESSING' } });
    const pending = await buy(me.token, 'Slow meter');
    expect(pending.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await saved(me.token)).toHaveLength(0);

    const tx = await TransactionModel.findOne({ reference: pending.body.data.reference });
    const requestId = tx!.providerData!.requestId!;
    vt.requery.set(requestId, delivered({ request_id: requestId, amount: 5000 }).json);
    await BillsService.requery(tx!.id, 0);
    await vi.waitFor(async () => expect((await saved(me.token)).map((b) => b.label)).toEqual(['Slow meter']));
    vt.pay = (b) => delivered(b);
  });

  it('saves nothing when the bill fails', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    vt.pay = () => ({ json: { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } } });
    const failed = await buy(me.token, 'Bad meter');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(failed.body.data.status).toBe('failed');
    expect(await saved(me.token)).toHaveLength(0);
    await BeneficiariesService.saveFromBill(failed.body.data.id);
    vt.pay = (b) => delivered(b);
  });

  it('a repeat save links the existing one, and never gets in the way of paying', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await buy(me.token, 'First name');
    await vi.waitFor(async () => expect(await saved(me.token)).toHaveLength(1));
    const again = await buy(me.token, 'Second name');
    expect(again.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await saved(me.token)).map((b) => b.label)).toEqual(['First name']);
  });

  it('checks the label, and buying again has what it needs', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    const quote = await electricityQuote(me.token, 500_000);
    expect((await call('POST', '/api/bills/purchases', me.token, { quoteId: quote.body.data.id, pin: '2580', saveBeneficiary: { label: 'x' } })).status).toBe(400);
    const bought = await pay(me.token, quote.body.data.id);
    expect(bought.body.data.bill).toMatchObject({ provider: 'IKEDC', account: '45098273614', meterType: 'prepaid', planCode: null });
  });
});

describe('promo banners', () => {
  const banners = async (token: string) => ((await call('GET', '/api/promotions', token)).body.data as { code: string }[]).map((p) => p.code);

  it('only lists promos this user can use', async () => {
    const stamp = String(Date.now()).slice(-6);
    const first = `FIRST${stamp}`;
    const verified = `VERIFY${stamp}`;
    const open = `OPEN${stamp}`;
    await createPromo({ code: first, valueType: 'fixed', value: 10_000, minSpend: 100_000, budget: 1_000_000, audience: 'first_bill' });
    await createPromo({ code: verified, valueType: 'fixed', value: 10_000, minSpend: 100_000, budget: 1_000_000, audience: 'bvn_on_file' });
    await createPromo({ code: open, valueType: 'fixed', value: 10_000, minSpend: 100_000, budget: 1_000_000 });

    const me = await signUp();
    expect(await banners(me.token)).toEqual(expect.arrayContaining([first, open]));
    expect(await banners(me.token)).not.toContain(verified);

    await fund(me.token, 2_000_000);
    expect(await banners(me.token)).toContain(first); // funding isn't a bill
    await pay(me.token, (await electricityQuote(me.token, 500_000, { autoApply: false })).body.data.id);
    expect(await banners(me.token)).not.toContain(first);
    expect(await banners(me.token)).toContain(open);

    await call('POST', '/api/me/bvn', me.token, { bvn: '12345678901' });
    await call('POST', `/api/admin/users/${me.userId}/bvn`, await asCompliance(), { status: 'verified' });
    expect(await banners(me.token)).toContain(verified);
  });

  it('a failed bill still counts as a first bill', async () => {
    const stamp = String(Date.now()).slice(-6);
    const code = `FAILFIRST${stamp}`;
    await createPromo({ code, valueType: 'fixed', value: 10_000, minSpend: 100_000, budget: 1_000_000, audience: 'first_bill' });
    const me = await signUp();
    await fund(me.token, 2_000_000);
    vt.pay = () => ({ json: { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } } });
    await pay(me.token, (await electricityQuote(me.token, 500_000, { autoApply: false })).body.data.id);
    vt.pay = (b) => delivered(b);
    expect(await banners(me.token)).toContain(code);
  });
});

describe('recurring frequency', () => {
  const create = (token: string, frequency: string, account: string) =>
    call('POST', '/api/recurring', token, {
      label: 'Home',
      serviceId: 'electricity',
      provider: 'IKEDC',
      account,
      amount: 500_000,
      frequency,
      startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      pin: '2580',
    });

  it('takes every period, and refuses others', async () => {
    const me = await signUp();
    const periods = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    for (const [i, frequency] of periods.entries()) {
      const res = await create(me.token, frequency, `4509827361${i}`);
      expect(res.status).toBe(201);
      expect(res.body.data.frequency).toBe(frequency);
    }
    expect((await create(me.token, 'hourly', '45098273619')).status).toBe(400);
  });

  it('can start today, and pays at the next run; yesterday is refused', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    const lagosDay = (offsetDays: number) => new Date(Date.now() + 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
    const start = (startDate: string, account: string) =>
      call('POST', '/api/recurring', me.token, { label: 'Home', serviceId: 'electricity', provider: 'IKEDC', account, amount: 500_000, frequency: 'monthly', startDate, pin: '2580' });

    expect((await start(lagosDay(-1), '45098273630')).body.code).toBe('START_IN_PAST');
    const today = await start(lagosDay(0), '45098273631');
    expect(today.status).toBe(201);
    await RecurringBillModel.updateOne({ _id: today.body.data.id }, { nextRunAt: new Date(Date.now() - 1000) }); // past 07:00, whatever the time now
    await RecurringService.runDue();
    expect(vtCalls('/api/pay')).toHaveLength(1);
    expect((await RecurringBillModel.findById(today.body.data.id))!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    await expectBooksBalanced();
  });

  describe('editing', () => {
    const edit = (token: string, id: string, body: object) => call('PATCH', `/api/recurring/${id}`, token, { pin: '2580', ...body });
    const future = (days: number) => new Date(Date.now() + 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

    it('changes the amount, period, date and name, and later runs follow them', async () => {
      const me = await signUp();
      const { id } = (await create(me.token, 'monthly', '45098273640')).body.data;
      const res = await edit(me.token, id, { label: 'New name', amount: 700_000, frequency: 'weekly', nextDate: future(10) });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ label: 'New name', amount: 700_000, frequency: 'weekly', accountNumber: '45098273640' });
      expect(res.body.data.nextDate.slice(0, 10)).toBe(future(10));
      expect((await call('GET', '/api/recurring', me.token)).body.data).toHaveLength(1);
    });

    it("is set up and changed without a PIN, but not by a suspended account", async () => {
      const me = await signUp();
      const startDate = new Date(Date.now() + 3_600_000 + 2 * 86_400_000).toISOString().slice(0, 10);
      const made = await call('POST', '/api/recurring', me.token, {
        label: 'Home', serviceId: 'electricity', provider: 'IKEDC', account: '45098273641', amount: 500_000, frequency: 'monthly', startDate,
      });
      expect(made.status).toBe(201);
      const id = made.body.data.id;
      expect((await call('PATCH', `/api/recurring/${id}`, me.token, { amount: 700_000 })).status).toBe(200);
      expect((await RecurringBillModel.findById(id))!.amount).toBe(700_000);

      await call('POST', `/api/admin/users/${me.userId}/status`, await asSupport(), { status: 'suspended' });
      expect((await call('PATCH', `/api/recurring/${id}`, me.token, { amount: 900_000 })).status).toBeGreaterThanOrEqual(400);
      expect((await RecurringBillModel.findById(id))!.amount).toBe(700_000);
    });

    it('prices a new amount or plan, and refuses what could not be bought', async () => {
      const me = await signUp();
      const { id } = (await create(me.token, 'monthly', '45098273642')).body.data;
      expect((await edit(me.token, id, { amount: 10_000 })).body.code).toBe('AMOUNT_TOO_LOW');
      expect((await RecurringBillModel.findById(id))!.amount).toBe(500_000);

      vt.plans.dstv = [
        { variation_code: 'dstv-padi', name: 'DStv Padi', variation_amount: '4400.00' },
        { variation_code: 'dstv-yanga', name: 'DStv Yanga', variation_amount: '6000.00' },
      ];
      await redis.flushdb();
      const tv = await call('POST', '/api/recurring', me.token, { label: 'TV', serviceId: 'tv', provider: 'DStv', account: '1212121212', planCode: 'dstv-padi', frequency: 'monthly', startDate: future(2), pin: '2580' });
      const changed = await edit(me.token, tv.body.data.id, { planCode: 'dstv-yanga' });
      expect(changed.body.data).toMatchObject({ planCode: 'dstv-yanga', amount: 600_000 });
      expect((await edit(me.token, tv.body.data.id, { planCode: 'gone-plan' })).body.code).toBe('PLAN_UNAVAILABLE');
    });

    it('refuses a past date, the account cannot change, and others cannot touch it', async () => {
      const [me, other] = [await signUp(), await signUp()];
      const { id } = (await create(me.token, 'monthly', '45098273643')).body.data;
      expect((await edit(me.token, id, { nextDate: future(-2) })).body.code).toBe('START_IN_PAST');
      await edit(me.token, id, { account: '99999999999', provider: 'EKEDC', serviceId: 'tv', active: false, label: 'Still mine' });
      expect(await RecurringBillModel.findById(id)).toMatchObject({ account: '45098273643', provider: 'IKEDC', serviceId: 'electricity', active: true });
      expect((await edit(other.token, id, { label: 'Stolen' })).status).toBe(404);
    });

    it('a new date sets the day later runs land on', async () => {
      const me = await signUp();
      const { id } = (await create(me.token, 'monthly', '45098273644')).body.data;
      await edit(me.token, id, { nextDate: future(5) });
      const saved = await RecurringBillModel.findById(id);
      expect(saved!.anchorDay).toBe(Number(future(5).slice(8)));
    });
  });

  it('a daily bill missed for days charges once, not once per missed day', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    const { id } = (await create(me.token, 'daily', '45098273620')).body.data;
    await RecurringBillModel.updateOne({ _id: id }, { nextRunAt: new Date(Date.now() - 5 * 86_400_000) });
    await RecurringService.runDue();
    await RecurringService.runDue();
    expect(vtCalls('/api/pay')).toHaveLength(1);
    const next = (await RecurringBillModel.findById(id))!.nextRunAt;
    expect(next.getTime()).toBeGreaterThan(Date.now());
    await expectBooksBalanced();
  });
});

describe('optional PIN on bills', () => {
  const setBillPin = (token: string, enabled: boolean, pin = '2580') => call('POST', '/api/me/pin/bills', token, { enabled, pin });
  const noPin = (token: string, quoteId: string) => call('POST', '/api/bills/purchases', token, { quoteId });

  it('needs the PIN unless the user turned it off with their PIN', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    expect((await call('GET', '/api/me', me.token)).body.data.billPinEnabled).toBe(true);
    const quote = await electricityQuote(me.token, 500_000);
    expect((await noPin(me.token, quote.body.data.id)).body.code).toBe('PIN_REQUIRED');

    expect((await setBillPin(me.token, false, '1357')).body.code).toBe('PIN_INCORRECT');
    expect((await call('POST', '/api/me/pin/bills', me.token, { enabled: false })).status).toBe(400);
    expect((await call('GET', '/api/me', me.token)).body.data.billPinEnabled).toBe(true);

    expect((await setBillPin(me.token, false)).body.data).toEqual({ billPinEnabled: false });
    expect((await noPin(me.token, quote.body.data.id)).status).toBe(201);
    expect(vtCalls('/api/pay')).toHaveLength(1);
    await expectBooksBalanced();

    await setBillPin(me.token, true);
    const next = await electricityQuote(me.token, 500_000);
    expect((await noPin(me.token, next.body.data.id)).body.code).toBe('PIN_REQUIRED');
  });

  it('a wrong PIN still fails when one is sent', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await setBillPin(me.token, false);
    const quote = await electricityQuote(me.token, 500_000);
    expect((await call('POST', '/api/bills/purchases', me.token, { quoteId: quote.body.data.id, pin: '1357' })).body.code).toBe('PIN_INCORRECT');
  });

  it('every other debit keeps the PIN', async () => {
    const [me] = [await signUp('pin_off_from'), await signUp('pin_off_to')];
    await fund(me!.token, 3_000_000);
    await setBillPin(me!.token, false);
    const transfer = await call('POST', '/api/quotes', me!.token, { kind: 'transfer', recipient: { type: 'username', value: 'pin_off_to' }, amount: 100_000 });
    expect((await call('POST', '/api/transfers', me!.token, { quoteId: transfer.body.data.id })).status).toBe(400);
    const gift = await call('POST', '/api/quotes', me!.token, { kind: 'gift', recipient: { type: 'username', value: 'pin_off_to' }, amount: 100_000 });
    expect((await call('POST', '/api/gifts', me!.token, { quoteId: gift.body.data.id })).status).toBe(400);
    expect(await balance(me!.token)).toBe(3_000_000);
  });

  it('a new sign-in turns it back on, so a stolen number can\'t pay without the PIN', async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await setBillPin(me.token, false);
    await redis.del(`otp:cooldown:login:phone:+234${me.phone.slice(1)}`);
    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: me.phone });
    const signedIn = await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: me.phone, code: otp.body.data.code });
    expect(signedIn.body.data.user.billPinEnabled).toBe(true);
    const thief = signedIn.body.data.accessToken as string;
    const quote = await electricityQuote(thief, 500_000);
    expect((await noPin(thief, quote.body.data.id)).body.code).toBe('PIN_REQUIRED');
    expect((await setBillPin(thief, false, '1357')).body.code).toBe('PIN_INCORRECT');
  });

  it("a suspended account can't pay, PIN or not", async () => {
    const me = await signUp();
    await fund(me.token, 2_000_000);
    await setBillPin(me.token, false);
    const quote = await electricityQuote(me.token, 500_000);
    await call('POST', `/api/admin/users/${me.userId}/status`, await asSupport(), { status: 'suspended' });
    expect((await noPin(me.token, quote.body.data.id)).status).toBe(403);
    expect(vtCalls('/api/pay')).toHaveLength(0);
  });
});

describe('gift history', () => {
  async function sendGift(from: { token: string }, to: string, amount = 500_000) {
    const quote = await call('POST', '/api/quotes', from.token, { kind: 'gift', recipient: { type: 'username', value: to }, amount, serviceId: 'electricity', message: 'For you' });
    return call('POST', '/api/gifts', from.token, { quoteId: quote.body.data.id, pin: '2580' });
  }
  const history = async (token: string, direction: string) => (await call('GET', `/api/gifts/history?direction=${direction}`, token)).body.data;

  it('shows what was spent, and a fully spent gift stays listed as used up', async () => {
    const [sender, me] = [await signUp('hist_from_a'), await signUp('hist_to_a')];
    await fund(sender.token, 2_000_000);
    await fund(me.token, 500_000);
    await sendGift(sender, 'hist_to_a');

    expect((await history(me.token, 'received')).items[0]).toMatchObject({ type: 'balance', amount: 500_000, used: 0, left: 500_000, state: 'active', services: ['electricity'], spentOn: [] });

    const quote = await electricityQuote(me.token, 500_000);
    expect(quote.body.data.discount).toBe(500_000);
    await pay(me.token, quote.body.data.id);

    const { items } = await history(me.token, 'received');
    expect(items[0]).toMatchObject({ used: 500_000, left: 0, state: 'used_up' });
    expect(items[0].spentOn).toHaveLength(1);
    expect(items[0].spentOn[0]).toMatchObject({ amount: 500_000, serviceId: 'electricity', provider: 'IKEDC' });
    expect((await call('GET', '/api/gifts/inbox', me.token)).body.data.items).toHaveLength(0);

    const sent = await history(sender.token, 'sent');
    expect(sent.items[0]).toMatchObject({ type: 'balance', used: 500_000, state: 'used_up', amount: 500_000 });
  });

  it('marks expired gifts, with nothing left to spend', async () => {
    const [sender, me] = [await signUp('hist_from_b'), await signUp('hist_to_b')];
    await fund(sender.token, 2_000_000);
    const sent = await sendGift(sender, 'hist_to_b');
    await CouponModel.updateOne({ _id: sent.body.data.coupon.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await history(me.token, 'received')).items[0]).toMatchObject({ state: 'expired', left: 0, used: 0 });
  });

  it('includes bills paid as gifts, both ways, and keeps sent failures to the sender', async () => {
    const [sender, me] = [await signUp('hist_from_c'), await signUp('hist_to_c')];
    await fund(sender.token, 3_000_000);
    const quote = await electricityQuote(sender.token, 500_000, { giftTo: { type: 'username', value: 'hist_to_c' }, giftMessage: 'Light up' });
    await pay(sender.token, quote.body.data.id);
    expect((await history(me.token, 'received')).items[0]).toMatchObject({ type: 'bill', state: 'delivered', message: 'Light up', provider: 'IKEDC' });
    expect((await history(sender.token, 'sent')).items[0]).toMatchObject({ type: 'bill', state: 'delivered' });

    vt.pay = () => ({ json: { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } } });
    const failed = await electricityQuote(sender.token, 500_000, { giftTo: { type: 'username', value: 'hist_to_c' } });
    await pay(sender.token, failed.body.data.id);
    vt.pay = (b) => delivered(b);
    expect((await history(sender.token, 'sent')).items[0]).toMatchObject({ state: 'failed' });
    expect((await history(me.token, 'received')).items).toHaveLength(1);
  });

  it("only shows a user's own gifts, and pages", async () => {
    const [sender, me, stranger] = [await signUp('hist_from_d'), await signUp('hist_to_d'), await signUp('hist_stranger')];
    await fund(sender.token, 3_000_000);
    await sendGift(sender, 'hist_to_d', 100_000);
    await sendGift(sender, 'hist_to_d', 200_000);
    expect((await history(stranger.token, 'received')).items).toEqual([]);
    expect((await history(stranger.token, 'sent')).items).toEqual([]);
    const page = (await call('GET', '/api/gifts/history?limit=1&page=2', me.token)).body.data;
    expect(page).toMatchObject({ total: 2, page: 2 });
    expect(page.items).toHaveLength(1);
    expect((await call('GET', '/api/gifts/history?direction=everyone', me.token)).status).toBe(400);
  });
});

describe('coupon balances for people who claimed one', () => {
  it("lists only coupons the user made, and shows what's left on one they used", async () => {
    const [maker, user] = [await signUp('coupon_maker_x'), await signUp('coupon_user_x')];
    await fund(maker.token, 3_000_000);
    await fund(user.token, 1_000_000);
    const quote = await call('POST', '/api/quotes', maker.token, { kind: 'coupon', title: 'Christmas lights', amount: 100_000, quantity: 5 });
    const { coupon } = (await call('POST', '/api/coupons', maker.token, { quoteId: quote.body.data.id, pin: '2580' })).body.data;

    const gift = await call('POST', '/api/quotes', maker.token, { kind: 'gift', recipient: { type: 'username', value: 'coupon_user_x' }, amount: 100_000 });
    await call('POST', '/api/gifts', maker.token, { quoteId: gift.body.data.id, pin: '2580' });
    const mine = (await call('GET', '/api/coupons', maker.token)).body.data.items as { code: string; kind: string }[];
    expect(mine.map((c) => c.code)).toEqual([coupon.code]);

    const bill = await electricityQuote(user.token, 50_000 + 500_000, { couponCode: coupon.code });
    expect(bill.body.data.discount).toBe(100_000);
    await pay(user.token, bill.body.data.id);
    expect((await call('GET', '/api/coupons/code/' + coupon.code, maker.token)).body.data).toMatchObject({ quantity: 5, redeemed: 1, remaining: 4 });
    expect((await call('GET', '/api/coupons/balances', user.token)).body.data.filter((c: { kind: string }) => c.kind === 'coupon')).toEqual([]);

    const partial = await signUp('coupon_user_y');
    await fund(partial.token, 1_000_000);
    await CouponClaimModel.create({ coupon: coupon.id, user: partial.userId, allowance: 100_000, used: 50_000, uses: 1 });
    await CouponModel.updateOne({ _id: coupon.id }, { $inc: { claimed: 1 } });
    const balances = (await call('GET', '/api/coupons/balances', partial.token)).body.data;
    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({ code: coupon.code, title: 'Christmas lights', myBalance: { allowance: 100_000, used: 50_000, left: 50_000 } });
  });
});

describe('event tickets', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    title: 'Lagos Jazz Night',
    phone: '08031112222',
    venue: 'Muri Okunola Park',
    startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    refundDays: 0,
    tiers: [{ name: 'Regular', price: 500_000, limit: 2 }],
    ...over,
  });
  const optIn = { organisation: 'Afro Nights', bankCode: '035', accountNumber: '9876543210', acceptTerms: SELLER_TERMS_VERSION, pin: '2580' };
  const seller = async (username?: string) => {
    const user = await signUp(username);
    expect((await call('POST', '/api/me/nin', user.token, { nin: '12345678901' })).status).toBe(200);
    expect((await call('POST', '/api/seller', user.token, optIn)).status).toBe(200);
    // Review has its own tests below; everything else starts from an approved organiser.
    await SellerModel.updateOne({ user: user.userId }, { verification: { status: 'approved', idType: 'nin_slip', photoKey: 'x', photoType: 'image/png', idKey: 'x', idMimeType: 'image/png', submittedAt: new Date() } });
    return user;
  };
  const create = async (token: string, over?: Record<string, unknown>) => {
    const res = await call('POST', '/api/events', token, event(over));
    expect(res.status).toBe(201);
    return res.body.data;
  };
  const quote = (token: string, e: { id: string; tiers: { id: string }[] }, quantity = 1) =>
    call('POST', '/api/quotes', token, { kind: 'ticket', eventId: e.id, tierId: e.tiers[0]!.id, quantity });
  const guests = (quantity: number) => Array.from({ length: quantity }, (_, i) => `Guest ${i + 1}`);
  const buy = async (token: string, e: { id: string; tiers: { id: string }[] }, quantity = 1) => {
    const q = await quote(token, e, quantity);
    expect(q.status).toBe(201);
    const res = await call('POST', '/api/tickets/purchases', token, { quoteId: q.body.data.id, pin: '2580', holders: guests(quantity) });
    return { q: q.body.data, res, tickets: res.body.data?.tickets };
  };
  const wallet = async (token: string) => (await call('GET', '/api/seller', token)).body.data.wallet;
  const withdraw = (token: string, amount: number, key = `key-${Math.random()}`) =>
    call('POST', '/api/seller/withdrawals', token, { amount, pin: '2580', idempotencyKey: key });

  it('needs a BVN or NIN to opt in, and an opt-in to create events', async () => {
    const user = await signUp();
    expect((await call('POST', '/api/seller', user.token, optIn)).body.code).toBe('ID_REQUIRED');
    expect((await call('POST', '/api/events', user.token, event())).body.code).toBe('NOT_A_SELLER');
    await call('POST', '/api/me/bvn', user.token, { bvn: '12345678901' });
    // The organisation, a bank account the bank recognises, the current terms and the PIN, all at once.
    // No PIN needed: setting up a seller profile moves no money.
    for (const missing of ['organisation', 'bankCode', 'accountNumber', 'acceptTerms'] as const) {
      const { [missing]: _gone, ...rest } = optIn;
      expect((await call('POST', '/api/seller', user.token, rest)).status).toBe(400);
    }
    expect((await call('POST', '/api/seller', user.token, { ...optIn, acceptTerms: '2020-01-01' })).status).toBe(400);
    expect((await call('POST', '/api/seller', user.token, { ...optIn, accountNumber: '0000000000' })).body.code).toBe('ACCOUNT_NOT_FOUND');
    expect((await call('GET', '/api/seller', user.token)).body.data.optedIn).toBe(false);
    expect((await call('POST', '/api/seller', user.token, optIn)).body.data).toMatchObject({
      optedIn: true,
      hasId: true,
      organisation: 'Afro Nights',
      termsAccepted: true,
      logoUrl: null,
      bankAccount: { bankCode: '035', accountNumber: '9876543210', accountName: 'WEMA TEST USER' },
      verification: { status: 'unsubmitted' },
      suspension: { active: false },
    });
    // Opted in isn't enough: compliance has to see who they are first.
    expect((await call('POST', '/api/events', user.token, event())).body.code).toBe('SELLER_NOT_VERIFIED');
    const me = await call('GET', '/api/me', user.token);
    expect(JSON.stringify(me.body)).not.toContain('Cipher');
  });

  it('keeps what a ticket covers on the ticket, and a seller bank account behind the PIN', async () => {
    const organiser = await seller();
    const e = await create(organiser.token, { tiers: [{ name: 'VIP', price: 500_000, covers: 'Free drinks and popcorn' }] });
    expect(e.tiers[0].covers).toBe('Free drinks and popcorn');
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    const { tickets } = await buy(buyer.token, e);
    expect(tickets[0].covers).toBe('Free drinks and popcorn');

    expect((await call('GET', '/api/seller/banks', organiser.token)).body.data).toEqual([{ code: '035', name: 'Wema Test Bank' }]);
    const bank = { bankCode: '035', accountNumber: '9876543210' };
    expect((await call('POST', '/api/seller/bank-account/verify', organiser.token, bank)).body.data.accountName).toBe('WEMA TEST USER');
    expect((await call('POST', '/api/seller/bank-account/verify', organiser.token, { ...bank, accountNumber: '0000000000' })).body.code).toBe('ACCOUNT_NOT_FOUND');
    expect((await call('POST', '/api/seller/bank-account/verify', organiser.token, { ...bank, bankCode: '999' })).body.code).toBe('BANK_UNSUPPORTED');
    // Saving where sales go takes no PIN; withdrawing there does.
    expect((await call('PUT', '/api/seller/bank-account', organiser.token, bank)).status).toBe(200);
    const saved = await call('PUT', '/api/seller/bank-account', organiser.token, { ...bank, accountName: 'Someone Else', pin: '2580' });
    expect(saved.body.data.bankAccount).toMatchObject({ bankName: 'Wema Test Bank', accountName: 'WEMA TEST USER' });
    expect((await call('PUT', '/api/seller/bank-account', buyer.token, { ...bank, pin: '2580' })).body.code).toBe('NOT_A_SELLER');
  });

  it('needs a number to call, takes an email, and shows the organisation instead of the creator', async () => {
    const organiser = await seller('real_person');
    const { phone: _phone, ...noPhone } = event();
    expect((await call('POST', '/api/events', organiser.token, noPhone)).status).toBe(400);
    expect((await call('POST', '/api/events', organiser.token, event({ email: 'not-an-email' }))).status).toBe(400);
    const plain = await create(organiser.token);
    expect(plain).toMatchObject({ organiser: { name: 'Afro Nights', events: 1, rating: null, ratings: 0 }, phone: '08031112222', email: null });
    expect(JSON.stringify(plain)).not.toContain('real_person');
    const second = await create(organiser.token, { phone: '+2348031112222', email: 'Hello@AfroNights.ng' });
    expect((await call('GET', `/api/events/${second.id}`, organiser.token)).body.data).toMatchObject({
      organiser: { name: 'Afro Nights', events: 2 },
      phone: '08031112222',
      email: 'hello@afronights.ng',
    });

    // A rename shows everywhere at once.
    expect((await call('PATCH', '/api/seller', organiser.token, { organisation: 'Afro Nights Live' })).body.data.organisation).toBe('Afro Nights Live');
    expect((await call('GET', `/api/events/${plain.id}`, organiser.token)).body.data.organiser.name).toBe('Afro Nights Live');
  });

  it('asks sellers from before organisations to name one before their next event', async () => {
    const organiser = await seller();
    await SellerModel.updateOne({ user: organiser.userId }, { $unset: { organisation: 1 } });
    expect((await call('GET', '/api/seller', organiser.token)).body.data.organisation).toBeNull();
    expect((await call('POST', '/api/events', organiser.token, event())).body.code).toBe('ORGANISATION_REQUIRED');
    await call('PATCH', '/api/seller', organiser.token, { organisation: 'Late Starters' });
    expect((await create(organiser.token)).organiser.name).toBe('Late Starters');
  });

  it('asks sellers on older terms to accept the current ones before their next event', async () => {
    const organiser = await seller();
    await SellerModel.updateOne({ user: organiser.userId }, { termsVersion: '2020-01-01' });
    expect((await call('GET', '/api/seller', organiser.token)).body.data).toMatchObject({ termsAccepted: false, termsVersion: SELLER_TERMS_VERSION });
    expect((await call('POST', '/api/events', organiser.token, event())).body.code).toBe('TERMS_REQUIRED');
    expect((await call('PATCH', '/api/seller', organiser.token, {})).status).toBe(400);
    expect((await call('PATCH', '/api/seller', organiser.token, { acceptTerms: SELLER_TERMS_VERSION })).body.data.termsAccepted).toBe(true);
    expect((await call('POST', '/api/events', organiser.token, event())).status).toBe(201);
  });

  it('takes an organisation logo from sellers only, and shows it on their events', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = (token: string, body: Buffer) =>
      app.inject({
        method: 'POST',
        url: '/api/seller/logo',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=x' },
        payload: Buffer.concat([
          Buffer.from('--x\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n'),
          body,
          Buffer.from('\r\n--x--\r\n'),
        ]),
      });
    expect(JSON.parse((await upload((await signUp()).token, png)).body).code).toBe('NOT_A_SELLER');
    expect(JSON.parse((await upload(organiser.token, Buffer.from('<html>'))).body).code).toBe('PHOTO_INVALID');
    const ok = JSON.parse((await upload(organiser.token, png)).body);
    expect(ok.data.logoUrl).toMatch(/^https:\/\/cdn\.tasa\.test\/sellers\//);
    expect((await call('GET', `/api/events/${e.id}`, organiser.token)).body.data.organiser.logoUrl).toBe(ok.data.logoUrl);
  });

  it('lets only people who were scanned in rate an event, once each, towards the organiser', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const later = await create(organiser.token);
    const [a, b] = [await signUp(), await signUp()];
    for (const u of [a, b]) await fund(u.token, 1_000_000);
    const { tickets: [ta] } = await buy(a.token, e);
    const { tickets: [tb] } = await buy(b.token, e);
    const rate = (token: string, stars: number) => call('PUT', `/api/events/${e.id}/rating`, token, { stars });

    expect((await rate(a.token, 5)).body.code).toBe('RATING_NOT_ALLOWED');
    expect((await call('GET', `/api/tickets/${ta.id}`, a.token)).body.data).toMatchObject({ canRate: false, rating: null });
    await call('POST', `/api/events/${e.id}/scan`, organiser.token, { code: ta.code });
    await call('POST', `/api/events/${e.id}/scan`, organiser.token, { code: tb.code });
    // Each of them is asked once, after the event, to rate it.
    const reminders = (await getQueue(TICKETS_QUEUE).getJobs(['delayed'])).filter((j) => j.name === 'rating.reminder' && j.data.eventId === e.id);
    expect(reminders.map((j) => j.data.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(Math.min(...reminders.map((j) => j.opts.delay!))).toBeGreaterThanOrEqual(2 * 60 * 60_000);
    const emitted = vi.spyOn(bus, 'emit');
    await TicketsService.remindToRate(e.id, a.userId);
    expect(emitted).toHaveBeenCalledWith('event.rateReminder', { userId: a.userId, eventId: e.id, title: e.title, organiser: expect.any(String) });
    emitted.mockClear();
    expect((await rate(a.token, 6)).status).toBe(400);
    expect((await rate(a.token, 2)).status).toBe(200);
    expect((await rate(a.token, 4)).body.data.event.organiser).toMatchObject({ rating: 4, ratings: 1 });
    expect((await rate(b.token, 5)).body.data.event.organiser).toMatchObject({ rating: 4.5, ratings: 2 });
    // Rated already: no reminder.
    await TicketsService.remindToRate(e.id, b.userId);
    expect(emitted).not.toHaveBeenCalledWith('event.rateReminder', expect.anything());
    emitted.mockRestore();
    expect((await call('GET', `/api/tickets/${ta.id}`, a.token)).body.data).toMatchObject({ canRate: true, rating: 4 });
    // The organiser's rating follows them to their other events.
    expect((await call('GET', `/api/events/${later.id}`, a.token)).body.data.organiser).toMatchObject({ events: 2, rating: 4.5, ratings: 2 });
  });

  it('quotes what a ticket costs each side from the live charge rules', async () => {
    const organiser = await seller();
    const fees = async () => (await call('GET', '/api/seller/fees?price=500000', organiser.token)).body.data;
    expect(await fees()).toEqual({ price: 500_000, serviceCharge: 5_000, buyerPays: 505_000, sellingFee: 10_000, youReceive: 490_000 });
    const admin = await asAdmin();
    const rules = (await call('GET', '/api/admin/charges', admin)).body.data as { id: string; scope: string }[];
    const rule = rules.find((r) => r.scope === 'ticket_sale')!;
    await call('PATCH', `/api/admin/charges/${rule.id}`, admin, { rateBps: 500 });
    expect(await fees()).toMatchObject({ sellingFee: 25_000, youReceive: 475_000 });
    await call('PATCH', `/api/admin/charges/${rule.id}`, admin, { rateBps: 200 });
  });

  it('needs a name on every ticket, and shows it at the door', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const buyer = await signUp('name_buyer');
    await fund(buyer.token, 2_000_000);
    const before = await balance(buyer.token);
    const q = await quote(buyer.token, e, 2);
    const purchase = (holders?: string[]) => call('POST', '/api/tickets/purchases', buyer.token, { quoteId: q.body.data.id, pin: '2580', holders });
    expect((await purchase()).status).toBe(400);
    expect((await purchase(['Ada Okafor', ' '])).status).toBe(400);
    expect((await purchase(['Ada Okafor'])).body.code).toBe('HOLDER_NAMES_REQUIRED');
    // Nothing was taken or claimed, and the same quote still works with both names.
    expect(await balance(buyer.token)).toBe(before);
    const res = await purchase(['Ada Okafor', 'Chidi Eze']);
    expect(res.status).toBe(201);
    const [first, second] = res.body.data.tickets;
    expect(first.holderName).toBe('Ada Okafor');
    expect(second.holderName).toBe('Chidi Eze');
    const scanned = await call('POST', `/api/events/${e.id}/scan`, organiser.token, { code: first.code });
    expect(scanned.body.data.ticket.holderName).toBe('Ada Okafor');
  });

  it('takes a poster from the organiser only, and only a real image', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const other = await seller();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = (token: string, bytes: Buffer) => {
      const boundary = 'tasa-poster';
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return app.inject({
        method: 'POST',
        url: `/api/events/${e.id}/image`,
        headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
    };
    expect((await upload(other.token, png)).statusCode).toBe(404);
    expect(JSON.parse((await upload(organiser.token, Buffer.from('<html>'))).body).code).toBe('PHOTO_INVALID');
    const ok = await upload(organiser.token, png);
    expect(ok.statusCode).toBe(200);
    expect((await call('GET', `/api/events/${e.id}`, organiser.token)).body.data.imageUrl).toMatch(/^https:\/\/cdn\.tasa\.test\/events\//);
  });

  it('charges the buyer and the organiser, and pays the organiser the rest', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const buyer = await signUp();
    await fund(buyer.token, 2_000_000);
    const before = await balance(buyer.token);
    const { q, res, tickets } = await buy(buyer.token, e, 2);
    expect(res.status).toBe(201);
    expect(q).toMatchObject({ amount: 1_000_000, fee: 5_000, total: 1_005_000, ticket: { quantity: 2, tierName: 'Regular' } });
    expect(tickets).toHaveLength(2);
    expect(tickets[0].code).not.toBe(tickets[1].code);
    expect(tickets[0].purchaseId).toBe(tickets[1].purchaseId);
    expect(await balance(buyer.token)).toBe(before - 1_005_000);
    // 2% of ₦5,000 = ₦100 a ticket, from the organiser.
    expect(await wallet(organiser.token)).toMatchObject({ balance: 980_000, held: 0, available: 980_000 });
    expect((await call('POST', '/api/tickets/purchases', buyer.token, { quoteId: q.id, pin: '2580', holders: guests(2) })).body.data.tickets).toHaveLength(2);
    expect(await balance(buyer.token)).toBe(before - 1_005_000);
    await expectBooksBalanced();
  });

  it('never oversells, even when the last ticket is bought twice at once', async () => {
    const organiser = await seller();
    const e = await create(organiser.token, { tiers: [{ name: 'Regular', price: 500_000, limit: 1 }] });
    const [a, b] = [await signUp(), await signUp()];
    await fund(a.token, 1_000_000);
    await fund(b.token, 1_000_000);
    const [qa, qb] = [await quote(a.token, e), await quote(b.token, e)];
    const results = await Promise.all([
      call('POST', '/api/tickets/purchases', a.token, { quoteId: qa.body.data.id, pin: '2580', holders: guests(1) }),
      call('POST', '/api/tickets/purchases', b.token, { quoteId: qb.body.data.id, pin: '2580', holders: guests(1) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await call('GET', `/api/events/${e.id}/manage`, organiser.token)).body.data).toMatchObject({ sold: 1 });
    expect((await quote(a.token, e)).body.code).toBe('SOLD_OUT');
    await expectBooksBalanced();
  });

  it('lets the organiser and Tasa stop sales, and only Tasa undo its own', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    await call('PATCH', `/api/events/${e.id}`, organiser.token, { salesPaused: true });
    expect((await quote(buyer.token, e)).body.code).toBe('SALES_PAUSED');
    await call('PATCH', `/api/events/${e.id}`, organiser.token, { salesPaused: false });
    const admin = await asAdmin();
    expect((await call('POST', `/api/admin/events/${e.id}/sales`, admin, { paused: true })).status).toBe(200);
    expect((await call('PATCH', `/api/events/${e.id}`, organiser.token, { salesPaused: false })).status).toBe(200);
    expect((await quote(buyer.token, e)).body.code).toBe('SALES_PAUSED');
    expect((await call('GET', '/api/events', buyer.token)).body.data.map((x: { id: string }) => x.id)).not.toContain(e.id);
    await call('POST', `/api/admin/events/${e.id}/sales`, admin, { paused: false });
    expect((await quote(buyer.token, e)).status).toBe(201);
  });

  it("can't raise a limit below what's sold, and an unlimited ticket has no limit", async () => {
    const organiser = await seller();
    const e = await create(organiser.token, { tiers: [{ name: 'Regular', price: 500_000, limit: 5 }] });
    const buyer = await signUp();
    await fund(buyer.token, 2_000_000);
    await buy(buyer.token, e, 2);
    expect((await call('PATCH', `/api/events/${e.id}`, organiser.token, { limits: [{ tierId: e.tiers[0].id, limit: 1 }] })).body.code).toBe('LIMIT_BELOW_SOLD');
    const open = await call('PATCH', `/api/events/${e.id}`, organiser.token, { limits: [{ tierId: e.tiers[0].id, limit: null }] });
    expect(open.body.data.tiers[0]).toMatchObject({ limit: null, remaining: null });
  });

  it('holds refundable money until the window closes, and refunds without the seller', async () => {
    const organiser = await seller();
    const e = await create(organiser.token, { refundDays: 3, tiers: [{ name: 'Regular', price: 500_000, limit: 2 }] });
    const buyer = await signUp();
    await fund(buyer.token, 2_000_000);
    const before = await balance(buyer.token);
    const { tickets } = await buy(buyer.token, e, 2);
    expect(tickets[0].canRefund).toBe(true);
    expect(await wallet(organiser.token)).toMatchObject({ balance: 980_000, held: 980_000, available: 0 });
    expect((await withdraw(organiser.token, 100)).body.code).toBe('TICKET_FUNDS_ON_HOLD');

    expect((await call('POST', `/api/tickets/${tickets[0].id}/refund`, buyer.token, {})).body.data.status).toBe('refunded');
    expect(await balance(buyer.token)).toBe(before - 1_005_000 + 500_000);
    expect(await wallet(organiser.token)).toMatchObject({ balance: 490_000, held: 490_000 });
    expect((await call('POST', `/api/tickets/${tickets[0].id}/refund`, buyer.token, {})).body.code).toBe('REFUND_CLOSED');
    expect((await call('GET', `/api/events/${e.id}/manage`, organiser.token)).body.data.sold).toBe(1);

    await TicketModel.collection.updateOne({ _id: new Types.ObjectId(tickets[1].id as string) }, { $set: { refundableUntil: new Date(Date.now() - 1000) } });
    expect(await wallet(organiser.token)).toMatchObject({ held: 0, available: 490_000 });
    expect((await call('POST', `/api/tickets/${tickets[1].id}/refund`, buyer.token, {})).body.code).toBe('REFUND_CLOSED');
    await expectBooksBalanced();
  });

  it('ends the refund window when the event starts', async () => {
    const organiser = await seller();
    const startsAt = new Date(Date.now() + 86_400_000);
    const e = await create(organiser.token, { refundDays: 7, startsAt: startsAt.toISOString() });
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    const { tickets } = await buy(buyer.token, e);
    expect(new Date(tickets[0].refundableUntil).getTime()).toBe(startsAt.getTime());
  });

  it('withdraws to the wallet only once, however it is retried or raced', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    await buy(buyer.token, e);
    const start = await balance(organiser.token);

    const first = await withdraw(organiser.token, 200_000, 'same-key-1');
    expect(first.status).toBe(201);
    expect((await withdraw(organiser.token, 200_000, 'same-key-1')).body.data.reference).toBe(first.body.data.reference);
    expect(await balance(organiser.token)).toBe(start + 200_000);

    const raced = await Promise.all([withdraw(organiser.token, 290_000), withdraw(organiser.token, 290_000)]);
    expect(raced.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await wallet(organiser.token)).toMatchObject({ balance: 0, available: 0 });
    await expectBooksBalanced();
  });

  it('lets a seller start without a bank account, and asks for one at their first bank withdrawal', async () => {
    const user = await signUp();
    await call('POST', '/api/me/nin', user.token, { nin: '12345678901' });
    const { bankCode: _b, accountNumber: _a, ...noBank } = optIn;
    expect((await call('POST', '/api/seller', user.token, { ...noBank, bankCode: '035' })).status).toBe(400);
    expect((await call('POST', '/api/seller', user.token, noBank)).body.data).toMatchObject({ optedIn: true, bankAccount: null });
    await SellerModel.updateOne({ user: user.userId }, { 'verification.status': 'approved' });
    const e = await create(user.token);
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    await buy(buyer.token, e);

    const q = (amount: number) => call('POST', '/api/quotes', user.token, { kind: 'ticket_payout', amount });
    expect((await q(100_000)).body.code).toBe('BANK_ACCOUNT_REQUIRED');
    await call('PUT', '/api/seller/bank-account', user.token, { bankCode: '035', accountNumber: '9876543210', pin: '2580' });
    // ₦4,900 in the ticket wallet; the ₦50 fee comes on top, so ₦4,850 is the most that can go.
    expect((await q(490_000)).body.code).toBe('TICKET_FUNDS_ON_HOLD');
    const quote = (await q(485_000)).body.data;
    expect(quote).toMatchObject({ amount: 485_000, fee: 5_000, total: 490_000, ticketPayout: { bankName: 'Wema Test Bank', accountName: 'WEMA TEST USER' } });
    await expectBooksBalanced();
  });

  it('pays sales out to the bank only once SaySwitch confirms, and returns what fails', async () => {
    const organiser = await seller();
    const e = await create(organiser.token, { tiers: [{ name: 'Regular', price: 500_000, limit: 10 }] });
    const buyer = await signUp();
    await fund(buyer.token, 2_000_000);
    await buy(buyer.token, e, 2); // ₦9,800 to the organiser
    await call('PUT', '/api/seller/bank-account', organiser.token, { bankCode: '035', accountNumber: '9876543210', pin: '2580' });
    const mainWallet = await balance(organiser.token);
    const pay = async (amount: number) => {
      const quote = (await call('POST', '/api/quotes', organiser.token, { kind: 'ticket_payout', amount })).body.data;
      return call('POST', '/api/seller/payouts', organiser.token, { quoteId: quote.id, pin: '2580' });
    };

    // Sent and pending: out of the ticket wallet, into nobody's hands yet.
    const first = await pay(300_000);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ kind: 'ticket_payout', status: 'pending', amount: 300_000, fee: 5_000, total: 305_000 });
    expect(calls.filter((c) => c.path === '/api/v1/bank_transfer').at(-1)!.body).toMatchObject({ amount: '3000', account_number: '9876543210', reference: first.body.data.reference });
    expect(await wallet(organiser.token)).toMatchObject({ balance: 675_000 });
    expect(await LedgerService.balance(Accounts.payoutsInFlight)).toBe(-300_000);

    // Confirmed: the money leaves our SaySwitch balance, with their fee as our cost.
    say.payouts.set(first.body.data.reference, { status: 'success', fee: '15' });
    const settled = await TicketsService.requeryPayout(first.body.data.id, 1);
    expect(settled?.status).toBe('success');
    expect(await LedgerService.balance(Accounts.payoutsInFlight)).toBe(0);
    expect(await LedgerService.balance(Accounts.providerFees('payout'))).toBe(1_500);

    // Reversed by the bank: all of it back to the ticket wallet, fee included.
    const second = await pay(200_000);
    say.payouts.set(second.body.data.reference, { status: 'reversed', fee: '15' });
    expect((await TicketsService.requeryPayout(second.body.data.id, 1))?.status).toBe('failed');
    expect(await wallet(organiser.token)).toMatchObject({ balance: 675_000 });

    // Nothing ever reaches the bill payment wallet this way.
    expect(await balance(organiser.token)).toBe(mainWallet);
    await expectBooksBalanced();
  });

  it('books the fee SaySwitch quoted when it logged the payout, even if the status check leaves it out', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    await buy(buyer.token, e);
    await call('PUT', '/api/seller/bank-account', organiser.token, { bankCode: '035', accountNumber: '9876543210', pin: '2580' });
    const sayBefore = await LedgerService.balance(Accounts.collections);
    const feesBefore = await LedgerService.balance(Accounts.providerFees('payout'));
    const quote = (await call('POST', '/api/quotes', organiser.token, { kind: 'ticket_payout', amount: 100_000 })).body.data;
    const tx = (await call('POST', '/api/seller/payouts', organiser.token, { quoteId: quote.id, pin: '2580' })).body.data;
    // The fake logs it with fee "15", like SaySwitch's create reply; the status check then omits it.
    say.payouts.set(tx.reference, { status: 'success' } as { status: string; fee: string });
    expect((await TicketsService.requeryPayout(tx.id, 1))?.status).toBe('success');
    expect(await LedgerService.balance(Accounts.providerFees('payout'))).toBe(feesBefore + 1_500);
    // Taken from our wallet on top of what was sent: the organiser's bank gets all ₦1,000.
    expect(await LedgerService.balance(Accounts.collections)).toBe(sayBefore - 100_000 - 1_500);
    await expectBooksBalanced();
  });

  it("counts a payout SaySwitch confirmed without a fee, then books the fee once when it says", async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    await buy(buyer.token, e);
    await call('PUT', '/api/seller/bank-account', organiser.token, { bankCode: '035', accountNumber: '9876543210', pin: '2580' });
    say.payout = (b) => {
      say.payouts.set(String(b.reference), { status: 'pending' } as { status: string; fee: string });
      return { json: { success: true, data: { ...b, status: 'pending' } } };
    };
    const quote = (await call('POST', '/api/quotes', organiser.token, { kind: 'ticket_payout', amount: 100_000 })).body.data;
    const tx = (await call('POST', '/api/seller/payouts', organiser.token, { quoteId: quote.id, pin: '2580' })).body.data;
    say.payout = sayPayoutDefault;
    const feesBefore = await LedgerService.balance(Accounts.providerFees('payout'));

    say.payouts.set(tx.reference, { status: 'success' } as { status: string; fee: string });
    expect((await TicketsService.requeryPayout(tx.id, 1))?.status).toBe('success');
    expect(await LedgerService.balance(Accounts.providerFees('payout'))).toBe(feesBefore);
    const pnl = async () => (await call('GET', '/api/admin/reports/pnl', await asAdmin())).body.data;
    expect((await pnl()).caveats.payoutsWithoutFee).toBeGreaterThanOrEqual(1);

    // The signed webhook says later: booked once, however often it arrives.
    await TicketsService.onPayoutUpdate(tx.reference, 2_500);
    await TicketsService.onPayoutUpdate(tx.reference, 2_500);
    expect(await LedgerService.balance(Accounts.providerFees('payout'))).toBe(feesBefore + 2_500);
    await expectBooksBalanced();
  });

  it('never returns a payout SaySwitch might still be sending', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    await buy(buyer.token, e);
    await call('PUT', '/api/seller/bank-account', organiser.token, { bankCode: '035', accountNumber: '9876543210', pin: '2580' });
    say.payout = () => ({ status: 504, json: { success: false, message: 'Gateway timeout' } });
    try {
      const quote = (await call('POST', '/api/quotes', organiser.token, { kind: 'ticket_payout', amount: 100_000 })).body.data;
      const res = await call('POST', '/api/seller/payouts', organiser.token, { quoteId: quote.id, pin: '2580' });
      expect(res.body.data.status).toBe('pending');
      // A retry of the same quote is the same payout, not a second one.
      expect((await call('POST', '/api/seller/payouts', organiser.token, { quoteId: quote.id, pin: '2580' })).body.data.reference).toBe(res.body.data.reference);
      expect(calls.filter((c) => c.path === '/api/v1/bank_transfer' && c.body.reference === res.body.data.reference)).toHaveLength(1);

      // "Not found" right after sending could be a request still in flight: keep waiting.
      expect((await TicketsService.requeryPayout(res.body.data.id, 1))?.status).toBe('pending');
      // Long after, it never arrived: safe to give back.
      await TransactionModel.updateOne({ _id: res.body.data.id }, { 'providerData.sentAt': new Date(Date.now() - 60 * 60_000) });
      expect((await TicketsService.requeryPayout(res.body.data.id, 2))?.status).toBe('failed');
      expect(await wallet(organiser.token)).toMatchObject({ balance: 490_000 });

      // Still unknown after every requery: flagged for staff, money held.
      const quote2 = (await call('POST', '/api/quotes', organiser.token, { kind: 'ticket_payout', amount: 100_000 })).body.data;
      const stuck = (await call('POST', '/api/seller/payouts', organiser.token, { quoteId: quote2.id, pin: '2580' })).body.data;
      say.payouts.set(stuck.reference, { status: 'processing', fee: '15' });
      const flagged = await TicketsService.requeryPayout(stuck.id, PAYOUT_REQUERY_DELAYS_MS.length);
      expect(flagged).toMatchObject({ status: 'pending', needsReview: true });
    } finally {
      say.payout = sayPayoutDefault;
    }
    await expectBooksBalanced();
  });

  const multipart = (url: string, token: string, bytes: Buffer, filename = 'f.bin') => {
    const boundary = 'tasa-upload';
    return app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  };

  it("shows an organiser's page: about, contacts, track record and what's coming up", async () => {
    const organiser = await seller();
    expect((await call('PATCH', '/api/seller', organiser.token, { website: 'javascript:alert(1)' })).status).toBe(400);
    expect((await call('PATCH', '/api/seller', organiser.token, { email: 'nope' })).status).toBe(400);
    const saved = await call('PATCH', '/api/seller', organiser.token, {
      about: 'Live jazz in Lagos since 2019.',
      phone: '+2348031112222',
      email: 'Hello@AfroNights.ng',
      website: 'https://afronights.ng',
      instagram: '@afro.nights',
    });
    expect(saved.body.data).toMatchObject({
      about: 'Live jazz in Lagos since 2019.',
      contact: { phone: '08031112222', email: 'hello@afronights.ng', website: 'https://afronights.ng', instagram: 'afro.nights' },
    });
    const e = await create(organiser.token);
    const buyer = await signUp();
    const page = (await call('GET', `/api/organisers/${e.organiser.id}`, buyer.token)).body.data;
    expect(page).toMatchObject({ id: e.organiser.id, name: 'Afro Nights', verified: true, mine: false, events: 1, about: 'Live jazz in Lagos since 2019.', contact: { instagram: 'afro.nights' } });
    expect((await call('GET', `/api/organisers/${e.organiser.id}`, organiser.token)).body.data.mine).toBe(true);
    await SellerModel.updateOne({ user: organiser.userId }, { 'verification.status': 'pending' });
    expect((await call('GET', `/api/events/${e.id}`, buyer.token)).body.data.organiser.verified).toBe(false);
    expect(page.upcoming.map((x: { id: string }) => x.id)).toEqual([e.id]);
    expect(JSON.stringify(page)).not.toMatch(/bankAccount|accountNumber|withdrawals|bvn|ninLast4|Cipher|termsVersion/);

    // A blank clears a field.
    expect((await call('PATCH', '/api/seller', organiser.token, { instagram: '' })).body.data.contact.instagram).toBeNull();
    expect((await call('GET', `/api/organisers/${new Types.ObjectId().toString()}`, buyer.token)).status).toBe(404);
  });

  it('keeps a gallery of photos and videos, checked by their bytes, for the organiser to manage', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
    const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(64)]);
    const add = (token: string, bytes: Buffer) => multipart(`/api/events/${e.id}/gallery`, token, bytes);

    expect((await add((await seller()).token, png)).statusCode).toBe(404);
    expect(JSON.parse((await add(organiser.token, Buffer.from('<html>'))).body).code).toBe('MEDIA_INVALID');
    await add(organiser.token, png);
    await add(organiser.token, mp4);
    const last = JSON.parse((await add(organiser.token, mov)).body).data;
    expect(last.gallery.map((m: { kind: string }) => m.kind)).toEqual(['image', 'video', 'video']);
    expect(last.gallery[2].url).toMatch(/\/events\/.+\/gallery\/.+\.mov$/);

    const buyer = await signUp();
    expect((await call('GET', `/api/events/${e.id}`, buyer.token)).body.data.gallery).toHaveLength(3);
    expect((await call('DELETE', `/api/events/${e.id}/gallery/${last.gallery[0].id}`, buyer.token)).status).toBe(404);
    const after = await call('DELETE', `/api/events/${e.id}/gallery/${last.gallery[0].id}`, organiser.token);
    expect(after.body.data.gallery.map((m: { kind: string }) => m.kind)).toEqual(['video', 'video']);
  });

  it("shows the organiser who bought what, and nobody else", async () => {
    const organiser = await seller();
    const e = await create(organiser.token, { tiers: [{ name: 'Regular', price: 500_000, limit: 10 }] });
    const ada = await signUp('ada_buys');
    await fund(ada.token, 2_000_000);
    const { tickets } = await buy(ada.token, e, 2);
    await call('POST', `/api/events/${e.id}/scan`, organiser.token, { code: tickets[0].code });
    expect((await call('GET', `/api/events/${e.id}/sales`, ada.token)).status).toBe(404);
    const sales = (await call('GET', `/api/events/${e.id}/sales`, organiser.token)).body.data;
    expect(sales.purchases).toEqual([
      expect.objectContaining({ buyer: expect.stringContaining('ada_buys'), tierName: 'Regular', quantity: 2, amount: 1_000_000, checkedIn: 1, refunded: 0 }),
    ]);
    expect(sales.byTier).toEqual([expect.objectContaining({ name: 'Regular', sold: 2, limit: 10, gross: 1_000_000 })]);
  });

  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
  /** POST /api/seller/verification, as the app sends it. */
  const submitVerification = (token: string, parts: { idType?: string; photo?: Buffer; id?: Buffer }) => {
    const boundary = 'tasa-kyc';
    const chunks: Buffer[] = [];
    if (parts.idType) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="idType"\r\n\r\n${parts.idType}\r\n`));
    for (const name of ['photo', 'id'] as const) {
      const bytes = parts[name];
      if (bytes) {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from('\r\n'));
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return app.inject({
      method: 'POST',
      url: '/api/seller/verification',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(chunks),
    });
  };
  const unverifiedSeller = async () => {
    const user = await seller();
    await SellerModel.updateOne({ user: user.userId }, { $unset: { verification: 1 } });
    return user;
  };

  it('takes a photo and ID from a new organiser, keeps them encrypted, and lets compliance decide', async () => {
    const organiser = await unverifiedSeller();
    const emitted = vi.spyOn(bus, 'emit');
    const json = (res: { body: string }) => JSON.parse(res.body);
    expect(json(await submitVerification(organiser.token, { idType: 'passport', photo: PNG }))).toMatchObject({ code: 'ID_PHOTO_MISSING' });
    expect(json(await submitVerification(organiser.token, { idType: 'passport', photo: Buffer.from('<html>'), id: PNG }))).toMatchObject({ code: 'PHOTO_INVALID' });
    expect(json(await submitVerification(organiser.token, { idType: 'library_card', photo: PNG, id: JPEG })).statusCode).toBe(400);
    const sent = await submitVerification(organiser.token, { idType: 'passport', photo: PNG, id: JPEG });
    expect(sent.statusCode).toBe(201);
    expect(json(sent).data).toMatchObject({ status: 'pending', idType: 'passport' });
    expect((await call('POST', '/api/events', organiser.token, event())).body.code).toBe('SELLER_NOT_VERIFIED');

    // Stored under kyc/, and what's stored is not the image.
    const stored = [...r2Objects.entries()].filter(([key]) => key.startsWith(`kyc/${organiser.userId}/`));
    expect(stored).toHaveLength(2);
    for (const [, object] of stored) {
      expect(object.contentType).toBe('application/octet-stream');
      expect(object.body!.includes(PNG.subarray(1, 8))).toBe(false);
    }

    // Compliance sees the queue and the documents; every view is logged first.
    const kyc = await asCompliance();
    expect((await call('GET', '/api/admin/sellers?verification=pending', kyc)).body.data.items.map((x: { id: string }) => x.id)).toContain(organiser.userId);
    const detail = (await call('GET', `/api/admin/sellers/${organiser.userId}`, kyc)).body.data;
    expect(detail).toMatchObject({ organisation: 'Afro Nights', user: { avatarUrl: null }, verification: { status: 'pending', idType: 'passport', hasDocuments: true } });
    expect(JSON.stringify(detail)).not.toMatch(/photoKey|idKey|kyc\//);
    const photo = await app.inject({ method: 'POST', url: `/api/admin/sellers/${organiser.userId}/documents/photo`, headers: { authorization: `Bearer ${kyc}` } });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect(photo.headers['cache-control']).toBe('no-store');
    expect(photo.rawPayload.equals(PNG)).toBe(true);
    expect(await AdminAuditModel.exists({ route: '/api/admin/sellers/:id/documents/:kind', 'params.id': organiser.userId, 'params.kind': 'photo' })).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: `/api/admin/sellers/${organiser.userId}/documents/id`, headers: { authorization: `Bearer ${await asSupport()}` } })).statusCode).toBe(403);

    // Rejected with a reason they're told; they send again; approved, they can sell.
    expect((await call('POST', `/api/admin/sellers/${organiser.userId}/review`, kyc, { status: 'rejected', reason: 'x' })).status).toBe(400);
    const rejected = await call('POST', `/api/admin/sellers/${organiser.userId}/review`, kyc, { status: 'rejected', reason: 'The ID photo is blurry' });
    expect(rejected.body.data.verification).toMatchObject({ status: 'rejected', reason: 'The ID photo is blurry' });
    expect((await call('POST', `/api/admin/sellers/${organiser.userId}/review`, kyc, { status: 'approved' })).body.code).toBe('SELLER_NOT_PENDING');
    expect(emitted).toHaveBeenCalledWith('seller.reviewed', { userId: organiser.userId, status: 'rejected', reason: 'The ID photo is blurry' });
    expect((await call('GET', '/api/seller', organiser.token)).body.data.verification).toMatchObject({ status: 'rejected', reason: 'The ID photo is blurry' });

    await submitVerification(organiser.token, { idType: 'drivers_licence', photo: JPEG, id: PNG });
    // The rejected pair is kept, so compliance can set the new one beside it.
    for (const [key] of stored) {
      expect(r2Deleted.includes(key) || (await getQueue(STORAGE_QUEUE).getJobs(['waiting', 'delayed'])).some((j) => j.data.key === key)).toBe(false);
    }
    const resent = (await call('GET', `/api/admin/sellers/${organiser.userId}`, kyc)).body.data.verification;
    expect(resent).toMatchObject({ status: 'pending', idType: 'drivers_licence' });
    expect(resent.history).toEqual([
      {
        id: expect.any(String),
        status: 'rejected',
        idType: 'passport',
        submittedAt: expect.any(String),
        reviewedAt: expect.any(String),
        reviewedBy: expect.any(String),
        reason: 'The ID photo is blurry',
        hasDocuments: true,
      },
    ]);
    const documentUrl = (kind: string, submission?: string) =>
      `/api/admin/sellers/${organiser.userId}/documents/${kind}${submission ? `?submission=${submission}` : ''}`;
    const view = (kind: string, submission?: string) => app.inject({ method: 'POST', url: documentUrl(kind, submission), headers: { authorization: `Bearer ${kyc}` } });
    const oldId = await view('id', resent.history[0].id);
    expect(oldId.headers['content-type']).toBe('image/jpeg');
    expect(oldId.rawPayload.equals(JPEG)).toBe(true);
    expect((await view('id')).rawPayload.equals(PNG)).toBe(true);
    expect(await AdminAuditModel.exists({ route: '/api/admin/sellers/:id/documents/:kind', 'params.kind': 'id', 'params.submission': resent.history[0].id })).toBeTruthy();
    expect((await view('id', new Types.ObjectId().toString())).statusCode).toBe(404);
    await call('POST', `/api/admin/sellers/${organiser.userId}/review`, kyc, { status: 'approved' });
    expect(emitted).toHaveBeenCalledWith('seller.reviewed', expect.objectContaining({ userId: organiser.userId, status: 'approved' }));
    expect((await call('POST', '/api/events', organiser.token, event())).status).toBe(201);
    // Approved is settled: nobody swaps their ID afterwards.
    expect(json(await submitVerification(organiser.token, { idType: 'passport', photo: PNG, id: JPEG })).code).toBe('SELLER_ALREADY_VERIFIED');
    emitted.mockRestore();
  });

  it('suspends an organiser: pauses their events and withdrawals, keeps tickets and refunds working, and undoes exactly that', async () => {
    const organiser = await seller();
    const onSale = await create(organiser.token, { refundDays: 3 });
    const pausedByThem = await create(organiser.token);
    await call('PATCH', `/api/events/${pausedByThem.id}`, organiser.token, { salesPaused: true });
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    const { tickets } = await buy(buyer.token, onSale);
    const support = await asSupport();
    const emitted = vi.spyOn(bus, 'emit');

    expect((await call('POST', `/api/admin/sellers/${organiser.userId}/suspension`, support, { suspended: true })).status).toBe(400);
    const suspended = await call('POST', `/api/admin/sellers/${organiser.userId}/suspension`, support, { suspended: true, reason: 'Reports of a fake event' });
    expect(suspended.body.data.suspension).toMatchObject({ active: true, reason: 'Reports of a fake event' });
    expect((await call('GET', `/api/events/${onSale.id}`, buyer.token)).body.data.sales).toBe('paused');
    expect((await quote(buyer.token, onSale)).body.code).toBe('SALES_PAUSED');
    expect((await call('POST', '/api/events', organiser.token, event())).body.code).toBe('SELLER_SUSPENDED');
    expect((await withdraw(organiser.token, 10_000)).body.code).toBe('SELLER_SUSPENDED');
    expect((await call('POST', '/api/quotes', organiser.token, { kind: 'ticket_payout', amount: 10_000 })).body.code).toBe('SELLER_SUSPENDED');
    // Tasa can't quietly undo it one event at a time.
    expect((await call('POST', `/api/admin/events/${onSale.id}/sales`, support, { paused: false })).body.code).toBe('SELLER_SUSPENDED');
    // What buyers already have keeps working.
    expect((await call('POST', `/api/tickets/${tickets[0].id}/refund`, buyer.token)).status).toBe(200);
    expect(emitted).toHaveBeenCalledWith('seller.suspension', { userId: organiser.userId, suspended: true, reason: 'Reports of a fake event' });
    emitted.mockRestore();

    await call('POST', `/api/admin/sellers/${organiser.userId}/suspension`, support, { suspended: false, reason: 'Checked: the event is real' });
    expect((await call('GET', `/api/events/${onSale.id}`, buyer.token)).body.data.sales).toBe('on_sale');
    const history = (await call('GET', `/api/admin/sellers/${organiser.userId}`, support)).body.data.suspension.history;
    expect(history).toEqual([
      { action: 'lifted', reason: 'Checked: the event is real', by: 'Support', at: expect.any(String) },
      { action: 'suspended', reason: 'Reports of a fake event', by: 'Support', at: expect.any(String) },
    ]);
    // Their own pause is theirs: lifting the suspension leaves it alone.
    expect((await call('GET', `/api/events/${pausedByThem.id}`, buyer.token)).body.data.sales).toBe('paused');
    expect((await call('POST', '/api/events', organiser.token, event())).status).toBe(201);
    await expectBooksBalanced();
  });

  it('scans a ticket once, and only for the event and people it belongs to', async () => {
    const organiser = await seller();
    const e = await create(organiser.token);
    const other = await create(organiser.token);
    const buyer = await signUp();
    const stranger = await seller();
    const door = await signUp('door_staff');
    await fund(buyer.token, 1_000_000);
    const { tickets } = await buy(buyer.token, e);
    const scan = (token: string, id = e.id as string) => call('POST', `/api/events/${id}/scan`, token, { code: tickets[0].code });

    expect((await scan(stranger.token)).status).toBe(404);
    expect((await scan(door.token)).status).toBe(404);
    expect((await scan(organiser.token, other.id)).body.code).toBe('TICKET_NOT_FOR_EVENT');
    await call('POST', `/api/events/${e.id}/staff`, organiser.token, { username: '@door_staff' });
    const ok = await scan(door.token);
    expect(ok.body.data).toMatchObject({ ticket: { status: 'used', tierName: 'Regular' } });
    expect((await scan(organiser.token)).body.code).toBe('TICKET_USED');
    expect((await call('GET', `/api/events/${e.id}/manage`, organiser.token)).body.data.checkedIn).toBe(1);
    expect((await call('GET', '/api/events/mine', door.token)).body.data.staffed.map((x: { id: string }) => x.id)).toEqual([e.id]);
  });

  it('counts tickets in spending, takes refunds off, and keeps a seller from closing with money or events', async () => {
    const organiser = await seller();
    const e = await create(organiser.token, { refundDays: 2 });
    const buyer = await signUp();
    await fund(buyer.token, 2_000_000);
    const { tickets } = await buy(buyer.token, e, 2);
    await call('POST', `/api/tickets/${tickets[0].id}/refund`, buyer.token, {});
    const report = (await call('GET', '/api/insights?period=this_month', buyer.token)).body.data;
    expect(report.byCategory).toMatchObject([{ key: 'tickets', amount: 500_000 }]);
    expect(report.spent).toBe(1_005_000 - 500_000);
    expect((await call('DELETE', '/api/me', organiser.token, { pin: '2580' })).body.code).toBe('ACCOUNT_HAS_TICKET_SALES');
  });
});

describe('back office books and operations', () => {
  it('sums the balance sheet to zero, ticket wallets and payouts in flight included', async () => {
    const buyer = await signUp();
    await fund(buyer.token, 1_000_000);
    const summary = (await call('GET', '/api/admin/ledger/summary', await asAdmin())).body.data as Record<string, number>;
    expect(Object.keys(summary)).toEqual(expect.arrayContaining(['tickets:*', 'payouts:in_flight']));
    expect(Object.values(summary).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('reads a bare day in the transaction filters as the whole Lagos day', async () => {
    const user = await signUp();
    await fund(user.token, 100_000);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
    const list = async (q: string) => call('GET', `/api/admin/transactions?kind=funding&${q}`, await asAdmin());
    expect((await list(`from=${today}&to=${today}`)).body.data.total).toBeGreaterThan(0);
    expect((await list(`to=2020-01-01`)).body.data.total).toBe(0);
    expect((await list('from=not-a-date')).body.code).toBe('INVALID_DATE');
  });

  it('names people in back-office rows, lists who claimed a coupon, and marks a closed one closed', async () => {
    const owner = await signUp('coupon_owner');
    const user = await signUp('coupon_user');
    await fund(owner.token, 2_000_000);
    await fund(user.token, 1_000_000);
    const cq = await call('POST', '/api/quotes', owner.token, { kind: 'coupon', title: 'Two fivers', amount: 500_000, quantity: 2 });
    const created = await call('POST', '/api/coupons', owner.token, { quoteId: cq.body.data.id, pin: '2580' });
    const code = created.body.data.coupon.code as string;
    const q1 = await airtimeQuote(user.token, user.phone, 200_000, { couponCode: code });
    expect((await pay(user.token, q1.body.data.id)).body.data.status).toBe('success');

    const admin = await asAdmin();
    const coupon = (await call('GET', `/api/admin/coupons?code=${code}`, admin)).body.data.items[0];
    expect(coupon).toMatchObject({ ownerName: '@coupon_owner', closed: false });
    const detail = (await call('GET', `/api/admin/coupons/${coupon.id}`, admin)).body.data;
    expect(detail.claims).toEqual([expect.objectContaining({ userName: '@coupon_user', username: 'coupon_user', allowance: 500_000, used: 200_000, left: 300_000 })]);
    const closed = (await call('POST', `/api/admin/coupons/${coupon.id}/close`, await asSupport())).body.data;
    expect(closed).toMatchObject({ closed: true, status: 'active', closedAt: expect.any(String) });

    const txs = (await call('GET', `/api/admin/transactions?user=${user.userId}&kind=bill`, admin)).body.data.items;
    expect(txs[0]).toMatchObject({ userName: '@coupon_user' });
    const audit = (await call('GET', '/api/admin/audit', admin)).body.data.items;
    expect(audit.find((a: { route: string }) => a.route === '/api/admin/coupons/:id/close')).toMatchObject({ adminName: 'Support' });
    await expectBooksBalanced();
  });

  it('finds events by title, venue, organisation or exact code, for buyers and staff', async () => {
    const user = await signUp();
    await call('POST', '/api/me/nin', user.token, { nin: '12345678901' });
    await call('POST', '/api/seller', user.token, { organisation: 'Zebra Crossing Live', acceptTerms: SELLER_TERMS_VERSION, pin: '2580' });
    await SellerModel.updateOne({ user: user.userId }, { 'verification.status': 'approved' });
    const e = (
      await call('POST', '/api/events', user.token, {
        title: 'Rooftop Sessions',
        phone: '08031112222',
        venue: 'Quilox Lounge, Victoria Island',
        startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        tiers: [{ name: 'Regular', price: 500_000 }],
      })
    ).body.data;
    const buyer = await signUp();
    const found = async (q: string) => (await call('GET', `/api/events?search=${encodeURIComponent(q)}`, buyer.token)).body.data.map((x: { id: string }) => x.id);
    expect(await found('rooftop')).toContain(e.id);
    expect(await found('quilox')).toContain(e.id);
    expect(await found('zebra crossing')).toContain(e.id);
    expect(await found(e.code)).toContain(e.id);
    expect(await found('nothing like this')).not.toContain(e.id);
    const staff = (await call('GET', '/api/admin/events?search=zebra', await asSupport())).body.data.items.map((x: { id: string }) => x.id);
    expect(staff).toContain(e.id);
  });

  it('filters users by account status and pages events on the server', async () => {
    const quiet = await signUp();
    await call('POST', `/api/admin/users/${quiet.userId}/status`, await asSupport(), { status: 'suspended' });
    const suspended = (await call('GET', '/api/admin/users?status=suspended&limit=100', await asAdmin())).body.data.items;
    expect(suspended.map((u: { id: string }) => u.id)).toContain(quiet.userId);
    expect(suspended.every((u: { status: string }) => u.status === 'suspended')).toBe(true);

    const events = (await call('GET', '/api/admin/events?limit=2&page=1', await asSupport())).body.data;
    expect(events).toMatchObject({ page: 1, limit: 2, items: expect.any(Array), total: expect.any(Number) });
    expect(events.items.length).toBeLessThanOrEqual(2);
  });

  it('books the SaySwitch fee on a VTpass top-up as a cost, and says what the P&L can\'t see yet', async () => {
    const admin = await asAdmin();
    const sayBefore = await LedgerService.balance(Accounts.collections);
    const res = await call('POST', '/api/admin/ledger/vtpass-topups', admin, { amount: 1_000_000, fee: 5_000, note: 'Weekly float', idempotencyKey: `fee-${Date.now()}` });
    expect(res.status).toBe(201);
    expect(await LedgerService.balance(Accounts.collections)).toBe(sayBefore - 1_005_000);
    expect(await LedgerService.balance(Accounts.providerFees('topup'))).toBeGreaterThanOrEqual(5_000);
    const pnl = (await call('GET', '/api/admin/reports/pnl', admin)).body.data;
    expect(pnl.costs.fundingFees.bySource.topup).toBeGreaterThanOrEqual(5_000);
    expect(pnl.caveats).toMatchObject({
      fundingsWithoutFee: expect.any(Number),
      payoutsWithoutFee: expect.any(Number),
      billsWithoutCost: expect.any(Number),
      pendingBillCharges: { amount: expect.any(Number), count: expect.any(Number) },
    });
    await expectBooksBalanced();
  });

  it("shows income over the app's periods, and what each bill category brought in", async () => {
    const admin = await asAdmin();
    const before = (await call('GET', '/api/admin/reports/income', admin)).body.data;
    const user = await signUp();
    await fund(user.token, 2_000_000);
    expect((await pay(user.token, (await airtimeQuote(user.token, user.phone, 100_000)).body.data.id)).body.data.status).toBe('success');
    expect((await pay(user.token, (await electricityQuote(user.token, 500_000)).body.data.id)).body.data.status).toBe('success');

    const report = (await call('GET', '/api/admin/reports/income', admin)).body.data;
    expect(report).toMatchObject({ period: 'this_month' });
    // Monthly bars like the app: this month and the five before it, only this one in the period.
    expect(report.series).toHaveLength(6);
    expect(report.series.filter((p: { inPeriod: boolean }) => p.inPeriod)).toHaveLength(1);
    expect(report.series.at(-1)).toMatchObject({ inPeriod: true, upcoming: false });
    // The dashboard's cards follow the same period.
    const overview = (await call('GET', '/api/admin/reports/overview?period=this_month', admin)).body.data;
    expect(overview.pnl.revenue).toBe(report.income);
    // ₦20 + ₦100 in charges, plus VTpass's 1% on ₦1,000 and ₦5,000.
    expect(report.billIncome - before.billIncome).toBe(2_000 + 10_000 + 1_000 + 5_000);
    const electricity = report.byCategory.find((c: { serviceId: string }) => c.serviceId === 'electricity');
    expect(electricity).toMatchObject({ name: 'Electricity', charges: expect.any(Number), commission: expect.any(Number) });
    expect(electricity.bills).toBeGreaterThanOrEqual(1);
    // Categories with nothing yet still show, at zero; water isn't sold, so it doesn't.
    const ids = report.byCategory.map((c: { serviceId: string }) => c.serviceId);
    expect(ids).toEqual(expect.arrayContaining(['electricity', 'airtime', 'tv', 'internet', 'jamb']));
    expect(ids).not.toContain('water');
    // The bars inside the period add up to the total.
    expect(report.series.filter((p: { inPeriod: boolean }) => p.inPeriod).reduce((s: number, p: { income: number }) => s + p.income, 0)).toBe(report.income);
    expect(report.series.length).toBeGreaterThanOrEqual(1);

    const year = (await call('GET', '/api/admin/reports/income?period=this_year', admin)).body.data;
    expect(year.series).toHaveLength(12);
    expect(year.series.every((p: { inPeriod: boolean }) => p.inPeriod)).toBe(true);
    expect((await call('GET', '/api/admin/reports/income?period=forever', admin)).status).toBe(400);
  });

  it("still shows our VTpass books when VTpass doesn't answer", async () => {
    const res = await call('GET', '/api/admin/ledger/vtpass', await asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ vtpass: null, difference: null, books: expect.any(Number), vtpassError: expect.any(String) });
  });

  it('books VTpass commission on a bill resolved as delivered, from the cost staff enter', async () => {
    const user = await signUp();
    await fund(user.token, 1_000_000);
    vt.pay = () => ({ status: 504, json: { message: 'timeout' } });
    const q = await airtimeQuote(user.token, user.phone, 100_000);
    const stuck = (await pay(user.token, q.body.data.id)).body.data;
    expect(stuck.status).toBe('pending');
    expect((await call('POST', `/api/admin/transactions/${stuck.id}/resolve`, await asAdmin(), { outcome: 'delivered', cost: 100_001, note: 'Confirmed with VTpass' })).body.code).toBe('COST_TOO_HIGH');
    const resolved = await call('POST', `/api/admin/transactions/${stuck.id}/resolve`, await asAdmin(), { outcome: 'delivered', cost: 97_000, note: 'Confirmed with VTpass' });
    expect(resolved.body.data.status).toBe('success');
    expect(await LedgerService.balance(Accounts.commission('airtime'))).toBeLessThanOrEqual(-3_000);
    await expectBooksBalanced();
  });

  it('replays a webhook and answers with the event, or 404 for one that never came', async () => {
    const admin = await asAdmin();
    expect((await call('POST', `/api/admin/webhooks/${new Types.ObjectId().toString()}/replay`, admin)).status).toBe(404);
    const event = await WebhookEventModel.create({ provider: 'sayswitch', rawBody: '{"nonsense":true}', status: 'failed', signature: 'valid' });
    const replayed = await call('POST', `/api/admin/webhooks/${event.id}/replay`, admin);
    expect(replayed.status).toBe(200);
    expect(replayed.body.data).toMatchObject({ id: event.id, provider: 'sayswitch' });
    expect(replayed.body.data._id).toBeUndefined();
  });
});

describe('feature switches and maintenance', () => {
  let superToken: string | undefined;
  const asSuperAdmin = async () => {
    if (superToken) return superToken;
    await AdminModel.create({ name: 'Switchboard', email: 'switchboard@tasa.test', role: 'super_admin', passwordHash: await bcrypt.hash('correct-horse', 4) });
    superToken = (await call('POST', '/api/auth/admin/login', undefined, { email: 'switchboard@tasa.test', password: 'correct-horse' })).body.data.accessToken as string;
    return superToken;
  };
  afterEach(async () => {
    await AppSettingsModel.deleteMany({});
    ConfigService.resetCache();
  });

  it('tells the app what is on before anyone signs in', async () => {
    const res = await call('GET', '/api/config');
    expect(res.status).toBe(200);
    expect(res.body.data.maintenance).toEqual({ active: false, message: null, until: null });
    expect(Object.values(res.body.data.features).every((f) => (f as { enabled: boolean }).enabled)).toBe(true);
  });

  it('switches a feature off for new actions only, with the reason, and back on', async () => {
    const user = await signUp();
    await fund(user.token, 1_000_000);
    const friend = await signUp('switch_friend');
    const quote = (await call('POST', '/api/quotes', user.token, { kind: 'transfer', recipient: { type: 'username', value: 'switch_friend' }, amount: 10_000 })).body.data;

    expect((await call('PATCH', '/api/admin/config/features', await asCompliance(), { transfers: { enabled: false } })).status).toBe(403);
    expect((await call('PATCH', '/api/admin/config/features', await asSupport(), { nonsense: { enabled: false } })).status).toBe(400);
    const off = await call('PATCH', '/api/admin/config/features', await asSupport(), { transfers: { enabled: false, message: 'Transfers are paused while we upgrade.' } });
    expect(off.body.data.features.transfers).toEqual({ enabled: false, message: 'Transfers are paused while we upgrade.' });
    expect((await call('GET', '/api/config')).body.data.features.transfers.enabled).toBe(false);

    // New quotes, and quotes from before the switch, both stop.
    const blocked = await call('POST', '/api/quotes', user.token, { kind: 'transfer', recipient: { type: 'username', value: 'switch_friend' }, amount: 10_000 });
    expect(blocked).toMatchObject({ status: 503, body: { code: 'FEATURE_DISABLED', message: 'Transfers are paused while we upgrade.', errors: { feature: 'transfers' } } });
    expect((await call('POST', '/api/transfers', user.token, { quoteId: quote.id, pin: '2580' })).body.code).toBe('FEATURE_DISABLED');
    // Everything else carries on.
    expect((await call('GET', '/api/wallet', user.token)).status).toBe(200);

    await call('PATCH', '/api/admin/config/features', await asSupport(), { transfers: { enabled: true } });
    expect((await call('POST', '/api/transfers', user.token, { quoteId: quote.id, pin: '2580' })).status).toBe(201);
    expect(await balance(friend.token)).toBe(10_000);
    await expectBooksBalanced();
  });

  it('pauses one bill service, shows it as unavailable, and waits with recurring bills', async () => {
    const user = await signUp();
    await fund(user.token, 1_000_000);
    await call('PATCH', '/api/admin/config/features', await asSupport(), { bill_electricity: { enabled: false } });
    const services = (await call('GET', '/api/bills/services', user.token)).body.data as { id: string; available: boolean; pausedMessage: string | null }[];
    expect(services.find((x) => x.id === 'electricity')).toMatchObject({ available: false, pausedMessage: expect.stringContaining('Electricity') });
    expect(services.find((x) => x.id === 'airtime')).toMatchObject({ available: true, pausedMessage: null });
    const res = await call('POST', '/api/quotes', user.token, { kind: 'bill', serviceId: 'electricity', provider: 'IKEDC', account: '1111111111111', amount: 500_000, meterType: 'prepaid' });
    expect(res.body).toMatchObject({ code: 'FEATURE_DISABLED', errors: { feature: 'bill_electricity' } });

    // A schedule that falls due while recurring is off waits, then pays once it's back on.
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    const schedule = await call('POST', '/api/recurring', user.token, {
      label: 'Home meter', serviceId: 'airtime', provider: 'MTN', account: '08011111111', amount: 50_000, product: 'airtime', frequency: 'monthly', startDate: today, pin: '2580',
    });
    expect(schedule.status).toBe(201);
    await call('PATCH', '/api/admin/config/features', await asSupport(), { recurring: { enabled: false } });
    expect((await call('POST', '/api/recurring', user.token, { label: 'Another', serviceId: 'airtime', provider: 'MTN', account: '08011111112', amount: 50_000, frequency: 'monthly', startDate: today, pin: '2580' })).body.code).toBe('FEATURE_DISABLED');
    await RecurringBillModel.updateOne({ _id: schedule.body.data.id }, { nextRunAt: new Date(Date.now() - 1000) });
    await RecurringService.runDue();
    expect(vtCalls('/api/pay')).toHaveLength(0);
    await call('PATCH', '/api/admin/config/features', await asSupport(), { recurring: { enabled: true } });
    await RecurringService.runDue();
    expect(vtCalls('/api/pay')).toHaveLength(1);
  });

  it('takes the app offline in maintenance, but not the back office, webhooks or the config itself', async () => {
    const user = await signUp();
    expect((await call('PUT', '/api/admin/config/maintenance', await asSupport(), { active: true })).status).toBe(403);
    const until = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const on = await call('PUT', '/api/admin/config/maintenance', await asSuperAdmin(), { active: true, message: 'Upgrading our systems.', until });
    expect(on.body.data.maintenance).toEqual({ active: true, message: 'Upgrading our systems.', until });

    const blocked = await call('GET', '/api/wallet', user.token);
    expect(blocked).toMatchObject({ status: 503, body: { code: 'MAINTENANCE', message: 'Upgrading our systems.', errors: { until } } });
    expect((await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: '08039998888' })).body.code).toBe('MAINTENANCE');
    expect((await call('GET', '/api/config')).body.data.maintenance.active).toBe(true);
    expect((await call('GET', '/api/admin/config', await asSupport())).status).toBe(200);
    expect((await call('POST', '/api/webhooks/sayswitch', undefined, {})).body.code).not.toBe('MAINTENANCE');

    await call('PUT', '/api/admin/config/maintenance', await asSuperAdmin(), { active: false });
    expect((await call('GET', '/api/config')).body.data.maintenance).toEqual({ active: false, message: null, until: null });
    expect((await call('GET', '/api/wallet', user.token)).status).toBe(200);
  });
});

describe('spending insights', () => {
  const insights = async (token: string, period = 'this_month') => (await call('GET', `/api/insights?period=${period}`, token)).body.data;

  it('adds up what left the wallet, by category and service', async () => {
    const [me, friend] = [await signUp('spend_me'), await signUp('spend_friend')];
    await fund(me.token, 5_000_000);
    const before = await balance(me.token);
    await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    await pay(me.token, (await airtimeQuote(me.token, me.phone, 200_000)).body.data.id);
    const transfer = await call('POST', '/api/quotes', me.token, { kind: 'transfer', recipient: { type: 'username', value: 'spend_friend' }, amount: 300_000 });
    await call('POST', '/api/transfers', me.token, { quoteId: transfer.body.data.id, pin: '2580' });
    const gift = await call('POST', '/api/quotes', me.token, { kind: 'gift', recipient: { type: 'username', value: 'spend_friend' }, amount: 150_000 });
    await call('POST', '/api/gifts', me.token, { quoteId: gift.body.data.id, pin: '2580' });
    const paidForThem = await electricityQuote(me.token, 400_000, { giftTo: { type: 'username', value: 'spend_friend' } });
    await pay(me.token, paidForThem.body.data.id);
    const coupon = await call('POST', '/api/quotes', me.token, { kind: 'coupon', title: 'Lights', amount: 100_000, quantity: 2 });
    await call('POST', '/api/coupons', me.token, { quoteId: coupon.body.data.id, pin: '2580' });

    const report = await insights(me.token);
    // Every kobo that left the wallet, charges included, and no more.
    expect(report.spent).toBe(before - (await balance(me.token)));
    const category = (key: string) => report.byCategory.find((c: { key: string }) => c.key === key);
    // The breakdown is the things themselves; only `spent` carries the charges.
    expect(category('gifts').amount).toBe(gift.body.data.amount + paidForThem.body.data.amount);
    expect(category('gifts').count).toBe(2);
    expect(category('transfers').amount).toBe(transfer.body.data.amount);
    expect(category('coupons').amount).toBe(coupon.body.data.amount);
    expect(report.byCategory.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0)).toBeLessThan(report.spent);
    expect(report.byCategory.reduce((sum: number, c: { share: number }) => sum + c.share, 0)).toBeCloseTo(1);
    expect(report.byService[0]).toMatchObject({ key: 'electricity', count: 1 });
    expect(report.byService.map((s: { key: string }) => s.key)).toEqual(['electricity', 'airtime']);
    expect(report.byProvider[0]).toMatchObject({ key: 'IKEDC' });
    expect(report.biggest).toMatchObject({ kind: 'bill', serviceId: 'electricity' });
    expect(report.transactions).toBe(6);
    expect(report.received).toEqual({ gifts: 0, coupons: 0 });
    const earned = (await call('GET', '/api/points', me.token)).body.data;
    expect(report.points.earned).toBe(earned.lifetimeEarned);
    expect(report.points.value).toBe(earned.lifetimeEarned * earned.pointValue);
    const theirs = await insights(friend.token);
    expect(theirs.received).toEqual({ gifts: 150_000 + 400_000, coupons: 0 });
    expect(theirs.spent).toBe(0);
    expect(report.byCategory).toHaveLength(4);
  });

  it('funding and money received are not spending; failed bills and other people are left out', async () => {
    const [me, other] = [await signUp('spend_clean'), await signUp('spend_other')];
    await fund(me.token, 2_000_000);
    await fund(other.token, 2_000_000);
    const transfer = await call('POST', '/api/quotes', other.token, { kind: 'transfer', recipient: { type: 'username', value: 'spend_clean' }, amount: 100_000 });
    await call('POST', '/api/transfers', other.token, { quoteId: transfer.body.data.id, pin: '2580' });
    vt.pay = () => ({ json: { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } } });
    await pay(me.token, (await electricityQuote(me.token, 500_000)).body.data.id);
    vt.pay = (b) => delivered(b);
    const report = await insights(me.token);
    expect(report).toMatchObject({ spent: 0, transactions: 0, byCategory: [], biggest: null, changePercent: null });
  });

  it('takes refunded coupon money off, and counts discounts as saved, not spent', async () => {
    const me = await signUp('spend_refund');
    await fund(me.token, 3_000_000);
    const quote = await call('POST', '/api/quotes', me.token, { kind: 'coupon', title: 'Refund me', amount: 100_000, quantity: 5 });
    const { coupon } = (await call('POST', '/api/coupons', me.token, { quoteId: quote.body.data.id, pin: '2580' })).body.data;
    await call('POST', `/api/coupons/${coupon.id}/cancel`, me.token, {});
    expect((await insights(me.token)).spent).toBe(quote.body.data.fee);

    const { promo } = await createPromo({ code: `SAVE${Date.now()}`.slice(0, 20), valueType: 'fixed', value: 100_000, minSpend: 100_000, budget: 1_000_000, listed: false });
    const bill = await electricityQuote(me.token, 500_000, { couponCode: promo.code });
    await pay(me.token, bill.body.data.id);
    const report = await insights(me.token);
    expect(report.saved).toBe(100_000);
    expect(report.spent).toBe(quote.body.data.fee + bill.body.data.total);
    expect(report.byService).toMatchObject([{ key: 'electricity', amount: 500_000 }]);
  });

  it("counts other people's coupons as received, at full value, but not your own", async () => {
    const [owner, user] = [await signUp('spend_owner'), await signUp('spend_claimer')];
    await fund(owner.token, 2_000_000);
    await fund(user.token, 100_000);
    const quote = await call('POST', '/api/quotes', owner.token, { kind: 'coupon', title: 'Share', amount: 500_000, quantity: 2 });
    const { coupon } = (await call('POST', '/api/coupons', owner.token, { quoteId: quote.body.data.id, pin: '2580' })).body.data;
    await pay(user.token, (await airtimeQuote(user.token, user.phone, 200_000, { couponCode: coupon.code })).body.data.id);
    await pay(owner.token, (await airtimeQuote(owner.token, owner.phone, 200_000, { couponCode: coupon.code })).body.data.id);
    expect((await insights(user.token)).received).toEqual({ gifts: 0, coupons: 500_000 });
    expect((await insights(owner.token)).received).toEqual({ gifts: 0, coupons: 0 });
    expect((await insights(user.token, 'last_month')).received).toEqual({ gifts: 0, coupons: 0 });
  });

  it('filters by period, compares with the one before, and shows six months of trend', async () => {
    const me = await signUp('spend_period');
    await fund(me.token, 5_000_000);
    const old = await pay(me.token, (await electricityQuote(me.token, 1_000_000)).body.data.id);
    const recent = await pay(me.token, (await electricityQuote(me.token, 500_000)).body.data.id);
    // createdAt can't be changed through the model, so this goes straight to the collection.
    const today = lagosParts(new Date());
    const lastMonth = new Date(Date.UTC(today.y, today.m - 1, 15, 12));
    await TransactionModel.collection.updateOne({ reference: old.body.data.reference }, { $set: { createdAt: lastMonth } });

    const now = await insights(me.token, 'this_month');
    expect(now.spent).toBe(recent.body.data.total);
    expect(now.previousSpent).toBeGreaterThan(0);
    expect(now.changePercent).toBeLessThan(0);
    expect((await insights(me.token, 'all')).spent).toBe(old.body.data.total + recent.body.data.total);
    expect((await insights(me.token, 'all')).changePercent).toBeNull();
    expect(now.trend).toHaveLength(6);
    expect(now.trend.at(-1).amount).toBe(recent.body.data.total);
    expect((await call('GET', '/api/insights?period=forever', me.token)).status).toBe(400);
  });

  it('works out what recurring bills cost in a typical month', async () => {
    const me = await signUp('spend_recurring');
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const add = (frequency: string, account: string, amount: number) =>
      call('POST', '/api/recurring', me.token, { label: 'Home', serviceId: 'electricity', provider: 'IKEDC', account, amount, frequency, startDate: start, pin: '2580' });
    await add('monthly', '45098273651', 500_000);
    await add('quarterly', '45098273652', 600_000);
    expect((await insights(me.token)).recurringMonthly).toBe(700_000);
  });

  it('still answers the per-service insights route', async () => {
    const me = await signUp();
    expect((await call('GET', '/api/insights/electricity', me.token)).status).toBe(200);
  });

  it('periods start at Lagos midnight on the 1st', () => {
    const { current, previous } = periodRange('this_month', new Date('2026-11-15T12:00:00Z'));
    expect(current.from?.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(previous?.from?.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(periodRange('this_year', new Date('2026-11-15T12:00:00Z')).current.from?.toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });
});

describe('development OTP', () => {
  afterEach(() => {
    devOtp.code = null;
  });

  it('only exists when NODE_ENV is explicitly development', () => {
    expect(resolveDevOtp('development', '123456')).toBe('123456');
    for (const nodeEnv of ['production', 'test', 'staging', undefined]) expect(resolveDevOtp(nodeEnv, '123456')).toBeNull();
  });

  it('signs in with the fixed code, repeatedly, and sends nothing', async () => {
    devOtp.code = '123456';
    const sends = vi.spyOn(sms, 'send');
    const contact = { type: 'phone', value: '08039998877' };
    for (const _ of [1, 2]) {
      expect((await call('POST', '/api/auth/otp', undefined, contact)).status).toBe(200);
      expect((await call('POST', '/api/auth/otp/verify', undefined, { ...contact, code: '123456' })).status).toBe(200);
    }
    expect(sends).not.toHaveBeenCalled();
    await call('POST', '/api/auth/otp', undefined, contact);
    expect((await call('POST', '/api/auth/otp/verify', undefined, { ...contact, code: '654321' })).status).toBe(401);
    sends.mockRestore();
  });

  it('covers PIN reset and linking a contact too', async () => {
    const me = await signUp();
    devOtp.code = '123456';
    await call('POST', '/api/me/pin/reset/otp', me.token, {});
    expect((await call('POST', '/api/me/pin/reset', me.token, { code: '123456', pin: '7913' })).status).toBe(200);
    const contact = { type: 'email', value: 'dev-flow@example.com' };
    await call('POST', '/api/me/contacts/otp', me.token, contact);
    expect((await call('POST', '/api/me/contacts/verify', me.token, { ...contact, code: '123456' })).status).toBe(200);
  });

  it('is off in the real path: a guessed 123456 fails', async () => {
    const contact = { type: 'phone', value: '08039998866' };
    const otp = await call('POST', '/api/auth/otp', undefined, contact);
    if (otp.body.data.code !== '123456') {
      expect((await call('POST', '/api/auth/otp/verify', undefined, { ...contact, code: '123456' })).status).toBe(401);
    }
  });
});

describe('groups and dues', () => {
  const groupPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const withId = async (username?: string) => {
    const user = await signUp(username);
    expect((await call('POST', '/api/me/nin', user.token, { nin: '12345678901' })).status).toBe(200);
    return user;
  };
  const group = (over: Record<string, unknown> = {}) => ({
    name: 'Accounting Students’ Association',
    dues: [{ name: 'Monthly dues', kind: 'recurring', period: 'monthly', amount: 100_000 }],
    bankCode: '035',
    accountNumber: '9876543210',
    ...over,
  });
  const create = async (token: string, over?: Record<string, unknown>) => {
    const res = await call('POST', '/api/groups', token, group(over));
    expect(res.status).toBe(201);
    return res.body.data;
  };
  const join = async (token: string, g: { inviteCode: string; terms: { version: number } }, fields: Record<string, string> = {}) =>
    call('POST', '/api/groups/join', token, { code: g.inviteCode, fields, acceptTerms: g.terms.version });
  type Statement = { id: string; name: string; periods: { index: number; status: string }[] }[];
  const statement = async (token: string, groupId: string): Promise<Statement> => (await call('GET', `/api/groups/${groupId}`, token)).body.data.membership.dues;
  const pay = async (token: string, groupId: string, items: { dueId: string; periods: number[] }[]) => {
    const q = await call('POST', '/api/quotes', token, { kind: 'group_dues', groupId, items });
    if (q.status !== 201) return q;
    return call('POST', `/api/groups/${groupId}/pay`, token, { quoteId: q.body.data.id, pin: '2580' });
  };
  /** The first `periods` unpaid periods of the group's first due: owed first, then ahead. */
  const payDues = async (token: string, groupId: string, periods: number) => {
    const first = (await statement(token, groupId))[0]!;
    return pay(token, groupId, [{ dueId: first.id, periods: first.periods.filter((p) => p.status !== 'paid').slice(0, periods).map((p) => p.index) }]);
  };
  const groupBalance = async (id: string) => -(await LedgerService.balance(Accounts.group(id)));

  it('lets people join by code after accepting where the money goes, then collects dues from the day they joined', async () => {
    const owner = await signUp('grp_owner');
    expect((await call('POST', '/api/groups', owner.token, group())).body.code).toBe('ID_REQUIRED');
    await call('POST', '/api/me/nin', owner.token, { nin: '12345678901' });
    const g = await create(owner.token, { requireApproval: true, fields: [{ label: 'Matric number', required: true }] });
    expect(g).toMatchObject({ role: 'owner', payout: { accountNumber: '9876543210' }, balance: 0, fields: [{ key: 'matric_number', required: true }] });
    expect(g.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    // The owner is its first member, terms accepted, owing this period like anyone else.
    expect(g.membership).toMatchObject({ status: 'active', periodsOwed: 1, mustAcceptTerms: false });
    expect(g.members).toEqual({ active: 1, pending: 0 });
    expect((await join(owner.token, g, { matric_number: '1' })).body.code).toBe('ALREADY_MEMBER');

    // The terms say who runs it and exactly where dues are paid out to.
    const member = await signUp('grp_member');
    const preview = (await call('GET', `/api/groups/join/${g.inviteCode.toLowerCase()}`, member.token)).body.data;
    expect(preview.terms).toMatchObject({ version: 1, payout: { last4: '3210', bankName: expect.any(String), accountName: expect.any(String) } });
    expect(preview.terms.points[0]).toContain('•••• 3210');
    expect(JSON.stringify(preview)).not.toContain('9876543210');
    expect((await call('GET', '/api/groups/join/NOPE1234', member.token)).status).toBe(404);
    expect((await call('POST', '/api/groups/join', member.token, { code: g.inviteCode, acceptTerms: 2 })).body.code).toBe('GROUP_TERMS_CHANGED');
    expect((await join(member.token, g)).body.code).toBe('FIELD_REQUIRED');
    const joined = await join(member.token, g, { matric_number: '190401023' });
    expect(joined.status).toBe(201);
    expect(joined.body.data.membership).toMatchObject({ status: 'pending', fields: { matric_number: '190401023' } });
    expect((await join(member.token, g, { matric_number: '190401023' })).body.code).toBe('ALREADY_MEMBER');
    expect((await pay(member.token, g.id, [{ dueId: g.dues[0].id, periods: [0] }])).body.code).toBe('MEMBER_PENDING');

    // An executive lets them in; this month is owed at once.
    const pending = (await call('GET', `/api/groups/${g.id}/members?status=pending`, owner.token)).body.data.items;
    expect(pending).toHaveLength(1);
    expect((await call('GET', `/api/groups/${g.id}/members`, member.token)).status).toBe(403);
    expect((await call('POST', `/api/groups/${g.id}/members/${pending[0].id}/approve`, owner.token)).body.data).toMatchObject({ status: 'active', periodsOwed: 1, amountOwed: 100_000 });

    // Three months: this one and two ahead. 1% to Tasa from what the group receives.
    await fund(member.token, 1_000_000);
    const dueId = g.dues[0].id;
    const q = await call('POST', '/api/quotes', member.token, { kind: 'group_dues', groupId: g.id, items: [{ dueId, periods: [0, 1, 2] }] });
    expect(q.body.data).toMatchObject({ amount: 300_000, fee: 0, total: 300_000, groupDues: { items: [{ name: 'Monthly dues', periods: [0, 1, 2], amount: 300_000 }] } });
    const paid = await call('POST', `/api/groups/${g.id}/pay`, member.token, { quoteId: q.body.data.id, pin: '2580' });
    expect(paid.body.data).toMatchObject({ kind: 'group_dues', status: 'success', total: 300_000 });
    expect((await call('POST', `/api/groups/${g.id}/pay`, member.token, { quoteId: q.body.data.id, pin: '2580' })).body.data.id).toBe(paid.body.data.id);
    // Paid periods can't be paid again, nor ones too far ahead.
    expect((await pay(member.token, g.id, [{ dueId, periods: [1] }])).body.code).toBe('DUES_CHANGED');
    expect((await pay(member.token, g.id, [{ dueId, periods: [40] }])).body.code).toBe('DUES_CHANGED');
    expect(await balance(member.token)).toBe(700_000);
    expect(await groupBalance(g.id)).toBe(297_000);
    expect(await LedgerService.balance(Accounts.charges('group_fee'))).toBeLessThanOrEqual(-3_000);
    const mine = (await call('GET', `/api/groups/${g.id}`, member.token)).body.data;
    expect(mine.membership).toMatchObject({ periodsOwed: 0, amountOwed: 0 });
    expect(mine.membership.dues[0].periods.slice(0, 4).map((p: { status: string }) => p.status)).toEqual(['paid', 'paid', 'paid', 'upcoming']);
    expect(mine).not.toHaveProperty('balance');
    expect(mine).not.toHaveProperty('inviteCode');

    // Arrears from the old system: four months before they joined, owed and already overdue.
    expect((await call('POST', `/api/groups/${g.id}/members/${pending[0].id}/backfill`, member.token, { dueId, periods: 4 })).status).toBe(403);
    const back = await call('POST', `/api/groups/${g.id}/members/${pending[0].id}/backfill`, owner.token, { dueId, periods: 4, note: 'Unpaid 2025/26' });
    expect(back.body.data).toMatchObject({ periodsOwed: 4, amountOwed: 400_000, overdue: 400_000 });
    expect(back.body.data.dues[0].periods.slice(0, 5).map((p: { index: number; status: string }) => `${p.index}:${p.status}`)).toEqual(['-4:overdue', '-3:overdue', '-2:overdue', '-1:overdue', '0:paid']);
    const owing = (await call('GET', `/api/groups/${g.id}/members?owing=true`, owner.token)).body.data.items;
    expect(owing.map((m: { user: { username: string } }) => m.user.username).sort()).toEqual(['grp_member', 'grp_owner']);
    expect((await call('GET', `/api/groups/${g.id}/members/${pending[0].id}`, owner.token)).body.data).toMatchObject({ user: { username: 'grp_member' }, backfills: [{ dueId, periods: 4, note: 'Unpaid 2025/26' }] });
    expect((await payDues(member.token, g.id, 4)).status).toBe(201);
    expect((await call('GET', `/api/groups/${g.id}/members?owing=true`, owner.token)).body.data.items.map((m: { user: { username: string } }) => m.user.username)).toEqual(['grp_owner']);
    expect((await call('GET', '/api/groups', member.token)).body.data).toEqual([expect.objectContaining({ id: g.id, role: null, membership: expect.objectContaining({ periodsOwed: 0 }) })]);
    await expectBooksBalanced();
  });

  it('collects several dues: one-offs for today’s members, optional ones never owed, and shows executives who paid what', async () => {
    const owner = await withId('grp_multi');
    const g = await create(owner.token, {
      name: 'Old Boys',
      dues: [
        { name: 'Monthly dues', kind: 'recurring', period: 'monthly', amount: 100_000 },
        { name: 'Welfare', kind: 'recurring', period: 'monthly', amount: 50_000, compulsory: false },
      ],
    });
    const [monthly, welfare] = g.dues;
    // Executives rename it and give it a picture; members see both.
    expect((await call('PATCH', `/api/groups/${g.id}`, owner.token, { name: 'Old Boys Association' })).body.data.name).toBe('Old Boys Association');
    const upload = (token: string, body: Buffer) =>
      app.inject({
        method: 'POST',
        url: `/api/groups/${g.id}/logo`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=x' },
        payload: Buffer.concat([
          Buffer.from('--x\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n'),
          body,
          Buffer.from('\r\n--x--\r\n'),
        ]),
      });
    expect(JSON.parse((await upload(owner.token, Buffer.from('<html>'))).body).code).toBe('PHOTO_INVALID');
    expect(JSON.parse((await upload(owner.token, groupPng)).body).data.logoUrl).toMatch(/^https:\/\/cdn\.tasa\.test\/groups\//);
    await call('PATCH', `/api/groups/${g.id}`, owner.token, { name: 'Old Boys' });
    // The website's invite page: no sign-in, just the name and picture.
    const open = JSON.parse((await app.inject({ method: 'GET', url: `/api/public/groups/${g.inviteCode.toLowerCase()}` })).body);
    expect(open.data).toEqual({ name: 'Old Boys', logoUrl: expect.stringMatching(/groups\//), requireApproval: false });
    expect((await app.inject({ method: 'GET', url: '/api/public/groups/NOPE1234' })).statusCode).toBe(404);
    expect(welfare).toMatchObject({ compulsory: false, period: 'monthly', stats: { current: { members: 1, paid: 0 }, outstanding: 0, collected: 0 } });
    expect(g.dues[0].stats).toMatchObject({ current: { members: 1, paid: 0 }, outstanding: 100_000 });
    const early = await signUp('grp_early');
    await join(early.token, g);
    expect(JSON.parse((await upload(early.token, groupPng)).body).statusCode).toBe(403);
    expect((await call('GET', `/api/groups/${g.id}`, early.token)).body.data.logoUrl).toMatch(/groups\//);

    // A compulsory levy and an optional condolence fee, for the members there today.
    expect((await call('POST', `/api/groups/${g.id}/dues`, early.token, { name: 'Levy', kind: 'one_off', amount: 500_000 })).status).toBe(403);
    expect((await call('POST', `/api/groups/${g.id}/dues`, owner.token, { name: 'Levy', kind: 'recurring', amount: 500_000 })).status).toBe(400);
    const emitted = vi.spyOn(bus, 'emit');
    const deadline = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const levied = await call('POST', `/api/groups/${g.id}/dues`, owner.token, { name: 'Building levy', kind: 'one_off', amount: 500_000, dueAt: deadline });
    expect(levied.status).toBe(201);
    const levy = levied.body.data.dues.find((d: { name: string }) => d.name === 'Building levy');
    expect(levy).toMatchObject({ kind: 'one_off', period: null, compulsory: true, dueAt: deadline, stats: { current: { members: 2, paid: 0 }, outstanding: 1_000_000 } });
    const condolence = (await call('POST', `/api/groups/${g.id}/dues`, owner.token, { name: 'Condolence', kind: 'one_off', amount: 200_000, compulsory: false })).body.data.dues.at(-1);
    expect(emitted).toHaveBeenCalledWith('group.due', { groupId: g.id, dueId: levy.id });

    // Someone joining later owes neither one-off.
    const late = await signUp('grp_late');
    await join(late.token, g);
    expect((await statement(late.token, g.id)).map((d) => d.name)).toEqual(['Monthly dues', 'Welfare']);
    expect((await call('GET', `/api/groups/${g.id}`, late.token)).body.data.membership).toMatchObject({ amountOwed: 100_000, periodsOwed: 1 });
    expect((await pay(late.token, g.id, [{ dueId: levy.id, periods: [0] }])).body.code).toBe('DUES_CHANGED');

    // Each due reads current (due) or optional; nothing is overdue yet.
    const mine = await statement(early.token, g.id);
    expect(mine.map((d) => `${d.name}:${d.periods[0]!.status}`)).toEqual(['Monthly dues:due', 'Welfare:optional', 'Building levy:due', 'Condolence:optional']);
    expect((await call('GET', `/api/groups/${g.id}`, early.token)).body.data.membership).toMatchObject({ amountOwed: 600_000, overdue: 0, periodsOwed: 2 });

    // They choose: this month's dues and the condolence fee, leaving the levy for later.
    await fund(early.token, 2_000_000);
    const paid = await pay(early.token, g.id, [
      { dueId: monthly.id, periods: [0] },
      { dueId: condolence.id, periods: [0] },
    ]);
    expect(paid.body.data).toMatchObject({ kind: 'group_dues', amount: 300_000 });
    expect((await call('GET', `/api/groups/${g.id}`, early.token)).body.data.membership).toMatchObject({ amountOwed: 500_000 });
    // Coming up on Home: the levy still owed and next month's dues; optional dues never show.
    const [mineSummary] = (await call('GET', '/api/groups', early.token)).body.data;
    expect(mineSummary.membership.upcoming.map((u: { name: string; status: string; amount: number }) => `${u.name}:${u.status}:${u.amount}`)).toEqual([
      'Monthly dues:upcoming:100000',
      'Building levy:due:500000',
    ]);
    expect(mineSummary.membership.upcoming[1].date).toBe(deadline);
    expect((await pay(early.token, g.id, [{ dueId: monthly.id, periods: [1] }, { dueId: monthly.id, periods: [2] }])).body.code).toBe('DUPLICATE_DUE');

    // Who paid what: members down the side, this month and last across.
    expect((await call('GET', `/api/groups/${g.id}/dues/${monthly.id}/report`, early.token)).status).toBe(403);
    const report = (await call('GET', `/api/groups/${g.id}/dues/${monthly.id}/report`, owner.token)).body.data;
    // This calendar year, every month; everyone's first period lands in this month's column.
    const { y: year, m: month } = lagosParts(new Date());
    expect(report).toMatchObject({ year, years: [year] });
    expect(report.columns).toHaveLength(12);
    expect(report.columns[month]).toMatchObject({ members: 3, paid: 1, collected: 100_000 });
    if (month > 0) expect(report.columns[month - 1]).toMatchObject({ members: 0, paid: 0 });
    expect(report.totals).toEqual({ collected: 100_000, outstanding: 200_000, members: 3, owing: 2 });
    const row = (username: string) => report.items.find((r: { user: { username: string } }) => r.user.username === username);
    expect(row('grp_early')).toMatchObject({ owed: 0, paid: 1 });
    expect(row('grp_early').cells[month]).toBe('paid');
    expect(row('grp_early').cells.slice(0, month)).toEqual(Array(month).fill(null));
    expect(row('grp_late').cells[month]).toBe('due');
    expect(row('grp_late').owed).toBe(100_000);
    // Another year: its own twelve months, nobody a member yet.
    const lastYear = (await call('GET', `/api/groups/${g.id}/dues/${monthly.id}/report?year=${year - 1}`, owner.token)).body.data;
    expect(lastYear.columns).toHaveLength(12);
    expect(lastYear.items.every((r: { cells: unknown[] }) => r.cells.every((c) => c === null))).toBe(true);
    expect(report.items.at(-1).user.username).toBe('grp_early');
    const levyReport = (await call('GET', `/api/groups/${g.id}/dues/${levy.id}/report`, owner.token)).body.data;
    expect(levyReport).toMatchObject({ columns: [{ members: 2, paid: 0, end: deadline }], totals: { outstanding: 1_000_000, members: 2 } });
    expect(levyReport.items.map((r: { user: { username: string } }) => r.user.username)).not.toContain('grp_late');

    // The same report as an Excel file: everyone on one sheet, one column per month, amounts in naira.
    const file = await app.inject({ method: 'GET', url: `/api/groups/${g.id}/dues/${monthly.id}/report.xlsx`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect(file.headers['content-disposition']).toMatch(/attachment; filename="Old-Boys-Monthly-dues-\d{4}\.xlsx"/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file.rawPayload as unknown as ArrayBuffer);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Old Boys');
    const header = sheet.getRow(6).values as unknown[];
    expect(header).toContain('Member');
    expect(header.filter((v) => typeof v === 'string' && /^[A-Z][a-z]{2,3} \d{4}$/.test(v))).toHaveLength(12);
    const earlyRow = sheet.getRows(7, report.items.length)!.find((r) => r.getCell(2).value === '@grp_early')!;
    expect(earlyRow.getCell(3 + month).value).toBe('Paid');
    const lateRow = sheet.getRows(7, report.items.length)!.find((r) => r.getCell(2).value === '@grp_late')!;
    expect(lateRow.getCell(3 + 12 + 1).value).toBe(1000);
    expect((await app.inject({ method: 'GET', url: `/api/groups/${g.id}/dues/${monthly.id}/report.xlsx`, headers: { authorization: `Bearer ${early.token}` } })).statusCode).toBe(403);

    // Ending the condolence fee: paid stays paid, and nobody can pay it any more.
    expect((await call('PATCH', `/api/groups/${g.id}/dues/${condolence.id}`, owner.token, { ended: true })).body.data.dues.at(-1).endedAt).toEqual(expect.any(String));
    expect((await call('PATCH', `/api/groups/${g.id}/dues/${condolence.id}`, owner.token, { ended: true })).body.code).toBe('DUE_ENDED');
    expect((await statement(early.token, g.id)).find((d) => d.name === 'Condolence')!.periods).toEqual([expect.objectContaining({ status: 'paid' })]);
    expect((await statement(owner.token, g.id)).map((d) => d.name)).not.toContain('Condolence');
    expect((await call('POST', `/api/groups/${g.id}/members/${(await call('GET', `/api/groups/${g.id}`, early.token)).body.data.membership.id}/backfill`, owner.token, { dueId: welfare.id, periods: 2 })).body.code).toBe('DUE_NOT_BACKFILLABLE');
    await expectBooksBalanced();
  });

  it('withdraws only to the locked account, and changes it only with co-signers and a cooling-off nobody objected to', async () => {
    const owner = await withId('grp_boss');
    const [ex1, ex2] = [await withId('grp_ex1'), await withId('grp_ex2')];
    const noId = await signUp('grp_noid');
    const g = await create(owner.token);
    expect((await call('POST', `/api/groups/${g.id}/executives`, owner.token, { username: 'grp_noid' })).body.code).toBe('ID_REQUIRED');
    expect((await call('POST', `/api/groups/${g.id}/executives`, ex1.token, { username: 'grp_ex2' })).status).toBe(403);
    for (const name of ['grp_ex1', 'grp_ex2']) expect((await call('POST', `/api/groups/${g.id}/executives`, owner.token, { username: name })).status).toBe(201);
    const member = await signUp();
    await join(member.token, g);
    await fund(member.token, 500_000);
    await payDues(member.token, g.id, 1); // ₦980 to the group
    expect(await groupBalance(g.id)).toBe(98_000);

    // Any executive can withdraw; only to the group's account; only what it holds.
    const withdraw = async (token: string, amount: number) => {
      const quote = await call('POST', '/api/quotes', token, { kind: 'group_payout', groupId: g.id, amount });
      if (quote.status !== 201) return quote;
      return call('POST', `/api/groups/${g.id}/withdrawals`, token, { quoteId: quote.body.data.id, pin: '2580' });
    };
    expect((await withdraw(member.token, 10_000)).status).toBe(403);
    expect((await withdraw(noId.token, 10_000)).status).toBe(403);
    expect((await withdraw(ex1.token, 95_000)).body.code).toBe('GROUP_FUNDS_LOW');
    const sent = await withdraw(ex1.token, 50_000);
    expect(sent.body.data).toMatchObject({ kind: 'group_payout', status: 'pending', amount: 50_000, fee: 5_000, total: 55_000 });
    expect(calls.filter((c) => c.path === '/api/v1/bank_transfer').at(-1)!.body).toMatchObject({ account_number: '9876543210', reference: sent.body.data.reference });
    expect(await groupBalance(g.id)).toBe(43_000);
    say.payouts.set(sent.body.data.reference, { status: 'success', fee: '15' });
    expect((await TicketsService.requeryPayout(sent.body.data.id, 1))?.status).toBe('success');
    const back = await withdraw(ex1.token, 10_000);
    say.payouts.set(back.body.data.reference, { status: 'reversed', fee: '15' });
    expect((await TicketsService.requeryPayout(back.body.data.id, 1))?.status).toBe('failed');
    expect(await groupBalance(g.id)).toBe(43_000);
    const history = (await call('GET', `/api/groups/${g.id}/withdrawals`, member.token)).body.data;
    expect(history.map((w: { status: string }) => w.status)).toEqual(['failed', 'success']);
    expect(history[1]).toMatchObject({ amount: 50_000, to: { last4: '3210' }, by: expect.any(String) });

    // The owner proposes; two co-signers must both approve.
    const propose = (token: string, cosigners: string[]) =>
      call('POST', `/api/groups/${g.id}/payout-change`, token, { bankCode: '035', accountNumber: '1234567890', cosigners, pin: '2580' });
    expect((await propose(ex1.token, [ex2.userId, owner.userId])).status).toBe(403);
    expect((await propose(owner.token, [ex1.userId])).status).toBe(400);
    expect((await propose(owner.token, [ex1.userId, member.userId])).body.code).toBe('COSIGNER_NOT_EXECUTIVE');
    const proposed = await propose(owner.token, [ex1.userId, ex2.userId]);
    expect(proposed.status).toBe(201);
    expect(proposed.body.data.payoutChange).toMatchObject({ status: 'awaiting_approval', to: { last4: '7890' }, cosigners: [{ approvedAt: null }, { approvedAt: null }] });
    expect((await propose(owner.token, [ex1.userId, ex2.userId])).body.code).toBe('PAYOUT_CHANGE_OPEN');
    // Members aren't told until it's approved; withdrawals wait meanwhile.
    expect((await call('GET', `/api/groups/${g.id}`, member.token)).body.data.payoutChange).toBeNull();
    expect((await withdraw(ex1.token, 10_000)).body.code).toBe('PAYOUT_CHANGE_OPEN');
    expect((await call('DELETE', `/api/groups/${g.id}/executives/${ex1.userId}`, owner.token)).body.code).toBe('PAYOUT_CHANGE_OPEN');

    expect((await call('POST', `/api/groups/${g.id}/payout-change/approve`, ex1.token, { pin: '1111' })).status).not.toBe(200);
    expect((await call('POST', `/api/groups/${g.id}/payout-change/approve`, ex1.token, { pin: '2580' })).body.data.payoutChange.status).toBe('awaiting_approval');
    expect((await call('POST', `/api/groups/${g.id}/payout-change/approve`, ex1.token, { pin: '2580' })).body.code).toBe('NOTHING_TO_APPROVE');
    const approved = await call('POST', `/api/groups/${g.id}/payout-change/approve`, ex2.token, { pin: '2580' });
    expect(approved.body.data.payoutChange).toMatchObject({ status: 'cooling_off', effectiveAt: expect.any(String) });
    const apply = (await getQueue(GROUPS_QUEUE).getJobs(['delayed'])).find((j) => j.name === 'payout-change.apply' && j.data.changeId === approved.body.data.payoutChange.id);
    expect(apply?.opts.delay).toBe(PAYOUT_CHANGE_COOLING_OFF_MS);
    expect((await call('GET', `/api/groups/${g.id}`, member.token)).body.data.payoutChange).toMatchObject({ status: 'cooling_off' });

    // Not before the cooling-off ends; then it's the group's, and members accept it before paying again.
    await GroupsService.applyPayoutChange(approved.body.data.payoutChange.id);
    expect((await call('GET', `/api/groups/${g.id}`, owner.token)).body.data.payout.accountNumber).toBe('9876543210');
    await GroupPayoutChangeModel.updateOne({ _id: approved.body.data.payoutChange.id }, { effectiveAt: new Date(Date.now() - 1000) });
    await GroupsService.sweepPayoutChanges();
    const after = (await call('GET', `/api/groups/${g.id}`, owner.token)).body.data;
    expect(after).toMatchObject({ payout: { accountNumber: '1234567890' }, terms: { version: 2 }, payoutChange: null });
    expect((await call('GET', `/api/groups/${g.id}`, member.token)).body.data.membership.mustAcceptTerms).toBe(true);
    expect((await payDues(member.token, g.id, 1)).body.code).toBe('GROUP_TERMS_CHANGED');
    expect((await call('POST', `/api/groups/${g.id}/terms`, member.token, { acceptTerms: 1 })).body.code).toBe('GROUP_TERMS_CHANGED');
    expect((await call('POST', `/api/groups/${g.id}/terms`, member.token, { acceptTerms: 2 })).body.data.membership.mustAcceptTerms).toBe(false);
    expect((await payDues(member.token, g.id, 1)).status).toBe(201);
    const next = await withdraw(ex2.token, 10_000);
    expect(calls.filter((c) => c.path === '/api/v1/bank_transfer').at(-1)!.body).toMatchObject({ account_number: '1234567890', reference: next.body.data.reference });

    // Any executive can stop the next one; one nobody approves in time lapses.
    say.payouts.set(next.body.data.reference, { status: 'success', fee: '15' });
    await TicketsService.requeryPayout(next.body.data.id, 1);
    const again = await call('POST', `/api/groups/${g.id}/payout-change`, owner.token, { bankCode: '035', accountNumber: '5555555555', cosigners: [ex1.userId, ex2.userId], pin: '2580' });
    expect((await call('POST', `/api/groups/${g.id}/payout-change/object`, member.token, { reason: 'Not ours' })).status).toBe(403);
    expect((await call('POST', `/api/groups/${g.id}/payout-change/object`, ex2.token, { reason: 'We never agreed to this account' })).body.data.payoutChange).toBeNull();
    expect(await GroupPayoutChangeModel.findById(again.body.data.payoutChange.id)).toMatchObject({ status: 'rejected', closedReason: 'We never agreed to this account' });
    const lapsing = await call('POST', `/api/groups/${g.id}/payout-change`, owner.token, { bankCode: '035', accountNumber: '5555555555', cosigners: [ex1.userId, ex2.userId], pin: '2580' });
    await GroupPayoutChangeModel.updateOne({ _id: lapsing.body.data.payoutChange.id }, { expiresAt: new Date(Date.now() - 1000) });
    await GroupsService.sweepPayoutChanges();
    expect(await GroupPayoutChangeModel.findById(lapsing.body.data.payoutChange.id)).toMatchObject({ status: 'expired' });
    expect((await call('GET', `/api/groups/${g.id}`, owner.token)).body.data.payout.accountNumber).toBe('1234567890');
    await expectBooksBalanced();
  });
  it('lets the back office see a group and suspend it: no joining, paying or withdrawing until lifted', async () => {
    const owner = await withId('grp_admin_owner');
    const g = await create(owner.token, { name: 'Chess Club' });
    const member = await signUp();
    await join(member.token, g);
    await fund(member.token, 500_000);
    await payDues(member.token, g.id, 2);
    const support = await asSupport();

    const list = (await call('GET', '/api/admin/groups?search=chess', support)).body.data.items;
    expect(list).toEqual([expect.objectContaining({ id: g.id, name: 'Chess Club', members: 2, balance: 198_000, suspended: false })]);
    expect((await call('GET', '/api/admin/groups', member.token)).status).toBe(403);
    expect((await call('GET', `/api/admin/groups/${g.id}`, support)).body.data).toMatchObject({
      payout: { accountNumber: '9876543210' },
      collected: { amount: 200_000, payments: 1 },
      executives: [{ role: 'owner' }],
    });

    expect((await call('POST', `/api/admin/groups/${g.id}/suspension`, support, { suspended: true })).status).toBe(400);
    const paused = await call('POST', `/api/admin/groups/${g.id}/suspension`, support, { suspended: true, reason: 'Members report a fake association' });
    expect(paused.body.data.suspension).toMatchObject({ active: true, reason: 'Members report a fake association', by: 'Support' });
    expect((await call('POST', `/api/admin/groups/${g.id}/suspension`, support, { suspended: true, reason: 'Again please' })).body.code).toBe('SUSPENSION_UNCHANGED');
    expect((await payDues(member.token, g.id, 1)).status).toBe(403);
    expect((await call('POST', '/api/quotes', owner.token, { kind: 'group_payout', groupId: g.id, amount: 10_000 })).status).toBe(403);
    expect((await join((await signUp()).token, g)).status).toBe(403);
    expect((await call('GET', `/api/groups/${g.id}`, member.token)).body.data.suspended).toMatchObject({ reason: 'Members report a fake association' });
    expect((await app.inject({ method: 'GET', url: `/api/public/groups/${g.inviteCode}` })).statusCode).toBe(404);

    await call('POST', `/api/admin/groups/${g.id}/suspension`, support, { suspended: false, reason: 'Checked with the school' });
    expect((await payDues(member.token, g.id, 1)).status).toBe(201);
    expect((await call('GET', `/api/admin/groups/${g.id}`, support)).body.data.suspension.history.map((h: { action: string }) => h.action)).toEqual(['lifted', 'suspended']);
    await expectBooksBalanced();
  });
});

describe('split bills', () => {
  /** What the splits worker does with the job the last share queued. */
  const runPayJob = async (splitId: string) => {
    const job = (await getQueue(SPLITS_QUEUE).getJobs(['waiting', 'delayed'])).find((j) => j.name === 'split.pay' && j.data.splitId === splitId);
    expect(job).toBeDefined();
    await SplitsService.payBill(splitId);
  };
  const person = async (name: string) => {
    const user = await signUp(name);
    await fund(user.token, 1_000_000);
    return user;
  };
  const meter = { serviceId: 'electricity', provider: 'ikedc', account: '45098273614', amount: 600_000 };
  const start = (token: string, usernames: string[], over: Record<string, unknown> = {}) =>
    call('POST', '/api/splits', token, { title: 'House light', bill: meter, shares: usernames.map((username) => ({ username })), ...over });
  const payShare = async (token: string, splitId: string) => {
    const q = await call('POST', '/api/quotes', token, { kind: 'split_share', splitId });
    if (q.status !== 201) return q;
    return call('POST', `/api/splits/${splitId}/shares`, token, { quoteId: q.body.data.id, pin: '2580' });
  };

  it('collects every share into a pot, then pays the bill from it', async () => {
    const [a, b, c] = [await person('spl_a'), await person('spl_b'), await person('spl_c')];
    expect((await start(a.token, ['spl_a', 'spl_nobody'])).status).toBe(404);
    expect((await start(a.token, ['spl_a', 'spl_a'])).body.code).toBe('DUPLICATE_SHARE');
    const made = await start(a.token, ['spl_a', 'spl_b', 'spl_c']);
    expect(made.status).toBe(201);
    // ₦6,000 + the ₦100 charge, shared three ways; the odd kobo goes to the first.
    const split = made.body.data;
    expect(split).toMatchObject({ status: 'open', amount: 600_000, fee: 10_000, total: 610_000, collected: 0, bill: { customerName: expect.any(String) } });
    expect(split.shares.map((x: { amount: number }) => x.amount)).toEqual([203_334, 203_333, 203_333]);

    // The starter can rename it and move the deadline while it's collecting; nobody else can.
    expect((await call('PATCH', `/api/splits/${split.id}`, b.token, { title: 'Mine now' })).body.code).toBe('NOT_STARTER');
    expect((await call('PATCH', `/api/splits/${split.id}`, a.token, {})).status).toBe(400);
    expect((await call('PATCH', `/api/splits/${split.id}`, a.token, { hours: 999 })).status).toBe(400);
    const emitted = vi.spyOn(bus, 'emit');
    const moved = (await call('PATCH', `/api/splits/${split.id}`, a.token, { title: 'Flat light', hours: 72 })).body.data;
    expect(moved.title).toBe('Flat light');
    expect(Math.round((new Date(moved.deadline).getTime() - Date.now()) / 3_600_000)).toBe(72);
    expect(emitted).toHaveBeenCalledWith('split.update', { splitId: split.id, stage: 'rescheduled' });
    // The old deadline's job doesn't end it early.
    await SplitsService.onDeadline(split.id);
    expect((await call('GET', `/api/splits/${split.id}`, a.token)).body.data.status).toBe('open');

    expect((await payShare(b.token, split.id)).body.data).toMatchObject({ kind: 'split_share', status: 'success', total: 203_333 });
    expect((await payShare(b.token, split.id)).body.code).toBe('SHARE_PAID');
    await payShare(c.token, split.id);
    expect((await call('GET', `/api/splits/${split.id}`, c.token)).body.data).toMatchObject({ status: 'open', collected: 406_666 });
    expect(await balance(b.token)).toBe(1_000_000 - 203_333);

    // The last share in pays the bill: from the pot, not anyone's wallet. It's bought on the
    // queue, so the share answers at once however slow the vend.
    expect((await payShare(a.token, split.id)).body.data).toMatchObject({ kind: 'split_share', status: 'success' });
    expect((await call('GET', `/api/splits/${split.id}`, a.token)).body.data).toMatchObject({ status: 'paying', result: null });
    vt.pay = (body) => delivered(body, { purchased_code: 'Token : 1234 5678 9012 3456 7890', units: '42.1 kWh' });
    await runPayJob(split.id);
    vt.pay = (body) => delivered(body);
    // Everyone who paid in sees the receipt and the token, not just the starter.
    expect((await call('GET', `/api/splits/${split.id}`, c.token)).body.data.result).toMatchObject({
      status: 'success',
      reference: expect.stringMatching(/^TSB/),
      token: expect.stringContaining('1234'),
      units: '42.1 kWh',
    });
    const paid = (await call('GET', `/api/splits/${split.id}`, a.token)).body.data;
    expect(paid).toMatchObject({ status: 'paid', billTransactionId: expect.any(String) });
    expect(await balance(a.token)).toBe(1_000_000 - 203_334);
    expect(await LedgerService.balance(Accounts.split(split.id))).toBe(0);
    const bill = await TransactionModel.findById(paid.billTransactionId);
    expect(bill).toMatchObject({ kind: 'bill', status: 'success', total: 610_000, fundedFrom: Accounts.split(split.id) });
    expect((await call('GET', '/api/splits', b.token)).body.data[0]).toMatchObject({ id: split.id, myShare: { paid: true } });

    // Next month: anyone in it starts the same split again in one go, priced afresh.
    expect((await call('POST', `/api/splits/${split.id}/again`, (await signUp()).token, {})).status).toBe(404);
    const again = await call('POST', `/api/splits/${split.id}/again`, b.token, {});
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({
      status: 'open',
      title: 'Flat light',
      isStarter: true,
      starter: { username: 'spl_b' },
      bill: { serviceId: 'electricity', account: split.bill.account },
      total: 610_000,
      collected: 0,
    });
    expect(again.body.data.shares.map((x: { username: string; amount: number }) => `${x.username}:${x.amount}`)).toEqual(['spl_a:203334', 'spl_b:203333', 'spl_c:203333']);
    expect(again.body.data.id).not.toBe(split.id);
    expect((await call('POST', `/api/splits/${again.body.data.id}/again`, b.token, {})).body.code).toBe('SPLIT_STILL_OPEN');
    // One entry in the list: the new round, with the paid one (and its token) in its history.
    const listed = (await call('GET', '/api/splits', b.token)).body.data;
    expect(listed.map((x: { id: string }) => x.id)).toEqual([again.body.data.id]);
    const round = (await call('GET', `/api/splits/${again.body.data.id}`, c.token)).body.data;
    expect(round.history).toEqual([
      expect.objectContaining({ id: split.id, status: 'paid', total: 610_000, myShare: { amount: 203_333, paid: true, refunded: false }, result: expect.objectContaining({ token: expect.stringContaining('1234') }) }),
    ]);
    expect((await call('GET', `/api/splits/${split.id}`, c.token)).body.data.history.map((x: { id: string }) => x.id)).toEqual([again.body.data.id]);
    await expectBooksBalanced();
  });

  it('gives everyone their share back when the bill fails, the deadline passes, the price moves or the starter cancels', async () => {
    const [a, b] = [await person('spl_d'), await person('spl_e')];
    const refunded = async (...tokens: string[]) => {
      for (const token of tokens) expect(await balance(token)).toBe(1_000_000);
    };

    // VTpass rejects it.
    vt.pay = () => ({ json: { code: '018', response_description: 'LOW WALLET BALANCE' } });
    const failing = (await start(a.token, ['spl_d', 'spl_e'])).body.data;
    await payShare(a.token, failing.id);
    await payShare(b.token, failing.id);
    await runPayJob(failing.id);
    expect((await call('GET', `/api/splits/${failing.id}`, a.token)).body.data).toMatchObject({ status: 'failed', closedReason: expect.stringContaining('back') });
    await refunded(a.token, b.token);
    vt.pay = (body) => delivered(body);

    // Not everyone paid in time.
    const late = (await start(a.token, ['spl_d', 'spl_e'], { hours: 2 })).body.data;
    expect((await getQueue(SPLITS_QUEUE).getJobs(['delayed'])).some((j) => j.name === 'split.deadline' && j.data.splitId === late.id)).toBe(true);
    await payShare(b.token, late.id);
    await SplitModel.updateOne({ _id: late.id }, { deadline: new Date(Date.now() - 1000) });
    expect((await payShare(a.token, late.id)).body.code).toBe('SPLIT_CLOSED');
    await SplitsService.sweep();
    expect((await call('GET', `/api/splits/${late.id}`, b.token)).body.data).toMatchObject({ status: 'expired', myShare: { paid: true, refunded: true } });
    await refunded(a.token, b.token);

    // The TV price went up before the last share: nothing is paid, everyone's refunded.
    const tv = (
      await call('POST', '/api/splits', a.token, {
        title: 'DStv',
        bill: { serviceId: 'tv', provider: 'dstv', account: '7027914329', planCode: 'dstv-padi' },
        shares: [{ username: 'spl_d' }, { username: 'spl_e' }],
      })
    ).body.data;
    expect(tv.amount).toBe(440_000);
    await payShare(a.token, tv.id);
    const before = vt.plans.dstv!;
    vt.plans.dstv = [{ variation_code: 'dstv-padi', name: 'DStv Padi', variation_amount: '4900.00' }];
    await redis.del(planCacheKey('dstv'));
    await payShare(b.token, tv.id);
    await runPayJob(tv.id);
    expect((await call('GET', `/api/splits/${tv.id}`, a.token)).body.data).toMatchObject({ status: 'failed', closedReason: expect.stringContaining('price') });
    vt.plans.dstv = before;
    await redis.del(planCacheKey('dstv'));
    await refunded(a.token, b.token);

    // Only the starter cancels, and only while it's collecting.
    const cancelled = (await start(a.token, ['spl_d', 'spl_e'])).body.data;
    await payShare(b.token, cancelled.id);
    expect((await call('POST', `/api/splits/${cancelled.id}/cancel`, b.token)).body.code).toBe('NOT_STARTER');
    expect((await call('POST', `/api/splits/${cancelled.id}/cancel`, a.token)).body.data).toMatchObject({ status: 'cancelled' });
    await refunded(a.token, b.token);
    expect((await call('GET', `/api/splits/${cancelled.id}`, (await signUp()).token)).status).toBe(404);
    await expectBooksBalanced();
  });
});

describe('paying on the website', () => {
  const meter = { serviceId: 'electricity', provider: 'IKEDC', account: '45098273614', amount: 500_000, meterType: 'prepaid' };
  const order = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/guest/orders', payload: body });
  const status = (reference: string, key: string) => app.inject({ method: 'GET', url: `/api/guest/orders/${reference}?key=${key}` });
  /** The buyer's bank transfer: SaySwitch's signed webhook, checked with SaySwitch before it's credited. */
  const transfer = async (reference: string, naira: string) => {
    const o = await GuestOrderModel.findOne({ reference });
    const funding = await TransactionModel.findById(o!.funding);
    say.verify.set(funding!.reference, { status: 'success', amount: naira });
    const { raw, headers } = signed({ notify: 'transaction', notifyType: 'successful', data: { reference: funding!.reference } });
    await app.inject({ method: 'POST', url: '/api/webhooks/sayswitch', headers, payload: raw });
    const event = await WebhookEventModel.findOne({ reference: funding!.reference }).sort({ createdAt: -1 });
    await WebhooksService.process(event!.id); // the queue worker isn't running in tests
    return o!;
  };
  const smsTo = async (phone: string) =>
    (await getQueue('notifications').getJobs(['waiting', 'delayed'])).filter((j) => j.name === 'sms' && j.data.to === phone).map((j) => j.data.body as string);

  it('buys a token without the app: a transfer to a one-time account, then the bill, texted to the buyer', async () => {
    const services = JSON.parse((await app.inject({ method: 'GET', url: '/api/guest/services' })).body).data;
    expect(services.map((s: { id: string }) => s.id).sort()).toEqual(['airtime', 'electricity', 'jamb']);
    const checked = JSON.parse((await app.inject({ method: 'POST', url: '/api/guest/verify', payload: meter })).body).data;
    expect(checked.customer).toMatchObject({ name: 'ADAEZE OKAFOR' });

    const res = await order({ bill: meter, phone: '0803 555 0101', email: 'buyer@example.com' });
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body).data;
    expect(created).toMatchObject({
      status: 'awaiting_payment',
      amount: 500_000,
      fee: 10_000,
      total: 510_000,
      phone: '0803****101',
      bill: { serviceId: 'electricity', provider: 'IKEDC', customerName: 'ADAEZE OKAFOR' },
      payTo: { accountNumber: '8787652431' },
    });
    expect(created.reference).toMatch(/^TSY/);
    expect(created.key).toMatch(/^[a-f0-9]{48}$/);
    // The reference alone shows nothing.
    expect((await status(created.reference, 'a'.repeat(48))).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/guest/orders/${created.reference}` })).statusCode).toBe(400);

    // Not paid yet: still waiting, nothing bought.
    expect(JSON.parse((await status(created.reference, created.key)).body).data.status).toBe('awaiting_payment');

    // The transfer lands; the status page confirms it with SaySwitch and the bill is queued.
    const o = await transfer(created.reference, '5100.00');
    expect(JSON.parse((await status(created.reference, created.key)).body).data).toMatchObject({ status: 'paying', payTo: null });
    expect((await getQueue(GUEST_QUEUE).getJobs(['waiting', 'delayed'])).some((j) => j.name === 'guest.pay' && j.data.orderId === o.id)).toBe(true);
    vt.pay = (b) => delivered(b, { purchased_code: 'Token : 5555 6666 7777 8888 9999', units: '31.4 kWh' });
    await GuestService.payBill(o.id);
    vt.pay = (b) => delivered(b);

    const done = JSON.parse((await status(created.reference, created.key)).body).data;
    expect(done).toMatchObject({ status: 'delivered', result: { token: expect.stringContaining('5555'), units: '31.4 kWh', reference: expect.stringMatching(/^TSB/) } });
    expect((await smsTo('+2348035550101')).some((t) => t.includes('5555 6666') && t.includes('45098273614'))).toBe(true);
    // They gave an email, so the receipt goes there too: the token, and a link back to the order.
    const mail = (await getQueue('notifications').getJobs(['waiting', 'delayed'])).find((j) => j.name === 'email' && j.data.to === 'buyer@example.com');
    expect(mail?.data.subject).toBe('Your electricity token for meter 45098273614');
    expect(mail?.data.html).toContain('5555 6666 7777 8888 9999');
    expect(mail?.data.html).toContain(`/pay/order/${created.reference}?key=${created.key}`);
    expect(mail?.data.text).toContain('5555 6666');
    // It's that number's Tasa account: the payment is in its history, the wallet back to zero.
    const owner = await UserModel.findOne({ phone: '+2348035550101' });
    expect(owner).toMatchObject({ status: 'active' });
    expect(owner!.fullName).toBeUndefined();
    expect(await LedgerService.walletBalance(owner!.id)).toBe(0);

    // The back office tells them apart by channel, finds both transactions by the order's reference,
    // and shows the order on each.
    const support = await asSupport();
    const byOrder = (await call('GET', `/api/admin/transactions?reference=${created.reference}`, support)).body.data.items;
    expect(byOrder.map((t: { kind: string; channel: string }) => `${t.kind}:${t.channel}`).sort()).toEqual(['bill:web', 'funding:web']);
    const web = (await call('GET', '/api/admin/transactions?channel=web&limit=100', support)).body.data.items;
    expect(web.every((t: { channel: string }) => t.channel === 'web')).toBe(true);
    const app_ = (await call('GET', '/api/admin/transactions?channel=app&limit=100', support)).body.data.items;
    expect(app_.some((t: { id: string }) => byOrder.some((w: { id: string }) => w.id === t.id))).toBe(false);
    const detail = (await call('GET', `/api/admin/transactions/${byOrder[0].id}`, support)).body.data;
    expect(detail).toMatchObject({ channel: 'web', guestOrder: { reference: created.reference, status: 'delivered', phone: '+2348035550101', email: 'buyer@example.com' } });
    await expectBooksBalanced();
  });

  it('keeps the money in the number’s Tasa wallet when the bill fails or the transfer is short, for whoever signs up with it', async () => {
    const phone = '08035550202';
    // VTpass turns it down: the bill's refund lands in the wallet, and they're told where.
    const first = JSON.parse((await order({ bill: meter, phone })).body).data;
    const o = await transfer(first.reference, '5100.00');
    await status(first.reference, first.key);
    vt.pay = () => ({ json: { code: '018', response_description: 'LOW WALLET BALANCE' } });
    await GuestService.payBill(o.id);
    vt.pay = (b) => delivered(b);
    const failed = JSON.parse((await status(first.reference, first.key)).body).data;
    expect(failed).toMatchObject({ status: 'failed', inWallet: 510_000, result: null });
    expect((await smsTo('+2348035550202')).some((t) => t.includes('₦5,100') && t.includes('sign up with 08035550202'))).toBe(true);

    // Sent less than asked: what came in waits in the wallet, nothing is bought.
    const second = JSON.parse((await order({ bill: meter, phone })).body).data;
    const short = await transfer(second.reference, '3000.00');
    await status(second.reference, second.key);
    await GuestService.payBill(short.id);
    // Even with the earlier ₦5,100 sitting in the wallet: an order spends only its own transfer.
    expect(JSON.parse((await status(second.reference, second.key)).body).data).toMatchObject({ status: 'failed', inWallet: 300_000, failureReason: expect.stringContaining('less than') });

    // The number's owner signs up and finds it all in their wallet.
    const otp = await call('POST', '/api/auth/otp', undefined, { type: 'phone', value: phone });
    const signedIn = await call('POST', '/api/auth/otp/verify', undefined, { type: 'phone', value: phone, code: otp.body.data.code });
    expect(signedIn.body.data.user.fullName ?? null).toBeNull();
    expect(await balance(signedIn.body.data.accessToken)).toBe(810_000);
    await expectBooksBalanced();
  });

  it('keeps to one-off bills, a size limit and a few orders a day per number', async () => {
    expect((await order({ bill: { serviceId: 'tv', provider: 'DSTV', account: '7023456789', planCode: 'dstv-padi' }, phone: '08035550303' })).statusCode).toBe(400);
    expect(JSON.parse((await order({ bill: { ...meter, amount: 6_000_000 }, phone: '08035550303' })).body).code).toBe('GUEST_AMOUNT_LIMIT');
    const someone = await UserModel.findOne({ phone: '+2348035550303' });
    await GuestOrderModel.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        reference: `TSYTEST000000${i}`,
        user: someone!._id,
        phone: '+2348035550303',
        bill: { serviceId: 'electricity', provider: 'IKEDC', account: '45098273614' },
        amount: 500_000,
        fee: 10_000,
        total: 510_000,
        funding: new mongoose.Types.ObjectId(),
        accessKey: 'x',
      })),
    );
    expect(JSON.parse((await order({ bill: meter, phone: '08035550303' })).body).code).toBe('GUEST_DAILY_LIMIT');
  });
});

describe('students, and dues receipts', () => {
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  let schoolSeq = 0;

  /** Multipart with one file, plus any text fields, as the app sends it. */
  async function upload(url: string, token: string, file: { name: string; content: Buffer }, fields: Record<string, string> = {}) {
    const boundary = 'tasa-test-boundary';
    const payload = Buffer.concat([
      ...Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="x.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      file.content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    return { status: res.statusCode, body: res.json() };
  }

  const school = async (over: Record<string, unknown> = {}) => {
    const n = ++schoolSeq;
    const res = await call('POST', '/api/admin/schools', await asCompliance(), {
      name: `University of Testing ${n}`,
      shortName: `UT${n}`,
      kind: 'university',
      state: 'Lagos',
      emailDomains: [`stu${n}.ut.edu.ng`],
      active: true,
      ...over,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; emailDomains: string[] };
  };
  const profile = (schoolId: string, over: Record<string, unknown> = {}) => ({
    schoolId,
    faculty: 'Science',
    department: 'Computer Science',
    programme: 'undergraduate',
    level: 3,
    matricNumber: `190401${String(100 + ++schoolSeq)}`,
    admissionYear: 2023,
    ...over,
  });
  /** Signed up with an ID on file: allowed to run a group. */
  const withId = async () => {
    const user = await signUp();
    await call('POST', '/api/me/nin', user.token, { nin: '12345678901' });
    return user;
  };
  const duesGroup = (over: Record<string, unknown> = {}) => ({
    name: 'Computer Science 300L 2025/26',
    dues: [{ name: 'Departmental dues', kind: 'recurring', period: 'yearly', amount: 500_000 }],
    fields: [{ label: 'Matric number', required: true }],
    bankCode: '035',
    accountNumber: '9876543210',
    ...over,
  });

  it('verifies a student by school email, keeps matric numbers to one account, and undoes it when they change school details', async () => {
    const s = await school();
    const hidden = await school({ active: false });
    const me = await signUp();
    expect((await call('GET', '/api/students/me', me.token)).body.data).toBeNull();
    const logo = await upload(`/api/admin/schools/${s.id}/logo`, await asCompliance(), { name: 'file', content: JPEG });
    expect(logo.body.data.logoUrl).toMatch(/\/schools\//);
    expect((await upload(`/api/admin/schools/${s.id}/logo`, await asSupport(), { name: 'file', content: JPEG })).status).toBe(403);
    const listed = (await call('GET', `/api/students/schools?search=${encodeURIComponent('Testing')}`, me.token)).body.data.map((x: { id: string }) => x.id);
    expect(listed).toContain(s.id);
    expect((await call('GET', '/api/students/schools?search=Testing', me.token)).body.data.find((x: { id: string }) => x.id === s.id).logoUrl).toBe(logo.body.data.logoUrl);
    expect(listed).not.toContain(hidden.id);
    // "Are you a student?" comes first: no details saved without accepting the terms.
    expect((await call('GET', '/api/students/terms', me.token)).body.data).toMatchObject({ version: 1, accepted: false, points: expect.any(Array) });
    expect((await call('PUT', '/api/students/me', me.token, profile(s.id))).body.code).toBe('STUDENT_TERMS_REQUIRED');
    expect((await call('POST', '/api/students/terms', me.token, { acceptTerms: 2 })).body.code).toBe('STUDENT_TERMS_CHANGED');
    expect((await call('POST', '/api/students/terms', me.token, { acceptTerms: 1 })).body.data.accepted).toBe(true);
    expect((await call('PUT', '/api/students/me', me.token, profile(hidden.id))).body.code).toBe('SCHOOL_UNAVAILABLE');
    expect((await call('POST', '/api/students/me/email', me.token, { email: 'me@gmail.com' })).body.code).toBe('STUDENT_PROFILE_MISSING');

    const saved = await call('PUT', '/api/students/me', me.token, profile(s.id, { department: 'Dept. of Computer Science', matricNumber: 'csc/2023/041' }));
    expect(saved.body.data).toMatchObject({ matricNumber: 'CSC/2023/041', school: { id: s.id }, verification: { status: 'unsubmitted' } });
    expect((await call('POST', '/api/students/me/email', me.token, { email: 'me@gmail.com' })).body.code).toBe('SCHOOL_EMAIL_INVALID');
    const email = `ada@sub.${s.emailDomains[0]}`;
    const sent = await call('POST', '/api/students/me/email', me.token, { email });
    expect(sent.status).toBe(200);
    expect((await call('POST', '/api/students/me/email/verify', me.token, { email, code: '000000' })).status).toBe(401);
    const verified = await call('POST', '/api/students/me/email/verify', me.token, { email, code: sent.body.data.code });
    expect(verified.body.data.verification).toMatchObject({ status: 'verified', method: 'email', email });

    // Nobody else can be verified as them.
    const other = await signUp();
    await call('POST', '/api/students/terms', other.token, { acceptTerms: 1 });
    expect((await call('PUT', '/api/students/me', other.token, profile(s.id, { matricNumber: 'CSC/2023/041' }))).body.code).toBe('MATRIC_TAKEN');

    // Levels run within a programme: JUPEB has one year, an ND reads ND1/ND2.
    expect((await call('PUT', '/api/students/me', me.token, profile(s.id, { matricNumber: 'CSC/2023/041', programme: 'jupeb', level: 2 }))).status).toBe(400);
    expect((await call('PUT', '/api/students/me', me.token, profile(s.id, { department: 'Computer Science', matricNumber: 'CSC/2023/041', programme: 'nd', level: 2 }))).body.data).toMatchObject({ programme: 'nd', level: 2, levelLabel: 'ND2' });
    // A new level is just a new session; a new department needs verifying again.
    expect((await call('PUT', '/api/students/me', me.token, profile(s.id, { department: 'Computer Science', matricNumber: 'CSC/2023/041', level: 4 }))).body.data.verification.status).toBe('verified');
    expect((await call('PUT', '/api/students/me', me.token, profile(s.id, { department: 'Physics', matricNumber: 'CSC/2023/041' }))).body.data.verification.status).toBe('unsubmitted');
    expect((await call('GET', `/api/students/departments?schoolId=${s.id}&search=comp`, me.token)).body.data).toEqual([]);
    expect((await call('GET', `/api/students/departments?schoolId=${s.id}`, me.token)).body.data).toContain('Physics');
  });

  it('checks a student ID card by hand: encrypted, logged when opened, decided once', async () => {
    const s = await school({ emailDomains: [] });
    const me = await signUp();
    await call('POST', '/api/students/terms', me.token, { acceptTerms: 1 });
    await call('PUT', '/api/students/me', me.token, profile(s.id));
    expect((await call('POST', '/api/students/me/email', me.token, { email: 'x@ut.edu.ng' })).body.code).toBe('SCHOOL_EMAIL_UNAVAILABLE');
    expect((await upload('/api/students/me/card', me.token, { name: 'card', content: Buffer.from('not an image') })).body.code).toBe('PHOTO_INVALID');
    const sent = await upload('/api/students/me/card', me.token, { name: 'card', content: JPEG });
    expect(sent.status).toBe(201);
    expect(sent.body.data.verification).toMatchObject({ status: 'pending', method: 'id_card' });
    // Stored encrypted: the bucket never holds the photo as sent.
    const stored = [...r2Objects.entries()].find(([k]) => k.startsWith(`students/${me.userId}/`));
    expect(stored?.[1].body?.equals(JPEG)).toBe(false);

    const queue = (await call('GET', '/api/admin/students?status=pending', await asCompliance())).body.data.items;
    expect(queue.map((x: { id: string }) => x.id)).toContain(me.userId);
    expect((await call('POST', `/api/admin/students/${me.userId}/card`, await asSupport())).status).toBe(403);
    const card = await app.inject({ method: 'POST', url: `/api/admin/students/${me.userId}/card`, headers: { authorization: `Bearer ${await asCompliance()}` } });
    expect(card.statusCode).toBe(200);
    expect(card.rawPayload.equals(JPEG)).toBe(true);
    expect(await AdminAuditModel.exists({ route: '/api/admin/students/:id/card', 'params.id': me.userId })).toBeTruthy();

    const emitted = vi.spyOn(bus, 'emit');
    const rejected = await call('POST', `/api/admin/students/${me.userId}/review`, await asCompliance(), { status: 'rejected', reason: 'The photo is blurry' });
    expect(rejected.body.data.verification).toMatchObject({ status: 'rejected', reason: 'The photo is blurry' });
    expect((await call('POST', `/api/admin/students/${me.userId}/review`, await asCompliance(), { status: 'verified' })).body.code).toBe('STUDENT_NOT_PENDING');
    await upload('/api/students/me/card', me.token, { name: 'card', content: JPEG });
    expect((await call('POST', `/api/admin/students/${me.userId}/review`, await asCompliance(), { status: 'verified' })).body.data.verification.status).toBe('verified');
    expect(emitted).toHaveBeenCalledWith('student.verified', expect.objectContaining({ userId: me.userId, status: 'verified' }));
    emitted.mockRestore();
    expect((await upload('/api/students/me/card', me.token, { name: 'card', content: JPEG })).body.code).toBe('STUDENT_ALREADY_VERIFIED');

    // Staff can take it back, once.
    expect((await call('POST', `/api/admin/students/${me.userId}/revoke`, await asSupport(), { reason: 'Card was forged' })).status).toBe(403);
    const revoked = await call('POST', `/api/admin/students/${me.userId}/revoke`, await asCompliance(), { reason: 'Card was forged' });
    expect(revoked.body.data.verification).toMatchObject({ status: 'rejected', reason: 'Card was forged', revoked: true });
    expect((await call('POST', `/api/admin/students/${me.userId}/revoke`, await asCompliance(), { reason: 'Again' })).body.code).toBe('STUDENT_NOT_VERIFIED');
  });

  it('offers the general faculty list until staff add a school’s own, and shows departments students typed', async () => {
    const s = await school();
    const me = await signUp();
    await call('POST', '/api/students/terms', me.token, { acceptTerms: 1 });
    await call('PUT', '/api/students/me', me.token, profile(s.id, { faculty: 'Science', department: 'Space Science' }));
    const email = `${me.userId}@${s.emailDomains[0]}`;
    const sent = await call('POST', '/api/students/me/email', me.token, { email });
    await call('POST', '/api/students/me/email/verify', me.token, { email, code: sent.body.data.code });
    const general = (await call('GET', `/api/students/schools/${s.id}/faculties`, me.token)).body.data;
    expect(general.general).toBe(true);
    expect(general.faculties.find((f: { name: string }) => f.name === 'Science').departments).toContain('Computer Science');
    expect((await call('GET', `/api/admin/schools/${s.id}`, await asSupport())).body.data).toMatchObject({ id: s.id, students: { verified: 1, pending: 0 } });
    const before = (await call('GET', `/api/admin/schools/${s.id}/faculties`, await asSupport())).body.data;
    expect(before).toMatchObject({ faculties: [], unlisted: [{ department: 'Space Science', faculty: 'Science', students: 1 }] });

    const saved = await call('PUT', `/api/admin/schools/${s.id}/faculties`, await asSupport(), {
      faculties: [{ name: 'Physical Sciences', departments: ['Space Science', 'Physics', 'Physics'] }],
    });
    expect(saved.body.data).toEqual({ faculties: [{ name: 'Physical Sciences', departments: ['Space Science', 'Physics'] }], unlisted: [] });
    expect((await call('GET', `/api/students/schools/${s.id}/faculties`, me.token)).body.data).toEqual({ general: false, faculties: saved.body.data.faculties });
    expect((await call('PUT', `/api/admin/schools/${s.id}/faculties`, await asSupport(), { faculties: [{ name: 'A b', departments: [] }, { name: 'a B', departments: [] }] })).status).toBe(400);
  });

  it('gives a receipt for each dues payment that anyone can check by its QR link, and nobody can forge', async () => {
    const rep = await withId();
    const g = (await call('POST', '/api/groups', rep.token, duesGroup())).body.data;
    const mate = await signUp();
    await call('POST', '/api/groups/join', mate.token, { code: g.inviteCode, fields: { matric_number: 'CSC/2023/007', department: 'Computer Science' }, acceptTerms: 1 });
    await fund(mate.token, 1_000_000);
    const q = await call('POST', '/api/quotes', mate.token, { kind: 'group_dues', groupId: g.id, items: [{ dueId: g.dues[0].id, periods: [0] }] });
    const paid = await call('POST', `/api/groups/${g.id}/pay`, mate.token, { quoteId: q.body.data.id, pin: '2580' });
    expect(paid.status).toBe(201);

    const receipts = (await call('GET', `/api/groups/${g.id}/receipts`, mate.token)).body.data;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ reference: paid.body.data.reference, amount: 500_000, dues: [{ name: 'Departmental dues', period: 'yearly', periods: [{ index: 0 }] }] });
    expect(receipts[0].url).toBe(`${env.SITE_URL}/r/${receipts[0].code}`);
    expect((await call('GET', `/api/groups/${g.id}/receipts`, (await signUp()).token)).status).toBe(404);

    const checked = await call('GET', `/api/public/receipts/${receipts[0].code}`);
    expect(checked.status).toBe(200);
    expect(checked.body.data).toMatchObject({
      reference: paid.body.data.reference,
      amount: 500_000,
      payer: { matricNumber: 'CSC/2023/007' },
      group: { name: g.name },
      dues: [{ name: 'Departmental dues', periods: [{ index: 0, start: expect.any(String), end: expect.any(String) }] }],
    });
    const forged = `${paid.body.data.reference}-${'0'.repeat(16)}`;
    expect((await call('GET', `/api/public/receipts/${forged}`)).status).toBe(404);
    const otherTx = await TransactionModel.findOne({ kind: 'funding', user: mate.userId });
    expect((await call('GET', `/api/public/receipts/${receipts[0].code.replace(paid.body.data.reference, otherTx!.reference)}`)).status).toBe(404);
    await expectBooksBalanced();
  });
});
