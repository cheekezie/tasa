import type { Types } from 'mongoose';
import { env } from '../../config/env';
import { inTransaction } from '../../lib/db';
import { notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { formatNaira } from '../../lib/money';
import { getQueue } from '../../lib/queue';
import { newReference } from '../../lib/references';
import { NigerianPhoneSchema, localPhone, type ServiceId } from '../../lib/schemas';
import { BeneficiaryModel } from '../beneficiaries/models/beneficiary.model';
import { ChargesService } from '../charges/charges.service';
import { CouponsService } from '../coupons/coupons.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import type { IQuote } from '../quotes/models/quote.model';
import { QuotesService, toQuoteDto } from '../quotes/quotes.service';
import { TransactionModel, type ITransaction, type TransactionDoc } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { UserModel } from '../users/models/user.model';
import { UsersService, publicName } from '../users/users.service';
import { recipientLabel, type Recipient } from '../../lib/schemas';
import { PinService } from '../users/pin.service';
import { Catalog, SERVICES, type ProviderEntry } from './bills.catalog';
import type { BillQuoteInput } from './bills.schema';
import { biller } from './providers';
import type { VendRequest, VendResult, VerifiedCustomer } from './providers/biller';
import { ConfigService, billFeature } from '../config/config.service';
import { QuoteModel } from '../quotes/models/quote.model';

export const BILLS_QUEUE = 'bills';

/** Requery delays after a pending/unknown vend. After the last one, staff review it. */
export const REQUERY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];

/**
 * "VTpass has no record of this request" is only trustworthy once the original request
 * can't still be on its way to them.
 */
export const NOT_FOUND_GRACE_MS = 5 * 60_000;

const AIRTIME_MAX = 5_000_000; // ₦50,000
const ELECTRICITY_MIN = 50_000; // ₦500
const BILL_MAX = 100_000_000; // ₦1,000,000

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

type BillSpec = NonNullable<IQuote['bill']>;

/** What VTpass's /pay needs for one of our bills. */
function vendRequest(requestId: string, bill: NonNullable<ITransaction['bill']>, amount: number, customerPhone: string): VendRequest {
  const serviceID = bill.serviceID ?? Catalog.serviceIDFor(bill.serviceId, bill.provider, bill.product);
  const base = { requestId, serviceID, phone: customerPhone };
  const bouquet = { ...base, billersCode: bill.account, variationCode: bill.planCode, subscriptionType: 'change' as const, amount, quantity: 1 };
  switch (bill.serviceId) {
    case 'airtime':
      return bill.product === 'data'
        ? { ...base, billersCode: bill.account, variationCode: bill.planCode, phone: bill.account }
        : { ...base, amount, phone: bill.account };
    case 'electricity':
      return { ...base, billersCode: bill.account, variationCode: bill.meterType ?? 'prepaid', amount };
    case 'tv':
      // Only DStv and GOtv take a subscription type. Paying for the same package renews it.
      return bill.provider !== 'DSTV' && bill.provider !== 'GOTV'
        ? { ...base, billersCode: bill.account, variationCode: bill.planCode, amount }
        : bouquet;
    case 'internet':
    case 'jamb':
      return { ...base, billersCode: bill.billersCode ?? bill.account, variationCode: bill.planCode, amount, quantity: 1 };
    default:
      throw unprocessable('This service is not available yet', 'SERVICE_UNAVAILABLE');
  }
}

/** "Pay their bill": who it's for. Paying your own bill isn't a gift. */
async function resolveBillGift(senderId: string, r: Recipient, message?: string) {
  const user = await UsersService.resolve(r);
  if (user?.id === senderId) throw unprocessable("That's you — pay it as a normal bill", 'SELF_GIFT');
  if (!user && r.type === 'username') throw notFound(`There's no Tela user @${r.value}`);
  return {
    label: recipientLabel(r),
    ...(user ? { user: user._id, name: publicName(user) } : r.type === 'phone' ? { phone: r.value } : { email: r.value }),
    ...(message && { message }),
  };
}

export type PurchaseOptions = {
  /** Required for user-initiated purchases. */
  pin?: string;
  /** Recurring runs and beneficiary auto-pay: the user authorised them when setting up. */
  system?: boolean;
  recurringId?: Types.ObjectId;
  /** Save this account as a beneficiary once the bill succeeds. */
  saveBeneficiary?: { label: string } | undefined;
  /** A split bill: paid from the split's pot, not the starter's wallet, and refunded there if it fails. */
  split?: { id: Types.ObjectId; title: string; pot: string };
};

