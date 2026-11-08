import { env } from '../../config/env';
import { inTransaction } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { bus } from '../../lib/events';
import { newReference } from '../../lib/references';
import { ChargesService } from '../charges/charges.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { customerOf } from '../payments/customer';
import { gateway } from '../payments/providers';
import { QuoteModel } from '../quotes/models/quote.model';
import { QuotesService, toQuoteDto } from '../quotes/quotes.service';
import { TransactionModel, type TransactionDoc } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { UserModel } from '../users/models/user.model';

/** Don't hammer SaySwitch when the app polls every few seconds. */
const MIN_VERIFY_INTERVAL_MS = 10_000;

/**
 * What a payment actually credits. Paid exactly what we asked → the quoted amount.
 * Paid something else (people round up, or send twice) → what they sent minus the quoted
 * charge, so the money is never lost and never over-credited.
 */
export function creditFor(quoted: { amount: number; fee: number; total: number }, paid: number) {
  if (paid === quoted.total) return { credit: quoted.amount, fee: quoted.fee };
  const fee = Math.min(quoted.fee, paid);
  return { credit: paid - fee, fee };
}

/**
 * Books SaySwitch's fee on a collection that was credited before the fee was known. Runs
 * once per transaction (compare-and-set on `providerFeeReported`).
 */
export async function recordLateFee(tx: TransactionDoc, fee: number, source: 'funding' | 'collection') {
  if (tx.funding?.providerFeeReported) return;
  await inTransaction(async (session) => {
    const updated = await TransactionModel.findOneAndUpdate(
      { _id: tx._id, status: 'success', 'funding.providerFeeReported': { $ne: true } },
      {
        'funding.providerFee': fee,
        'funding.providerFeeReported': true,
        $push: { events: { type: 'provider_fee', at: new Date(), note: `SaySwitch fee ${fee}` } },
      },
      { new: true, session },
    );
    if (!updated || fee <= 0) return;
    await LedgerService.post(
      {
        key: `${source}:${tx.reference}:fee`,
        memo: `SaySwitch fee on ${tx.reference}`,
        transactionId: tx._id,
        lines: [
          { account: Accounts.collections, amount: -fee },
          { account: Accounts.providerFees(source), amount: fee },
        ],
      },
      session,
    );
  });
}

