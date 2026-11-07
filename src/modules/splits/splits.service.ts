import { Types } from 'mongoose';
import { inTransaction } from '../../lib/db';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { getQueue } from '../../lib/queue';
import { newReference } from '../../lib/references';
import { BillsService } from '../bills/bills.service';
import { ChargesService } from '../charges/charges.service';
import { ConfigService, billFeature } from '../config/config.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { QuoteModel } from '../quotes/models/quote.model';
import { QuotesService, toQuoteDto } from '../quotes/quotes.service';
import { TransactionModel } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { UserModel } from '../users/models/user.model';
import { PinService } from '../users/pin.service';
import { publicName } from '../users/users.service';
import { SplitModel, type ISplit } from './models/split.model';
import { MAX_SPLIT_HOURS, type CreateSplitInput, type SplitShareQuoteInput } from './splits.schema';

export const SPLITS_QUEUE = 'splits';
/** A pot that's full but couldn't reach VTpass is tried again this many times, then refunded. */
const MAX_PAY_ATTEMPTS = 5;
/** How long a full pot waits on a bill attempt before the sweep looks at it again. */
const PAY_RETRY_AFTER_MS = 10 * 60_000;

/** Shares without an amount take an equal part of what's left; leftover kobo go to the first of them. */
function shareOut(total: number, shares: { amount?: number | undefined }[]) {
  const fixed = shares.reduce((sum, s) => sum + (s.amount ?? 0), 0);
  const open = shares.filter((s) => s.amount === undefined).length;
  if (open === 0) {
    if (fixed !== total) throw unprocessable('The shares must add up to the bill and its charge', 'SHARES_MISMATCH');
    return shares.map((s) => s.amount!);
  }
  const rest = total - fixed;
  if (rest < open) throw unprocessable('The shares come to more than the bill', 'SHARES_MISMATCH');
  const each = Math.floor(rest / open);
  let extra = rest - each * open;
  return shares.map((s) => s.amount ?? each + (extra-- > 0 ? 1 : 0));
}

/**
 * The bill the pot paid, for everyone in the split: they all paid for it, so they all see the
 * receipt, electricity token and units included (whoever's meter it is needs them).
 */
async function billResult(s: ISplit) {
  if (!s.billTransaction) return null;
  const tx = await TransactionModel.findById(s.billTransaction).select('status reference completedAt createdAt bill').lean();
  if (!tx) return null;
  return {
    status: tx.status,
    reference: tx.reference,
    paidAt: (tx.completedAt ?? tx.createdAt).toISOString(),
    customerName: tx.bill?.customerName ?? null,
    token: tx.bill?.token ?? null,
    units: tx.bill?.units ?? null,
    pins: tx.bill?.pins?.map((p) => ({ pin: p.pin, serial: p.serial ?? null })) ?? [],
  };
}

/** The other rounds of the same bill this person was in, newest first, each with its receipt. */
async function historyOf(s: ISplit, viewerId: string) {
  if (!s.series) return [];
  const rounds = await SplitModel.find({ series: s.series, _id: { $ne: s._id }, $or: [{ starter: viewerId }, { 'shares.user': viewerId }] })
    .sort({ createdAt: -1 })
    .limit(24);
  return Promise.all(
    rounds.map(async (r) => {
      const mine = r.shares.find((x) => x.user.toString() === viewerId);
      return {
        id: r._id.toString(),
        status: r.status,
        total: r.amount + r.fee,
        myShare: mine ? { amount: mine.amount, paid: Boolean(mine.paidAt), refunded: Boolean(mine.refundedAt) } : null,
        createdAt: r.createdAt.toISOString(),
        closedAt: r.closedAt?.toISOString() ?? null,
        result: await billResult(r),
      };
    }),
  );
}

