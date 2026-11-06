import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSaySwitchGateway } from './sayswitch';

const cfg = { baseUrl: 'https://api.test', secretKey: 'sk_test_abc', publicKey: 'pk_test_xyz' };
const gw = createSaySwitchGateway(cfg);
const sign = (key: string, v: string) => createHmac('sha512', key).update(v).digest('hex');

describe('SaySwitch webhooks', () => {
  const body = JSON.stringify({ notify: 'transaction', notifyType: 'successful', data: { reference: 'TLF1', amount: '2280.00' } });
  const good = { payloadsignature: sign(cfg.secretKey, body), merchantsignature: sign(cfg.secretKey, cfg.publicKey) };

  it('accepts a correctly signed body', () => {
    expect(gw.verifyWebhook(body, good)).toBe(true);
  });

  it('rejects a tampered body or a wrong merchant signature', () => {
    expect(gw.verifyWebhook(body.replace('2280', '9999'), good)).toBe(false);
    expect(gw.verifyWebhook(body, { ...good, merchantsignature: sign('other', cfg.publicKey) })).toBe(false);
    expect(gw.verifyWebhook(body, {})).toBe(false);
  });

  it("reads SaySwitch's fee from the webhook (their documented sample)", () => {
    const sample = JSON.stringify({
      notify: 'transaction',
      notifyType: 'successful',
      data: {
        id: 10231, business_id: 169, currency: 'NGN', amount: '5000.00', reference: 'S2S_OPAY_WALLET_001', channel: 'opay',
        type: 'banktransfer', domain: 'live', fees: '75.00', requested_amount: '5000.00', status: 'success',
        message: 'Payment successful', paid_at: '2026-06-13T10:22:15.000000Z',
        customer: { id: 4512, email: 'customer@example.com', customer_code: 'CUS_ABC123456' },
      },
    });
    expect(gw.parseWebhook(sample)).toEqual({
      kind: 'transaction', outcome: 'successful', reference: 'S2S_OPAY_WALLET_001', fee: 7_500, customerCode: 'CUS_ABC123456',
    });
  });

  it("reads a payout's fee, which SaySwitch calls `fee` (collections say `fees`)", () => {
    const payout = JSON.stringify({ notify: 'payout', notifyType: 'successful', data: { reference: 'TLO123', amount: '100', fee: '15' } });
    expect(gw.parseWebhook(payout)).toEqual({ kind: 'payout', outcome: 'successful', reference: 'TLO123', fee: 1_500 });
  });

  it('extracts the reference, outcome and any receiving account', () => {
    expect(gw.parseWebhook(body)).toEqual({ kind: 'transaction', outcome: 'successful', reference: 'TLF1' });
    const dedicated = JSON.stringify({
      notify: 'transaction',
      notifyType: 'successful',
      data: { reference: 'SSW_1', transferDetails: { account_number: '9900112233' } },
    });
    expect(gw.parseWebhook(dedicated)).toMatchObject({ reference: 'SSW_1', accountNumber: '9900112233' });
    expect(gw.parseWebhook('{"event":"refund.success"}')).toBeNull();
    expect(gw.parseWebhook('not json')).toBeNull();
  });
});

describe('SaySwitch calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (json: unknown, status = 200) => {
    const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status }));
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const sent = (fn: ReturnType<typeof vi.fn>) => JSON.parse(fn.mock.calls[0]![1].body as string);

  it('sends naira and reads kobo back', async () => {
    const fn = stubFetch({ status: true, data: { account_name: 'SAYSWITCH', account_number: '8787652431', bank_name: 'Wema Bank' } });
    await gw.collectByTransfer({
      reference: 'TLF1',
      amount: 1_005_000,
      customer: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '08030000000' },
    });
    expect(sent(fn).amount).toBe('10050');

    stubFetch({ success: true, data: { status: 'success', amount: '10050.00', fees: '50.25', reference: 'TLF1' } });
    expect(await gw.verify('TLF1')).toMatchObject({ status: 'success', amountPaid: 1_005_000, providerFee: 5_025 });
  });

  it('treats an unknown reference as still pending', async () => {
    stubFetch({ success: false, message: 'Transaction not found' }, 404);
    expect(await gw.verify('TLF404')).toEqual({ status: 'pending', amountPaid: 0 });
  });
});