/**
 * Who a bill account belongs to, checked with VTpass before anything is priced or saved: a
 * meter (with its type), a smart card, a Smile email, a JAMB profile. Phone-based services
 * only need a valid number. Returns the account as it should be stored.
 */
export async function verifyBillAccount(
  serviceId: ServiceId,
  provider: ProviderEntry,
  input: string,
  opts: { meterType?: 'prepaid' | 'postpaid' | undefined; planCode?: string | undefined } = {},
): Promise<{ account: string; customer?: VerifiedCustomer; billersCode?: string }> {
  const asPhone = () => {
    const phone = NigerianPhoneSchema.safeParse(input);
    if (!phone.success) throw unprocessable('Enter a valid Nigerian phone number', 'INVALID_ACCOUNT');
    return { account: localPhone(phone.data) };
  };
  switch (serviceId) {
    case 'airtime':
      return asPhone();
    case 'electricity': {
      if (!/^\d{6,20}$/.test(input)) throw unprocessable('Enter a valid meter number', 'INVALID_ACCOUNT');
      if (!opts.meterType) throw unprocessable('Choose prepaid or postpaid', 'METER_TYPE_REQUIRED');
      return { account: input, customer: await biller.verifyMeter(provider.serviceID, input, opts.meterType) };
    }
    case 'tv':
      return provider.verify ? { account: input, customer: await biller.verifySmartCard(provider.serviceID, input) } : { account: input };
    case 'internet': {
      if (provider.code !== 'SMILE') return asPhone();
      if (!isEmail(input)) throw unprocessable('Enter the email on your Smile account', 'INVALID_ACCOUNT');
      const account = input.toLowerCase();
      const smile = await biller.verifySmile(provider.serviceID, account);
      return { account, customer: smile, billersCode: smile.billersCode };
    }
    case 'jamb':
      // WAEC sells PINs: nothing to verify, the phone is just where they go.
      return provider.code === 'JAMB' ? { account: input, customer: await biller.verifyJamb(provider.serviceID, input, opts.planCode) } : asPhone();
    default:
      throw unprocessable('This service is not available yet', 'SERVICE_UNAVAILABLE');
  }
}