async function splitDto(s: ISplit, viewerId: string, opts: { result?: boolean } = {}) {
  const users = await UserModel.find({ _id: { $in: [s.starter, ...s.shares.map((x) => x.user)] } }).select('fullName username').lean();
  const label = (id: Types.ObjectId) => {
    const u = users.find((x) => x._id.toString() === id.toString());
    return { id: id.toString(), name: u ? publicName(u) : 'A Tasa user', username: u?.username ?? null };
  };
  const mine = s.shares.find((x) => x.user.toString() === viewerId);
  return {
    id: s._id.toString(),
    title: s.title,
    status: s.status,
    starter: label(s.starter),
    isStarter: s.starter.toString() === viewerId,
    bill: { ...s.bill, product: s.bill.product ?? null, meterType: s.bill.meterType ?? null, planName: s.bill.planName ?? null, customerName: s.bill.customerName ?? null },
    amount: s.amount,
    fee: s.fee,
    total: s.amount + s.fee,
    /** Kobo paid in so far. */
    collected: s.shares.filter((x) => x.paidAt && !x.refundedAt).reduce((sum, x) => sum + x.amount, 0),
    shares: s.shares.map((x) => ({ ...label(x.user), amount: x.amount, paid: Boolean(x.paidAt), refunded: Boolean(x.refundedAt) })),
    myShare: mine ? { amount: mine.amount, paid: Boolean(mine.paidAt), refunded: Boolean(mine.refundedAt) } : null,
    deadline: s.deadline.toISOString(),
    billTransactionId: s.billTransaction?.toString() ?? null,
    /** On a single split only: the bill's receipt once the pot paid it. */
    ...(opts.result && { result: await billResult(s) }),
    closedReason: s.closedReason ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

async function visible(splitId: string, userId: string) {
  const split = await SplitModel.findById(splitId);
  if (!split || (split.starter.toString() !== userId && !split.shares.some((x) => x.user.toString() === userId))) throw notFound('Split not found');
  return split;
}

export const SplitsService = {
  /** Priced like the bill (verified meter, plan price, charge), then shared out. Nothing is paid yet. */
  async create(userId: string, input: CreateSplitInput, opts: { series?: Types.ObjectId } = {}) {
    await ConfigService.assertEnabled('splits', 'bills', billFeature(input.bill.serviceId));
    const usernames = input.shares.map((s) => s.username);
    if (new Set(usernames).size !== usernames.length) throw unprocessable('Each person can have one share', 'DUPLICATE_SHARE');
    const people = await UserModel.find({ username: { $in: usernames }, status: 'active' }).select('_id username').lean();
    const missing = usernames.find((u) => !people.some((p) => p.username === u));
    if (missing) throw notFound(`No Tasa user has the username @${missing}`);

    const priced = await BillsService.quote(userId, { kind: 'bill', ...input.bill, autoApply: false });
    const total = priced.amount + priced.fee;
    const amounts = shareOut(total, input.shares);
    if (amounts.some((a) => a < 100)) throw unprocessable('Each share must be at least ₦1', 'SHARE_TOO_SMALL');

    const split = await SplitModel.create({
      starter: userId,
      title: input.title,
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
      fee: priced.fee,
      charges: priced.charges,
      shares: input.shares.map((s, i) => ({ user: people.find((p) => p.username === s.username)!._id, amount: amounts[i] })),
      deadline: new Date(Date.now() + input.hours * 60 * 60_000),
      ...(opts.series && { series: opts.series }),
    });
    await getQueue(SPLITS_QUEUE).add('split.deadline', { splitId: split.id }, { delay: input.hours * 60 * 60_000, jobId: `split-deadline-${split.id}`, attempts: 1 });
    bus.emit('split.update', { splitId: split.id as string, stage: 'created' });
    return splitDto(split, userId);
  },

  /**
   * The same bill split the same way again, once the last one is over (paid, or ended without
   * paying): same title, account and people. It's priced afresh; if the total moved, custom
   * shares can't still add up, so everyone shares it equally. Whoever starts it is the starter.
   */
  async again(splitId: string, userId: string, hours?: number) {
    const last = await visible(splitId, userId);
    if (last.status === 'open' || last.status === 'paying') throw conflict('This split is still going. Start again once it’s over.', 'SPLIT_STILL_OPEN');
    const users = await UserModel.find({ _id: { $in: last.shares.map((x) => x.user) } }).select('username status').lean();
    const shares = last.shares.map((x) => {
      const u = users.find((p) => p._id.equals(x.user));
      if (!u?.username || u.status !== 'active') throw unprocessable('Someone in the last split isn’t on Tasa any more. Start a new split instead.', 'SPLIT_PERSON_GONE');
      return { username: u.username, amount: x.amount };
    });
    const custom = Math.max(...shares.map((x) => x.amount)) - Math.min(...shares.map((x) => x.amount)) > 1;
    const lastingHours = Math.round((last.deadline.getTime() - last.createdAt.getTime()) / 3_600_000);
    const input: CreateSplitInput = {
      title: last.title,
      bill: {
        serviceId: last.bill.serviceId,
        provider: last.bill.provider,
        account: last.bill.account,
        product: last.bill.product ?? 'airtime',
        meterType: last.bill.meterType ?? 'prepaid',
        ...(last.bill.planCode ? { planCode: last.bill.planCode } : { amount: last.amount }),
      },
      shares: shares.map(({ username, amount }) => (custom ? { username, amount } : { username })),
      hours: hours ?? Math.min(MAX_SPLIT_HOURS, Math.max(1, lastingHours)),
    };
    // Every round of the same bill shares the first one's id, so they read as one split with a history.
    const series = last.series ?? last._id;
    if (!last.series) await SplitModel.updateOne({ _id: last._id }, { series });
    try {
      return await this.create(userId, input, { series });
    } catch (err) {
      // The price moved, so the old custom shares no longer add up: share it equally instead.
      if (custom && err instanceof AppError && err.code === 'SHARES_MISMATCH') {
        return this.create(userId, { ...input, shares: shares.map(({ username }) => ({ username })) }, { series });
      }
      throw err;
    }
  },

  async list(userId: string) {
    const splits = await SplitModel.find({ $or: [{ starter: userId }, { 'shares.user': userId }] }).sort({ createdAt: -1 }).limit(100);
    // A bill split again and again is one entry: its latest round, the rest in its history.
    const seen = new Set<string>();
    const latest = splits.filter((s) => {
      const key = (s.series ?? s._id).toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return Promise.all(latest.slice(0, 50).map((s) => splitDto(s, userId)));
  },

  async detail(splitId: string, userId: string) {
    const split = await visible(splitId, userId);
    return { ...(await splitDto(split, userId, { result: true })), history: await historyOf(split, userId) };
  },

  async quoteShare(userId: string, { splitId }: SplitShareQuoteInput) {
    const split = await visible(splitId, userId);
    if (split.status !== 'open' || split.deadline <= new Date()) throw conflict('This split is no longer collecting', 'SPLIT_CLOSED');
    const share = split.shares.find((x) => x.user.toString() === userId);
    if (!share) throw notFound('You don’t have a share in this split');
    if (share.paidAt) throw conflict('You’ve already paid your share', 'SHARE_PAID');
    const { charges, fee } = await ChargesService.compute({ scope: 'split' }, share.amount);
    const quote = await QuotesService.create(userId, { kind: 'split_share', amount: share.amount, charges, fee, splitShare: { split: split._id } });
    return { ...toQuoteDto(quote), splitShare: { title: split.title, starter: (await splitDto(split, userId)).starter.name } };
  },

  /** Their share into the pot. The last one in sends the bill. */
  async payShare(userId: string, quoteId: string, pin: string) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return toTransactionDto(existing);
    await PinService.verify(userId, pin);
    await ConfigService.assertEnabled('splits');
    let full = false;
    const tx = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'split_share', session);
      const txId = new Types.ObjectId();
      const now = new Date();
      const split = await SplitModel.findOneAndUpdate(
        { _id: quote.splitShare!.split, status: 'open', deadline: { $gt: now }, shares: { $elemMatch: { user: userId, paidAt: null, amount: quote.amount } } },
        { $set: { 'shares.$.paidAt': now, 'shares.$.transaction': txId } },
        { new: true, session },
      );
      if (!split) throw conflict('This split is no longer collecting, or your share changed', 'SPLIT_CLOSED');
      const [created] = await TransactionModel.create(
        [
          {
            _id: txId,
            reference: newReference('split_share'),
            user: userId,
            kind: 'split_share',
            direction: 'debit',
            status: 'success',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            split: { id: split._id, title: split.title },
            narration: split.title,
            completedAt: now,
            events: [{ type: 'created', at: now }],
          },
        ],
        { session },
      );
      await LedgerService.post(
        {
          key: `split-share:${created!.reference}`,
          memo: `Share of ${split.title}`,
          transactionId: txId,
          lines: [
            { account: Accounts.wallet(userId), amount: quote.total },
            { account: Accounts.split(split._id), amount: -quote.amount },
            { account: Accounts.charges('split'), amount: -quote.fee },
          ],
        },
        session,
      );
      // Everyone's in: claim the pot for the bill, once.
      full = Boolean(await SplitModel.findOneAndUpdate({ _id: split._id, status: 'open', 'shares.paidAt': { $ne: null } }, { status: 'paying' }, { session }));
      return created!;
    });
    // Buying the bill can take a while at VTpass (a slow vend can outlast the app's wait), so it
    // happens on the queue: this share is paid either way, and the split says when the bill is.
    if (full) {
      const splitId = tx.split!.id.toString();
      await getQueue(SPLITS_QUEUE)
        .add('split.pay', { splitId }, { jobId: `split-pay-${splitId}`, attempts: 1 })
        .catch((err) => console.error(`[splits] queue pay ${splitId}`, err));
    }
    return toTransactionDto(tx);
  },

  /**
   * The full pot pays the bill. Priced again first: if the bill now costs something else (a new
   * TV price), nothing is paid and everyone's refunded. The charge stays what the shares covered.
   */
  async payBill(splitId: string) {
    const split = await SplitModel.findOneAndUpdate({ _id: splitId, status: 'paying', billTransaction: null }, { $inc: { payAttempts: 1 } }, { new: true });
    if (!split) return;
    // An earlier attempt got as far as a purchase: follow that one instead of buying twice.
    if (split.billQuote) {
      const earlier = await TransactionModel.findOne({ quote: split.billQuote });
      if (earlier) return this.onBillResult(earlier.id as string);
    }
    try {
      const priced = await BillsService.quote(split.starter.toString(), {
        kind: 'bill',
        serviceId: split.bill.serviceId,
        provider: split.bill.provider,
        account: split.bill.account,
        product: split.bill.product ?? 'airtime',
        meterType: split.bill.meterType ?? 'prepaid',
        ...(split.bill.planCode ? { planCode: split.bill.planCode } : { amount: split.amount }),
        autoApply: false,
      });
      if (priced.amount !== split.amount) return this.close(split.id as string, 'failed', 'The bill’s price changed before it was paid, so everyone got their share back.');
      await QuoteModel.updateOne({ _id: priced._id }, { fee: split.fee, charges: split.charges, total: split.amount + split.fee });
      const claimed = await SplitModel.updateOne({ _id: split._id, status: 'paying', billQuote: split.billQuote ?? null }, { billQuote: priced._id });
      if (claimed.modifiedCount === 0) return;
      const tx = await BillsService.purchase(split.starter.toString(), priced.id as string, {
        system: true,
        split: { id: split._id, title: split.title, pot: Accounts.split(split._id) },
      });
      await SplitModel.updateOne({ _id: split._id }, { billTransaction: tx.id });
      return await this.onBillResult(tx.id);
    } catch (err) {
      // Couldn't get as far as a bill (VTpass down, bills switched off): the sweep tries again, then gives up.
      if (split.payAttempts >= MAX_PAY_ATTEMPTS) return this.close(split.id as string, 'failed', 'We couldn’t pay the bill, so everyone got their share back.');
      throw err;
    }
  },

  /** The bill's outcome decides the split: delivered = paid; failed = everyone refunded; pending = wait. */
  async onBillResult(transactionId: string) {
    const tx = await TransactionModel.findById(transactionId);
    if (!tx?.split?.id) return;
    await SplitModel.updateOne({ _id: tx.split.id, billTransaction: null }, { billTransaction: tx._id });
    if (tx.status === 'success') {
      const done = await SplitModel.findOneAndUpdate({ _id: tx.split.id, status: 'paying' }, { status: 'paid', closedAt: new Date() });
      if (done) bus.emit('split.update', { splitId: tx.split.id.toString(), stage: 'paid' });
    }
    // The failed bill already put the money back in the pot; now it goes back to everyone.
    if (tx.status === 'failed') await this.close(tx.split.id.toString(), 'failed', 'The bill didn’t go through, so everyone got their share back.');
  },

  /** Renaming it or moving its deadline, while it's still collecting. Everyone is told of a new deadline. */
  async update(splitId: string, userId: string, change: { title?: string | undefined; hours?: number | undefined }) {
    const split = await visible(splitId, userId);
    if (split.starter.toString() !== userId) throw unprocessable('Only the person who started it can change it', 'NOT_STARTER');
    const deadline = change.hours !== undefined ? new Date(Date.now() + change.hours * 60 * 60_000) : undefined;
    const updated = await SplitModel.findOneAndUpdate(
      { _id: split._id, status: 'open' },
      { ...(change.title !== undefined && { title: change.title }), ...(deadline && { deadline }) },
      { new: true },
    );
    if (!updated) throw conflict('This split can’t be changed now', 'SPLIT_CLOSED');
    if (deadline) {
      const queue = getQueue(SPLITS_QUEUE);
      await queue.remove(`split-deadline-${split.id}`).catch(() => undefined);
      await queue.add('split.deadline', { splitId: split.id }, { delay: change.hours! * 60 * 60_000, jobId: `split-deadline-${split.id}-${deadline.getTime()}`, attempts: 1 });
      bus.emit('split.update', { splitId: split.id as string, stage: 'rescheduled' });
    }
    return this.detail(splitId, userId);
  },

  async cancel(splitId: string, userId: string) {
    const split = await visible(splitId, userId);
    if (split.starter.toString() !== userId) throw unprocessable('Only the person who started it can cancel it', 'NOT_STARTER');
    if (split.status !== 'open') throw conflict('This split can’t be cancelled now', 'SPLIT_CLOSED');
    await this.close(splitId, 'cancelled', 'Cancelled by the person who started it.');
    return this.detail(splitId, userId);
  },

  /**
   * Closes a split that won't be paid and gives every paid share back, in one transaction with
   * the status change. Only from `open`, or from `paying` with no bill in flight.
   */
  async close(splitId: string, status: 'failed' | 'expired' | 'cancelled', reason: string) {
    const closed = await inTransaction(async (session) => {
      // Expiry and cancelling only stop a split still collecting; a failure can also end a full one.
      const split = await SplitModel.findOneAndUpdate(
        { _id: splitId, status: { $in: status === 'failed' ? ['open', 'paying'] : ['open'] } },
        { status, closedReason: reason, closedAt: new Date() },
        { new: true, session },
      );
      if (!split) return null;
      // Only what's really in the pot goes back: a bill still in flight keeps it there.
      const inPot = -(await LedgerService.balance(Accounts.split(split._id), session));
      const owed = split.shares.filter((x) => x.paidAt && !x.refundedAt);
      if (owed.reduce((sum, x) => sum + x.amount, 0) > inPot) throw conflict('The bill is still being paid', 'SPLIT_BILL_IN_FLIGHT');
      for (const share of owed) {
        const reference = newReference('split_refund');
        const [refund] = await TransactionModel.create(
          [
            {
              reference,
              user: share.user,
              kind: 'split_refund',
              direction: 'credit',
              status: 'success',
              amount: share.amount,
              fee: 0,
              total: share.amount,
              split: { id: split._id, title: split.title },
              narration: split.title,
              completedAt: new Date(),
              events: [{ type: 'created', at: new Date(), note: reason }],
            },
          ],
          { session },
        );
        await LedgerService.post(
          {
            key: `split-refund:${String(split._id)}:${String(share._id)}`,
            memo: `${split.title}: share back`,
            transactionId: refund!._id,
            lines: [
              { account: Accounts.split(split._id), amount: share.amount },
              { account: Accounts.wallet(share.user), amount: -share.amount },
            ],
          },
          session,
        );
        await SplitModel.updateOne({ _id: split._id, 'shares._id': share._id }, { $set: { 'shares.$.refundedAt': new Date() } }, { session });
      }
      return split;
    });
    if (closed) bus.emit('split.update', { splitId, stage: status });
  },

  /** The deadline job: a split that's still collecting gives everything back. */
  async onDeadline(splitId: string) {
    // A deadline that was moved later leaves its old job behind: only the real deadline ends it.
    const split = await SplitModel.findById(splitId).select('deadline status');
    if (!split || split.status !== 'open' || split.deadline.getTime() > Date.now() + 1000) return;
    await this.close(splitId, 'expired', 'Not everyone paid before the deadline, so everyone got their share back.');
  },

  /** Safety net: deadlines whose job was lost, and full pots whose bill attempt didn't finish. */
  async sweep() {
    const now = new Date();
    const [overdue, stuck] = await Promise.all([
      SplitModel.find({ status: 'open', deadline: { $lte: now } }).select('_id').limit(100),
      SplitModel.find({ status: 'paying', billTransaction: null, createdAt: { $lt: new Date(now.getTime() - PAY_RETRY_AFTER_MS) } }).select('_id').limit(100),
    ]);
    for (const s of overdue) await this.onDeadline(s.id as string).catch((err) => console.error(`[splits] deadline ${s.id}`, err));
    for (const s of stuck) await this.payBill(s.id as string).catch((err) => console.error(`[splits] pay ${s.id}`, err));
  },
};