export const WalletService = {
  async balance(userId: string) {
    return { balance: await LedgerService.walletBalance(userId), currency: 'NGN' as const };
  },

  async quote(userId: string, amount: number) {
    const { charges, fee } = await ChargesService.compute({ scope: 'funding' }, amount);
    return toQuoteDto(await QuotesService.create(userId, { kind: 'funding', amount, charges, fee }));
  },

  /**
   * Issues a one-time SaySwitch account for the quote's total. Calling again with the same
   * quote returns the same account, so a retried request never makes two.
   */
  async startFunding(userId: string, quoteId: string) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });

    if (existing) return toTransactionDto(existing);

    const user = await UserModel.findById(userId);
    if (!user) throw notFound('Account not found');

    const tx = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'funding', session);
      const [created] = await TransactionModel.create(
        [
          {
            reference: newReference('funding'),
            user: userId,
            kind: 'funding',
            funding: { channel: 'one_time' },
            direction: 'credit',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            events: [{ type: 'created', at: new Date() }],
          },
        ],
        { session },
      );
      return created!;
    });

    try {
      const account = await gateway.collectByTransfer({ reference: tx.reference, amount: tx.total, customer: customerOf(user) });


      tx.funding = { channel: 'one_time', ...account, expiresAt: new Date(Date.now() + env.FUNDING_ACCOUNT_TTL_MINUTES * 60_000) };
      tx.events.push({ type: 'account_issued', at: new Date() });
      await tx.save();
      return toTransactionDto(tx);
    } catch (err) {
      // Nothing was collected: drop the attempt and free the quote so "Try again" works.
      await TransactionModel.deleteOne({ _id: tx._id, status: 'pending' });
      await QuoteModel.updateOne({ _id: quoteId }, { $unset: { usedAt: 1 } });
      throw err;
    }
  },

  async getFunding(userId: string, reference: string) {
    let tx = await TransactionModel.findOne({ reference, user: userId, kind: 'funding' });
    if (!tx) throw notFound('Funding not found');
    const stale = !tx.funding?.lastCheckedAt || Date.now() - tx.funding.lastCheckedAt.getTime() > MIN_VERIFY_INTERVAL_MS;
    if ((tx.status === 'pending' || tx.status === 'expired') && stale) {
      tx = (await this.reconcileFunding(reference)) ?? tx;
    }
    return toTransactionDto(tx);
  },

  /**
   * The only path that credits a funding. Asks SaySwitch for the truth (webhook bodies are
   * just a hint) and is safe to run any number of times concurrently.
   */
  async reconcileFunding(reference: string, hint: { providerFee?: number } = {}): Promise<TransactionDoc | null> {
    const tx = await TransactionModel.findOne({ reference, kind: 'funding' });
    if (!tx || !tx.funding?.accountNumber) return tx;
    if (tx.status === 'success') {
      // Polling may have credited it before the webhook brought SaySwitch's fee.
      if (hint.providerFee !== undefined) await recordLateFee(tx, hint.providerFee, 'funding');
      return TransactionModel.findById(tx._id);
    }
    if (tx.status !== 'pending' && tx.status !== 'expired') return tx;

    const status = await gateway.verify(reference);
    if (status.status === 'pending') {
      await TransactionModel.updateOne({ _id: tx._id }, { 'funding.lastCheckedAt': new Date() });
      return TransactionModel.findById(tx._id);
    }
    if (status.status === 'failed') {
      return TransactionModel.findOneAndUpdate(
        { _id: tx._id, status: 'pending' },
        { status: 'failed', $push: { events: { type: 'failed', at: new Date(), note: status.message } } },
        { new: true },
      );
    }

    const paid = status.amountPaid;
    const { credit, fee } = creditFor(tx, paid);
    // We absorb SaySwitch's fee; take it from verify, or from the (signed) webhook.
    const reportedFee = status.providerFee ?? hint.providerFee;
    const providerFee = reportedFee ?? 0;
    const settled = await inTransaction(async (session) => {
      const updated = await TransactionModel.findOneAndUpdate(
        { _id: tx._id, status: { $in: ['pending', 'expired'] } },
        {
          status: 'success',
          amount: credit,
          fee,
          total: paid,
          completedAt: new Date(),
          'funding.amountReceived': paid,
          'funding.providerFee': providerFee,
          'funding.providerFeeReported': reportedFee !== undefined,
          'funding.lastCheckedAt': new Date(),
          'providerData.reference': status.providerReference,
          $push: {
            events: {
              type: 'success',
              at: new Date(),
              note: paid === tx.total ? undefined : `Expected ${tx.total}, received ${paid}`,
            },
          },
        },
        { new: true, session },
      );
      if (!updated) return null;
      await LedgerService.post(
        {
          key: `funding:${reference}`,
          memo: `Wallet funding ${reference}`,
          transactionId: updated._id,
          lines: [
            { account: Accounts.collections, amount: paid - providerFee },
            // We absorb SaySwitch's fee so funding looks free to the user.
            { account: Accounts.providerFees('funding'), amount: providerFee },
            { account: Accounts.wallet(updated.user), amount: -credit },
            { account: Accounts.charges('funding'), amount: -fee },
          ],
        },
        session,
      );
      return updated;
    });
    if (settled) bus.emit('funding.succeeded', { transactionId: settled.id });
    return settled ?? TransactionModel.findById(tx._id);
  },

  /** UI-only: the account still accepts a late transfer, and reconcile still credits it. */
  async expireStaleFundings() {
    await TransactionModel.updateMany(
      { kind: 'funding', status: 'pending', 'funding.expiresAt': { $lt: new Date() } },
      { status: 'expired', $push: { events: { type: 'expired', at: new Date() } } },
    );
  },

  /** Safety net for missed webhooks: re-checks recent fundings that haven't settled. */
  async sweepFundings() {
    await this.expireStaleFundings();
    const recent = await TransactionModel.find({
      kind: 'funding',
      status: { $in: ['pending', 'expired'] },
      'funding.accountNumber': { $exists: true },
      createdAt: { $gt: new Date(Date.now() - 48 * 3_600_000) },
      $or: [{ 'funding.lastCheckedAt': null }, { 'funding.lastCheckedAt': { $lt: new Date(Date.now() - 2 * 60_000) } }],
    })
      .select('reference')
      .limit(200);
    for (const t of recent) {
      await this.reconcileFunding(t.reference).catch((err) => console.error(`[funding] reconcile ${t.reference}`, err));
    }
  },
};

