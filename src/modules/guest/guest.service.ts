import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, forbidden, notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { formatNaira } from '../../lib/money';
import { getQueue } from '../../lib/queue';
import { newReference } from '../../lib/references';
import { localPhone, type ServiceId } from '../../lib/schemas';
import { Catalog } from '../bills/bills.catalog';
import { BillsService, verifyBillAccount } from '../bills/bills.service';
import { ConfigService, billFeature } from '../config/config.service';
import { NOTIFY_QUEUE } from '../notifications/notifications.service';
import { env } from '../../config/env';
import { guestOrderEmail } from './guest.email';
import { TransactionModel, type ITransaction } from '../transactions/models/transaction.model';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { GUEST_DAILY_ORDERS, GUEST_MAX_TOTAL, GUEST_SERVICES, type CreateGuestOrderInput } from './guest.schema';
import { GuestOrderModel, type IGuestOrder } from './models/guest-order.model';

export const GUEST_QUEUE = 'guest';
/** Tries at buying the bill (VTpass down, say) before the order gives up and the money stays in the wallet. */
const MAX_PAY_ATTEMPTS = 3;
/** Funded but not bought after this long: the sweep tries again. */
const PAY_RETRY_AFTER_MS = 5 * 60_000;

const masked = (phone: string) => {
  const local = localPhone(phone);
  return `${local.slice(0, 4)}****${local.slice(-3)}`;
};

const sameKey = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** What the buyer gets: the PIN, token or confirmation, from the bill transaction. */
const resultOf = (bill: ITransaction | null) =>
  bill && bill.status === 'success'
    ? {
        reference: bill.reference,
        token: bill.bill?.token ?? null,
        units: bill.bill?.units ?? null,
        pins: bill.bill?.pins?.map((p) => ({ pin: p.pin, serial: p.serial ?? null })) ?? [],
      }
    : null;

async function orderDto(order: IGuestOrder) {
  const [funding, bill] = await Promise.all([
    TransactionModel.findById(order.funding).lean(),
    order.billTransaction ? TransactionModel.findById(order.billTransaction).lean() : null,
  ]);
  const provider = Catalog.providers(order.bill.serviceId).find((p) => p.code === order.bill.provider);
  return {
    reference: order.reference,
    status: order.status,
    bill: {
      serviceId: order.bill.serviceId,
      provider: order.bill.provider,
      providerName: provider?.name ?? order.bill.provider,
      account: order.bill.account,
      planName: order.bill.planName ?? null,
      customerName: order.bill.customerName ?? null,
    },
    /** Kobo. */
    amount: order.amount,
    fee: order.fee,
    total: order.total,
    phone: masked(order.phone),
    /** Where to send the transfer, while it's still awaited. */
    payTo:
      order.status === 'awaiting_payment' && funding?.funding?.accountNumber
        ? {
            accountNumber: funding.funding.accountNumber,
            bankName: funding.funding.bankName,
            accountName: funding.funding.accountName,
            expiresAt: funding.funding.expiresAt?.toISOString() ?? null,
            /** Past it the account may stop taking transfers; one that already went through is still picked up. */
            expired: funding.status === 'expired',
          }
        : null,
    result: resultOf(bill as ITransaction | null),
    failureReason: order.failureReason ?? null,
    /** Kobo the transfer put in the phone number's Tela wallet, for a failed order. */
    inWallet: order.status === 'failed' && funding?.status === 'success' ? funding.amount : 0,
    createdAt: order.createdAt.toISOString(),
  };
}

/** The SMS a buyer gets: their PIN or token, or where their money is. */
function textFor(order: IGuestOrder, bill: ITransaction | null, inWallet: number) {
  if (order.status === 'delivered') {
    const b = bill?.bill;
    if (b?.pins?.length) return `Tela: your ${order.bill.planName ?? order.bill.provider} PIN${b.pins.length > 1 ? 's' : ''}: ${b.pins.map((p) => p.pin).join(', ')}. Ref ${bill!.reference}. Keep this message.`;
    if (b?.token) return `Tela: ${b.token.replace(/^Token\s*:\s*/i, 'Token ')}${b.units ? ` (${b.units})` : ''} for meter ${order.bill.account}. Ref ${bill!.reference}.`;
    return `Tela: your ${formatNaira(order.amount)} ${order.bill.provider} ${order.bill.serviceId === 'airtime' ? 'top-up' : 'payment'} for ${order.bill.account} went through. Ref ${bill?.reference ?? order.reference}.`;
  }
  return `Tela: we couldn't complete your ${order.bill.provider} payment. ${inWallet > 0 ? `${formatNaira(inWallet)} is safe in a Tela wallet for this number: download Tela and sign up with ${localPhone(order.phone)} to use it.` : 'No money was taken.'} Ref ${order.reference}.`;
}

