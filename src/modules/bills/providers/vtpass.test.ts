import { afterEach, describe, expect, it, vi } from 'vitest';
import { classify, createVtpassGateway, uniquePlans } from './vtpass';

const cfg = { baseUrl: 'https://vt.test/api', apiKey: 'api', publicKey: 'PK_x', secretKey: 'SK_x' };
const vt = createVtpassGateway(cfg);

const ok = (status: string, extra: Record<string, unknown> = {}) => ({
  code: '000',
  response_description: 'TRANSACTION SUCCESSFUL',
  content: { transactions: { status, transactionId: 'VT1', total_amount: 19.3 } },
  ...extra,
});

describe('uniquePlans', () => {
  it('collapses exact copies, keeps the rest, and drops a code shared by different plans', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plans = [
      { code: 'vt-5000', name: 'Spectranet N5000', amount: 500_000 },
      { code: 'vt-5000', name: 'Spectranet N5000', amount: 500_000 },
      { code: 'mega', name: '675GB', amount: 7_500_000 },
      { code: 'mega', name: '1TB', amount: 10_000_000 },
      { code: 'same-price', name: '1.5GB', amount: 100_000 },
      { code: 'same-price', name: '4GB', amount: 100_000 },
      { code: 'plain', name: 'Plain', amount: 10_000 },
    ];
    expect(uniquePlans(plans, 'test').map((plan) => plan.code)).toEqual(['vt-5000', 'plain']);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('classify', () => {
  it('reads the inner status when the code is 000', () => {
    expect(classify(ok('delivered'))).toMatchObject({ outcome: 'delivered', providerTransactionId: 'VT1', cost: 1_930 });
    expect(classify(ok('pending')).outcome).toBe('pending');
    expect(classify(ok('initiated')).outcome).toBe('pending');
    expect(classify(ok('failed')).outcome).toBe('failed');
    expect(classify({ code: '040', content: { transactions: { status: 'reversed' } } }).outcome).toBe('failed');
  });

  it('treats processing codes as pending, rejections as failed, and anything else as unknown', () => {
    for (const code of ['099', '089', '083', '044', '014']) expect(classify({ code }).outcome).toBe('pending');
    for (const code of ['016', '018', '019', '027', '085', '087', '091']) expect(classify({ code }).outcome).toBe('failed');
    expect(classify({ code: '015' }).outcome).toBe('not_found');
    expect(classify({ code: '777' }).outcome).toBe('unknown');
    expect(classify({}).outcome).toBe('unknown');
  });

  it('strips the "Token :" / "Pin :" prefix and collects multi-PIN cards', () => {
    expect(classify(ok('delivered', { tokens: ['0100070365657400875'], purchased_code: 'Token: 0100070365657400875' })).token).toBe('0100070365657400875');
    expect(classify(ok('delivered', { purchased_code: 'Token : 26362054405982757802', units: '79.9 kWh' }))).toMatchObject({
      token: '26362054405982757802',
      units: '79.9 kWh',
    });
    expect(classify(ok('delivered', { Pin: 'Pin : 3678251321392432' })).token).toBe('3678251321392432');
    expect(classify(ok('delivered', { cards: [{ Serial: 'WRN1', Pin: '0987' }, { serialNumber: 'S2', pin: '1234' }] })).pins).toEqual([
      { pin: '0987', serial: 'WRN1' },
      { pin: '1234', serial: 'S2' },
    ]);
  });
});

describe('VTpass calls', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (json: unknown, status = 200) => {
    const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status }));
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('makes request ids that start with the Lagos date and time', () => {
    // 23:30 UTC is already 00:30 the next day in Lagos.
    expect(vt.newRequestId(new Date('2026-10-28T23:30:00Z'))).toMatch(/^202610290030[0-9A-Z]{12}$/);
  });

  it('uses the secret key on POST and the public key on GET, and sends naira', async () => {
    let fn = stub(ok('delivered'));
    await vt.vend({ requestId: 'R1', serviceID: 'mtn', amount: 10_000, phone: '08011111111' });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('https://vt.test/api/pay');
    expect(init.headers).toMatchObject({ 'api-key': 'api', 'secret-key': 'SK_x' });
    expect(JSON.parse(init.body)).toEqual({ request_id: 'R1', serviceID: 'mtn', phone: '08011111111', amount: 100 });

    fn = stub({ response_description: '000', content: { variations: [{ variation_code: 'gotv-lite', name: 'GOtv Lite', variation_amount: '400.00' }] } });
    expect(await vt.plans('gotv')).toEqual([{ code: 'gotv-lite', name: 'GOtv Lite', amount: 40_000 }]);
    expect(fn.mock.calls[0]![1].headers).toMatchObject({ 'public-key': 'PK_x' });
  });

  it('never calls an outage a failure', async () => {
    stub({ message: 'bad gateway' }, 502);
    expect((await vt.vend({ requestId: 'R2', serviceID: 'mtn', amount: 10_000, phone: '0801' })).outcome).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect((await vt.requery('R2')).outcome).toBe('unknown');
  });

  it('verifies meters and rejects wrong ones as a user-facing 422', async () => {
    stub({ code: '000', content: { Customer_Name: 'TESTMETER1', Address: 'ABULE  EGBA', Meter_Type: 'PREPAID', WrongBillersCode: false, Min_Purchase_Amount: 1000 } });
    expect(await vt.verifyMeter('ikeja-electric', '1111111111111', 'prepaid')).toEqual({
      name: 'TESTMETER1',
      address: 'ABULE EGBA',
      detail: { label: 'Meter type', value: 'Prepaid' },
      minAmount: 100_000,
    });
    stub({ code: '000', content: { error: 'This meter is not correct' } });
    await expect(vt.verifyMeter('ikeja-electric', '1', 'prepaid')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_VERIFIED' });
    stub({ code: '030' });
    await expect(vt.verifyMeter('ikeja-electric', '1', 'prepaid')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('reads each kind of account from its own fields', async () => {
    stub({ code: '000', content: { Customer_Name: 'CHIDI  OKAFOR', Current_Bouquet: 'DStv Compact', Renewal_Amount: 15700 } });
    expect(await vt.verifySmartCard('dstv', '7034567890')).toEqual({
      name: 'CHIDI OKAFOR',
      currentPlan: 'DStv Compact',
      detail: { label: 'Current plan', value: 'DStv Compact' },
    });
    stub({ code: '000', content: { Customer_Name: 'Capital James' } });
    expect(await vt.verifyJamb('jamb', '0123456789', 'utme-mock')).toEqual({ name: 'Capital James' });
    stub({ code: '000', content: { Customer_Name: 'ADA', AccountList: { Account: [] } } });
    await expect(vt.verifySmile('smile-direct', 'ada@example.com')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_VERIFIED' });
  });

  it("passes on VTpass's reason for a wrong meter, or our own line if it gives none", async () => {
    const reason = 'This meter is not correct or is not a valid Abuja prepaid meter. Please check and try again';
    stub({ code: '000', content: { error: reason, WrongBillersCode: true } });
    await expect(vt.verifyMeter('abuja-electric', '1', 'prepaid')).rejects.toMatchObject({
      statusCode: 422,
      code: 'ACCOUNT_NOT_VERIFIED',
      message: reason,
    });
    stub({ code: '000', content: { WrongBillersCode: true } });
    await expect(vt.verifyMeter('abuja-electric', '1', 'prepaid')).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_VERIFIED',
      message: "We couldn't verify this account with the provider. Check the number and try again.",
    });
  });

  it('returns the Smile account id to pay into', async () => {
    const fn = stub({ code: '000', content: { Customer_Name: 'Ada Obi', AccountList: { Account: [{ AccountId: 1402000567, FriendlyName: 'Home' }] } } });
    expect(await vt.verifySmile('smile-direct', 'ada@example.com')).toMatchObject({
      name: 'Ada Obi',
      billersCode: '1402000567',
    });
    expect(fn.mock.calls[0]![0]).toBe('https://vt.test/api/merchant-verify/smile/email');
  });

  it('parses transaction and variation webhooks', () => {
    expect(vt.parseWebhook(JSON.stringify({ type: 'transaction-update', data: { requestId: '2026102812001ABC', code: '000' } }))).toEqual({
      kind: 'transaction',
      requestId: '2026102812001ABC',
    });
    expect(vt.parseWebhook(JSON.stringify({ type: 'variations-update', data: { serviceID: 'dstv' } }))).toEqual({ kind: 'variations', serviceID: 'dstv' });
    expect(vt.parseWebhook('nope')).toBeNull();
  });
});
