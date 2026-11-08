import type { FilterQuery } from 'mongoose';
import { Types } from 'mongoose';
import { notFound } from '../../lib/errors';
import { paginate } from '../../lib/response';
import type { ServiceId } from '../../lib/schemas';
import { BillsService } from '../bills/bills.service';
import { lagosParts } from '../recurring/schedule';
import { WalletService } from '../wallet/wallet.service';
import { TransactionModel, type ITransaction, type TransactionDoc } from './models/transaction.model';

const RECHECK_INTERVAL_MS = 10_000;
import { toTransactionDto } from './transactions.mapper';
import type { TransactionListQuery } from './transactions.schema';

export const TransactionsService = {
  async list(userId: string, q: TransactionListQuery) {
    const filter: FilterQuery<ITransaction> = { user: userId };
    if (q.kind) filter.kind = { $in: q.kind.split(',') };
    if (q.status) filter.status = q.status;
    if (q.direction) filter.direction = q.direction;
    if (q.serviceId) filter['bill.serviceId'] = q.serviceId;
    if (q.beneficiaryId) filter.beneficiary = q.beneficiaryId;
    if (q.from || q.to) filter.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
    const [items, total] = await Promise.all([
      TransactionModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      TransactionModel.countDocuments(filter),
    ]);
    return paginate(items.map(toTransactionDto), total, q.page, q.limit);
  },

  /**
   * The polling endpoint. While a funding or bill is pending, this also asks the provider
   * (at most every 10s) so the app sees the outcome even if a webhook never comes.
   */
  async get(userId: string, reference: string) {
    let tx = await TransactionModel.findOne({ reference, user: userId });
    if (!tx) throw notFound('Transaction not found');
    if (tx.status === 'pending' || (tx.kind === 'funding' && tx.status === 'expired')) {
      tx = (await this.recheck(tx)) ?? tx;
    }
    return toTransactionDto(tx);
  },

  async recheck(tx: TransactionDoc) {
    const last = tx.kind === 'funding' ? tx.funding?.lastCheckedAt : tx.providerData?.lastCheckedAt;
    if (last && Date.now() - last.getTime() < RECHECK_INTERVAL_MS) return tx;
    if (tx.kind === 'funding' && tx.funding?.channel !== 'dedicated') return WalletService.reconcileFunding(tx.reference);
    if (tx.kind === 'bill' && tx.providerData?.sentAt) {
      // Claim the check so concurrent polls don't all hit VTpass.
      const claimed = await TransactionModel.findOneAndUpdate(
        { _id: tx._id, status: 'pending', $or: [{ 'providerData.lastCheckedAt': null }, { 'providerData.lastCheckedAt': { $lt: new Date(Date.now() - RECHECK_INTERVAL_MS) } }] },
        { 'providerData.lastCheckedAt': new Date() },
      );
      // A poll doesn't move the requery schedule (same as a webhook).
      if (claimed) return BillsService.requery(tx.id, 0, 'webhook');
    }
    return tx;
  },

  /** Monthly spend on one service (successful bills), oldest first, zero-filled. */
  async insights(userId: string, serviceId: ServiceId, months: number) {
    // Lagos months, as the bills are grouped below: UTC is still in last month for the first hour.
    const { y, m } = lagosParts(new Date());
    const start = new Date(Date.UTC(y, m - (months - 1), 1, -1));
    const rows = await TransactionModel.aggregate<{ _id: string; amount: number; count: number }>([
      {
        $match: {
          user: new Types.ObjectId(userId),
          kind: 'bill',
          status: 'success',
          'bill.serviceId': serviceId,
          createdAt: { $gte: start },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Africa/Lagos' } },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const byMonth = new Map(rows.map((r) => [r._id, r]));
    const series = Array.from({ length: months }, (_, i) => {
      const d = new Date(Date.UTC(y, m - (months - 1) + i, 1));
      const key = d.toISOString().slice(0, 7);
      return {
        month: key,
        label: d.toLocaleString('en-NG', { month: 'short', timeZone: 'UTC' }),
        amount: byMonth.get(key)?.amount ?? 0,
        count: byMonth.get(key)?.count ?? 0,
      };
    });
    const total = series.reduce((s, p) => s + p.amount, 0);
    return { serviceId, series, total, average: Math.round(total / months) };
  },
};