export const GuestService = {
  /** The bills that can be bought here, with their providers, honouring what's switched off. */
  async services() {
    const { features } = await ConfigService.publicConfig();
    return Catalog.services()
      .filter((s) => (GUEST_SERVICES as readonly string[]).includes(s.id))
      .map((s) => {
        const paused = [features.guest_pay, features.bills, features[billFeature(s.id)]].find((f) => !f.enabled);
        return { ...s, available: s.available && !paused, pausedMessage: paused?.message ?? null };
      });
  },

  /** Who the meter, profile or number belongs to, before anything is ordered. */
  async verify(input: { serviceId: ServiceId; provider: string; account: string; meterType?: 'prepaid' | 'postpaid'; planCode?: string | undefined }) {
    const provider = Catalog.resolveProvider(input.serviceId, input.provider);
    const verified = await verifyBillAccount(input.serviceId, provider, input.account, { meterType: input.meterType, planCode: input.planCode });
    return { account: verified.account, customer: verified.customer ?? null };
  },

  /**
   * Prices the bill (checking the meter or profile) for the phone number's wallet, and issues a
   * one-time account for the total. Nothing is bought until that transfer is confirmed.
   */
  async create(input: CreateGuestOrderInput) {
    await ConfigService.assertEnabled('guest_pay', 'funding', 'bills', billFeature(input.bill.serviceId));
    const today = await GuestOrderModel.countDocuments({ phone: input.phone, createdAt: { $gt: new Date(Date.now() - 24 * 3_600_000) } });
    if (today >= GUEST_DAILY_ORDERS) {
      throw new AppError(429, 'You’ve made a few orders today. Use the Tela app for more, or try again tomorrow.', 'GUEST_DAILY_LIMIT');
    }
    // The phone number's Tela account: theirs already, or one they claim by signing up with it.
    const { user } = await UsersService.findOrCreate({ type: 'phone', value: input.phone });
    if (user.status !== 'active') throw forbidden('This number can’t pay on the website. Contact Tela support.');

    const priced = await BillsService.quote(user.id as string, { kind: 'bill', ...input.bill, autoApply: false });
    if (priced.total > GUEST_MAX_TOTAL) {
      throw unprocessable(`Pay up to ${formatNaira(GUEST_MAX_TOTAL)} on the website. For more, use the Tela app.`, 'GUEST_AMOUNT_LIMIT');
    }
    const fundingQuote = await WalletService.quote(user.id as string, priced.total);
    const funding = await WalletService.startFunding(user.id as string, fundingQuote.id);
    const accessKey = randomBytes(24).toString('hex');
    const order = await GuestOrderModel.create({
      reference: newReference('guest_order'),
      user: user._id,
      phone: input.phone,
      ...(input.email && { email: input.email }),
      bill: {
        serviceId: priced.bill!.serviceId,
        provider: priced.bill!.provider,
        account: priced.bill!.account,
        product: priced.bill!.product,
        meterType: priced.bill!.meterType,
        planCode: priced.bill!.planCode,
        planName: priced.bill!.planName,
        customerName: priced.bill!.customer?.name,
      },
      amount: priced.amount,
      // The bill's charge plus any on the transfer: what the buyer pays on top of the bill.
      fee: priced.fee + fundingQuote.fee,
      total: funding.total,
      funding: funding.id,
      accessKey,
    });
    // Its transactions say where they came from, so the back office can tell them apart.
    await TransactionModel.updateOne({ _id: funding.id }, { channel: 'web', guestOrder: order._id });
    return { ...(await orderDto(order)), key: accessKey };
  },

  /**
   * The status page: checks the transfer with SaySwitch while it's awaited (throttled), so the
   * page moves on even if a webhook is late.
   */
  async get(reference: string, key: string) {
    const order = await GuestOrderModel.findOne({ reference }).select('+accessKey');
    if (!order || !sameKey(order.accessKey, key)) throw notFound('Order not found');
    if (order.status === 'awaiting_payment') {
      const funding = await TransactionModel.findById(order.funding).select('reference');
      const after = funding && (await WalletService.getFunding(order.user.toString(), funding.reference));
      if (after?.status === 'success') await this.onFunded(order.funding.toString());
    }
    return orderDto((await GuestOrderModel.findById(order._id))!);
  },

  /** The transfer is in the wallet: claim the order and buy the bill on the queue. */
  async onFunded(fundingId: string) {
    const order = await GuestOrderModel.findOneAndUpdate({ funding: fundingId, status: 'awaiting_payment' }, { status: 'paying' }, { new: true });
    if (!order) return;
    await getQueue(GUEST_QUEUE).add('guest.pay', { orderId: order.id }, { jobId: `guest-pay-${order.id as string}`, attempts: 1 });
  },

  /**
   * Buys the bill from the wallet the transfer funded, priced again first: if the price moved,
   * nothing is bought and the money stays in the wallet. Safe to call more than once.
   */
  async payBill(orderId: string) {
    const order = await GuestOrderModel.findOneAndUpdate({ _id: orderId, status: 'paying', billTransaction: null }, { $inc: { payAttempts: 1 } }, { new: true });
    if (!order) return;
    try {
      const priced = await BillsService.quote(order.user.toString(), {
        kind: 'bill',
        serviceId: order.bill.serviceId,
        provider: order.bill.provider,
        account: order.bill.account,
        product: order.bill.product ?? 'airtime',
        meterType: order.bill.meterType ?? 'prepaid',
        ...(order.bill.planCode ? { planCode: order.bill.planCode } : { amount: order.amount }),
        autoApply: false,
      });
      if (priced.amount !== order.amount) return await this.fail(order.id as string, 'The price changed before we could pay it.');
      // Only this order's own transfer pays for it, never anything else in the wallet: the number
      // could be someone else's, with money of their own in it.
      const funding = await TransactionModel.findById(order.funding).select('status amount');
      if (funding?.status !== 'success' || funding.amount < priced.total) {
        return await this.fail(order.id as string, 'The transfer was less than the total, so nothing was bought.');
      }
      const tx = await BillsService.purchase(order.user.toString(), priced.id as string, { system: true });
      await GuestOrderModel.updateOne({ _id: order._id }, { billTransaction: tx.id });
      await TransactionModel.updateOne({ _id: tx.id }, { channel: 'web', guestOrder: order._id });
      return await this.onBillResult(tx.id);
    } catch (err) {
      // Not as far as a bill (VTpass or bills down, the wallet short of a part-payment): try again, then stop.
      if (order.payAttempts >= MAX_PAY_ATTEMPTS || (err instanceof AppError && err.statusCode < 500)) {
        return this.fail(order.id as string, err instanceof AppError && err.statusCode < 500 ? err.message : 'We couldn’t reach the provider.');
      }
      throw err;
    }
  },

  /** The bill's outcome decides the order. A failed bill already refunded the wallet. */
  async onBillResult(transactionId: string) {
    const tx = await TransactionModel.findById(transactionId);
    if (!tx) return;
    const order = await GuestOrderModel.findOne({ billTransaction: tx._id });
    if (!order) return;
    if (tx.status === 'success') {
      const done = await GuestOrderModel.findOneAndUpdate({ _id: order._id, status: 'paying' }, { status: 'delivered' }, { new: true });
      if (done) await this.settled(done, tx);
    }
    if (tx.status === 'failed') await this.fail(order.id as string, 'The provider didn’t accept the payment.');
  },

  async fail(orderId: string, reason: string) {
    const done = await GuestOrderModel.findOneAndUpdate({ _id: orderId, status: { $in: ['awaiting_payment', 'paying'] } }, { status: 'failed', failureReason: reason }, { new: true });
    if (done) await this.settled(done, null);
  },

  /** Text them what they paid for (or where their money is), and tell the rest of Tela. */
  async settled(order: IGuestOrder, bill: ITransaction | null) {
    const funding = await TransactionModel.findById(order.funding).select('status amount').lean();
    const inWallet = order.status === 'failed' && funding?.status === 'success' ? funding.amount : 0;
    const text = textFor(order, bill, inWallet);
    const queue = getQueue(NOTIFY_QUEUE);
    await queue
      .add('sms', { to: order.phone, body: text }, { jobId: `guest-sms-${order._id.toString()}-${order.status}`, attempts: 3 })
      .catch((err) => console.error(`[guest] sms ${order.reference}`, err));
    if (order.email) {
      // The order page link carries its secret key: this email is the buyer's own.
      const withKey = await GuestOrderModel.findById(order._id).select('+accessKey').lean();
      const site = env.SITE_URL.replace(/\/$/, '');
      const { subject, html } = guestOrderEmail(order, bill, inWallet, { order: `${site}/pay/order/${order.reference}?key=${withKey?.accessKey ?? ''}`, site });
      await queue
        .add('email', { to: order.email, subject, text, html }, { jobId: `guest-email-${order._id.toString()}-${order.status}`, attempts: 3 })
        .catch((err) => console.error(`[guest] email ${order.reference}`, err));
    }
    bus.emit('guest.order', { orderId: order._id.toString(), stage: order.status === 'delivered' ? 'delivered' : 'failed' });
  },

  /** Safety net: funded orders whose bill job was lost or failed for a moment. */
  async sweep() {
    const stuck = await GuestOrderModel.find({ status: 'paying', billTransaction: null, createdAt: { $lt: new Date(Date.now() - PAY_RETRY_AFTER_MS) } })
      .select('_id')
      .limit(100);
    for (const o of stuck) await this.payBill(o.id as string).catch((err) => console.error(`[guest] pay ${o.id}`, err));
  },
};