export const BillsService = {
  /**
   * Prices a bill: verifies the meter / smart card / profile with VTpass, resolves plan
   * prices, applies a coupon and our charges. Nothing is debited.
   */
  async quote(userId: string, input: BillQuoteInput) {
    const service = SERVICES[input.serviceId];
    if (!service.available) throw unprocessable(`${service.name} payments are coming soon`, 'SERVICE_UNAVAILABLE');
    const provider = Catalog.resolveProvider(input.serviceId, input.provider);

    if (input.beneficiaryId && !(await BeneficiaryModel.exists({ _id: input.beneficiaryId, user: userId, archivedAt: null }))) {
      throw notFound('Beneficiary not found');
    }

    let account = input.account;
    let amount = input.amount ?? 0;
    let customer: VerifiedCustomer | undefined;
    const bill: BillSpec = { serviceId: input.serviceId, provider: provider.code, account };
    const usePlan = async (product?: 'airtime' | 'data') => {
      if (!input.planCode) throw unprocessable('Choose a plan', 'PLAN_REQUIRED');
      const plan = await Catalog.plan(input.serviceId, provider.code, input.planCode, product);
      amount = plan.amount;
      Object.assign(bill, { planCode: plan.code, planName: plan.name, ...(plan.serviceID && { serviceID: plan.serviceID }) });
    };
    // The account is checked with VTpass the same way when a beneficiary is saved.
    const verified = await verifyBillAccount(input.serviceId, provider, input.account, { meterType: input.meterType, planCode: input.planCode });
    account = verified.account;
    customer = verified.customer;
    if (verified.billersCode) bill.billersCode = verified.billersCode;

    switch (input.serviceId) {
      case 'airtime': {
        bill.product = input.product;
        if (input.product === 'data') await usePlan('data');
        else {
          if (amount < (provider.minAmount ?? 5_000)) throw unprocessable(`The minimum top-up is ${formatNaira(provider.minAmount ?? 5_000)}`, 'AMOUNT_TOO_LOW');
          if (amount > AIRTIME_MAX) throw unprocessable(`The maximum top-up is ${formatNaira(AIRTIME_MAX)}`, 'AMOUNT_TOO_HIGH');
        }
        break;
      }
      case 'electricity': {
        bill.meterType = input.meterType;
        const min = Math.max(customer?.minAmount ?? 0, provider.minAmount ?? 0, ELECTRICITY_MIN);
        if (amount < min) throw unprocessable(`The minimum for ${provider.name} is ${formatNaira(min)}`, 'AMOUNT_TOO_LOW');
        break;
      }
      case 'tv':
      case 'internet':
      case 'jamb':
        await usePlan();
        break;
    }
    if (amount <= 0) throw unprocessable('Enter an amount', 'AMOUNT_REQUIRED');
    if (amount > BILL_MAX) throw unprocessable(`The maximum for one bill is ${formatNaira(BILL_MAX)}`, 'AMOUNT_TOO_HIGH');
    bill.account = account;
    if (customer) bill.customer = { name: customer.name, address: customer.address, detail: customer.detail };

    // Charges are priced on the full bill; a discount never shrinks our charge.
    const { charges, fee } = await ChargesService.compute({ scope: 'bill', serviceId: input.serviceId, provider: provider.code }, amount);

    // One code per bill: the one typed; otherwise whichever takes more off — the user's own
    // gift/coupon balance (soonest-expiring) or an auto-apply promo. A tie goes to the promo,
    // which saves the user's gift money for later.
    const ctx = { serviceId: input.serviceId, provider: provider.code, amount, fee };
    let applied: Awaited<ReturnType<typeof CouponsService.evaluate>> | null = null;
    if (input.couponCode) applied = await CouponsService.evaluate(input.couponCode, userId, ctx);
    else if (input.autoApply) {
      const [balance, promo] = await Promise.all([CouponsService.bestBalance(userId, ctx), CouponsService.bestAutoPromo(userId, ctx)]);
      applied = balance && (!promo || balance.discount > promo.discount) ? balance : promo;
    }
    const discount = applied?.discount ?? 0;
    const coupon: IQuote['coupon'] = applied
      ? {
        id: applied.coupon._id,
        code: applied.coupon.code,
        kind: applied.coupon.kind,
        fundedBy: applied.coupon.kind === 'promo' ? 'tela' : applied.coupon.fundedBy,
        title: applied.coupon.title,
        auto: !input.couponCode,
      }
      : undefined;
    const giftTo = input.giftTo ? await resolveBillGift(userId, input.giftTo, input.giftMessage) : undefined;

    return QuotesService.create(userId, {
      kind: 'bill',
      amount,
      charges,
      fee,
      discount,
      bill,
      ...(giftTo && { giftTo }),
      ...(coupon && { coupon }),
      ...(input.beneficiaryId && { beneficiary: input.beneficiaryId as unknown as Types.ObjectId }),
    });
  },

  async quoteDto(userId: string, input: BillQuoteInput) {
    return toQuoteDto(await this.quote(userId, input));
  },

  /**
   * Debits the wallet (the money moves to `bills:in_flight`), then asks VTpass to vend.
   * The debit and the vend are separate on purpose: we never hold a DB transaction open
   * across a network call, and the money is already safe in in-flight if we crash.
   */
  async purchase(userId: string, quoteId: string, opts: PurchaseOptions) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return toTransactionDto(existing);
    if (opts.system) await PinService.assertCanSpend(userId);
    else await PinService.authorizeBill(userId, opts.pin);
    const priced = await QuoteModel.findOne({ _id: quoteId, user: userId }).select('bill.serviceId').lean();
    await ConfigService.assertEnabled('bills', ...(priced?.bill?.serviceId ? [billFeature(priced.bill.serviceId)] : []));

    const tx = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'bill', session);
      const bill = quote.bill!;
      const [created] = await TransactionModel.create(
        [
          {
            reference: newReference('bill'),
            user: userId,
            kind: 'bill',
            direction: 'debit',
            amount: quote.amount,
            fee: quote.fee,
            discount: quote.discount,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            bill: {
              serviceId: bill.serviceId,
              provider: bill.provider,
              account: bill.account,
              product: bill.product,
              meterType: bill.meterType,
              planCode: bill.planCode,
              planName: bill.planName,
              billersCode: bill.billersCode,
              serviceID: bill.serviceID,
              customerName: bill.customer?.name,
            },
            ...(quote.coupon?.code && {
              coupon: { id: quote.coupon.id, code: quote.coupon.code, kind: quote.coupon.kind, fundedBy: quote.coupon.fundedBy },
            }),
            ...(quote.beneficiary && { beneficiary: quote.beneficiary }),
            ...(quote.giftTo?.label && { giftTo: quote.giftTo }),
            ...(opts.recurringId && { recurring: opts.recurringId }),
            ...(opts.saveBeneficiary && { saveBeneficiary: opts.saveBeneficiary }),
            ...(opts.split && { fundedFrom: opts.split.pot, split: { id: opts.split.id, title: opts.split.title } }),
            events: [{ type: 'created', at: new Date(), note: opts.system ? 'Automatic payment' : undefined }],
          },
        ],
        { session },
      );
      const t = created!;
      if (quote.coupon?.id && quote.discount > 0) {
        await CouponsService.redeem(quote.coupon, userId, t._id, quote.discount, session);
      }
      await LedgerService.post(
        {
          key: `bill:${t.reference}:debit`,
          memo: `Bill ${t.reference}`,
          transactionId: t._id,
          lines: [
            { account: opts.split?.pot ?? Accounts.wallet(userId), amount: quote.total },
            // A user's coupon pool pays its discount; Tela promos and giveaways are expenses.
            ...(quote.coupon?.id ? [{ account: CouponsService.discountAccount(quote.coupon), amount: quote.discount }] : []),
            { account: Accounts.billsInFlight, amount: -quote.amount },
            { account: Accounts.charges('bill', bill.serviceId), amount: -quote.fee },
          ],
        },
        session,
      );
      return t;
    });

    return toTransactionDto(await this.vend(tx));
  },

  /**
   * Sends the bill to VTpass exactly once. The request id is saved *before* the call, so a
   * crash or timeout mid-request can always be requeried.
   */
  async vend(tx: TransactionDoc) {
    const user = await UserModel.findById(tx.user).select('phone');
    const requestId = biller.newRequestId();
    const claimed = await TransactionModel.findOneAndUpdate(
      { _id: tx._id, status: 'pending', 'providerData.requestId': { $exists: false } },
      {
        'providerData.requestId': requestId,
        'providerData.sentAt': new Date(),
        $inc: { vendAttempts: 1 },
        $push: { events: { type: 'vend_sent', at: new Date(), note: requestId } },
      },
      { new: true },
    );
    if (!claimed) return (await TransactionModel.findById(tx._id))!;
    // VTpass needs a customer phone; email-only users get the business number.
    const customerPhone = user?.phone ? localPhone(user.phone) : (env.BUSINESS_PHONE ?? '');
    const result = await biller.vend(vendRequest(requestId, claimed.bill!, claimed.amount, customerPhone));
    return this.applyVendResult(claimed._id, result, 'vend');
  },

  /**
   * The single place a bill's outcome is decided. Idempotent: status moves out of
   * `pending` once, by compare-and-set, in the same transaction as its ledger posting.
   */
  async applyVendResult(
    txId: Types.ObjectId | string,
    result: VendResult,
    source: 'vend' | 'requery' | 'webhook' | 'admin',
    attempt = 0,
  ): Promise<TransactionDoc> {
    const current = await TransactionModel.findById(txId);
    if (!current) throw notFound('Transaction not found');
    if (current.status !== 'pending') return current;

    let outcome = result.outcome;
    if (outcome === 'not_found') {
      const sentAt = current.providerData?.sentAt?.getTime() ?? 0;
      // Never sent at all (crashed before the call) is as safe to refund as "VTpass never saw it".
      outcome = !current.providerData?.requestId || Date.now() - sentAt > NOT_FOUND_GRACE_MS ? 'failed' : 'unknown';
    }
    const note = `${source}: ${result.code ? `${result.code} ` : ''}${result.message ?? outcome}`.trim();
    const providerFields = {
      ...(result.providerTransactionId && { 'providerData.transactionId': result.providerTransactionId }),
      ...(result.code && { 'providerData.code': result.code }),
      ...(result.message && { 'providerData.message': result.message }),
    };

    if (outcome === 'delivered') {
      const done = await inTransaction(async (session) => {
        const t = await TransactionModel.findOneAndUpdate(
          { _id: txId, status: 'pending' },
          {
            status: 'success',
            needsReview: false,
            completedAt: new Date(),
            ...providerFields,
            ...(result.cost != null && { 'providerData.cost': result.cost }),
            ...(result.token && { 'bill.token': result.token }),
            ...(result.units && { 'bill.units': result.units }),
            ...(result.pins?.length && { 'bill.pins': result.pins }),
            $push: { events: { type: 'delivered', at: new Date(), note } },
          },
          { new: true, session },
        );
        if (!t) return null;
        // VTpass debits us face value minus its commission; the difference is ours.
        const cost = result.cost != null && result.cost > 0 ? result.cost : t.amount;
        await LedgerService.post(
          {
            key: `bill:${t.reference}:settle`,
            memo: `Bill ${t.reference} delivered`,
            transactionId: t._id,
            lines: [
              { account: Accounts.billsInFlight, amount: t.amount },
              { account: Accounts.biller, amount: -cost },
              { account: Accounts.commission(t.bill!.serviceId), amount: cost - t.amount },
            ],
          },
          session,
        );
        return t;
      });
      if (done) bus.emit('bill.succeeded', { transactionId: done.id });
      return done ?? (await TransactionModel.findById(txId))!;
    }

    if (outcome === 'failed') {
      const done = await inTransaction(async (session) => {
        const t = await TransactionModel.findOneAndUpdate(
          { _id: txId, status: 'pending' },
          {
            status: 'failed',
            needsReview: false,
            completedAt: new Date(),
            ...providerFields,
            $push: { events: { type: 'failed', at: new Date(), note } },
          },
          { new: true, session },
        );
        if (!t) return null;
        await LedgerService.post(
          {
            key: `bill:${t.reference}:refund`,
            memo: `Bill ${t.reference} failed — refunded`,
            transactionId: t._id,
            lines: [
              { account: t.fundedFrom ?? Accounts.wallet(t.user), amount: -t.total },
              ...(t.coupon?.id ? [{ account: CouponsService.discountAccount(t.coupon), amount: -t.discount }] : []),
              { account: Accounts.billsInFlight, amount: t.amount },
              { account: Accounts.charges('bill', t.bill!.serviceId), amount: t.fee },
            ],
          },
          session,
        );
        if (t.coupon?.id && t.discount > 0) await CouponsService.release(t.coupon, t._id, session);
        return t;
      });
      if (done) bus.emit('bill.failed', { transactionId: done.id });
      return done ?? (await TransactionModel.findById(txId))!;
    }

    // pending / unknown: the money stays in-flight until someone gets a final answer.
    // Webhook-triggered requeries don't advance the schedule.
    if (source === 'webhook') {
      await TransactionModel.updateOne({ _id: txId }, { ...providerFields, $push: { events: { type: 'awaiting_provider', at: new Date(), note } } });
      return (await TransactionModel.findById(txId))!;
    }
    const next = REQUERY_DELAYS_MS[attempt];
    const exhausted = next === undefined;
    const t = await TransactionModel.findByIdAndUpdate(
      txId,
      {
        ...providerFields,
        ...(exhausted && { needsReview: true }),
        $push: { events: { type: exhausted ? 'needs_review' : 'awaiting_provider', at: new Date(), note } },
      },
      { new: true },
    );
    if (!exhausted) {
      await getQueue(BILLS_QUEUE).add(
        'requery',
        { transactionId: String(txId), attempt: attempt + 1 },
        { delay: next, jobId: `requery-${String(txId)}-${attempt + 1}`, attempts: 1 },
      );
    }
    bus.emit('bill.pending', { transactionId: String(txId), attempt });
    return t!;
  },

  async requery(transactionId: string, attempt: number, source: 'requery' | 'webhook' = 'requery') {
    const tx = await TransactionModel.findById(transactionId);
    if (!tx || tx.status !== 'pending') return tx;
    // Debited but never sent (crash between debit and vend): send it now.
    if (!tx.providerData?.requestId) return this.vend(tx);
    const result = await biller.requery(tx.providerData.requestId);
    return this.applyVendResult(tx._id, result, source, attempt);
  },

  /**
   * Safety net for a process that died mid-flow: bills debited but never sent, and bills
   * whose requery schedule was lost. Runs every 5 minutes.
   */
  async sweepStuck() {
    const now = Date.now();
    const unsent = await TransactionModel.find({
      kind: 'bill',
      status: 'pending',
      'providerData.requestId': { $exists: false },
      createdAt: { $lt: new Date(now - 2 * 60_000) },
    }).limit(100);
    for (const t of unsent) await this.vend(t).catch((err) => console.error(`[bills] resend ${t.reference}`, err));

    // Older than the whole requery schedule and still not flagged: something dropped it.
    const scheduleMs = REQUERY_DELAYS_MS.reduce((s, d) => s + d, 0) + 30 * 60_000;
    const orphaned = await TransactionModel.find({
      kind: 'bill',
      status: 'pending',
      needsReview: false,
      'providerData.sentAt': { $lt: new Date(now - scheduleMs) },
    })
      .select('_id reference')
      .limit(100);
    for (const t of orphaned) {
      await this.requery(t.id, REQUERY_DELAYS_MS.length).catch((err) => console.error(`[bills] requery ${t.reference}`, err));
    }
  },

  /** A VTpass webhook only tells us *which* request changed; the requery says what happened. */
  async onProviderUpdate(requestId: string) {
    const tx = await TransactionModel.findOne({ 'providerData.requestId': requestId }).select('_id status');
    if (!tx) return null;
    return this.requery(tx.id, 0, 'webhook');
  },
};
