import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { inTransaction, isDuplicateKey, searchRegex } from '../../lib/db';
import { conflict, unprocessable } from '../../lib/errors';
import { newReference } from '../../lib/references';
import { paginate } from '../../lib/response';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { TransactionModel, type ITransaction } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { PinService } from '../users/pin.service';
import { PointsBalanceModel, PointsEntryModel, PointsSettingsModel, type IPointsSettings } from './models/points.model';
import type { UpdatePointsSettings } from './points.schema';
import { staffUserLabels } from '../users/users.service';
import { UserModel } from '../users/models/user.model';

// Read on every bill and transfer. Admin edits clear it here; other instances catch up within CACHE_MS.
const CACHE_MS = 30_000;
let cached: { at: number; settings: IPointsSettings } | null = null;

async function settings() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;
  const doc = await PointsSettingsModel.findByIdAndUpdate('default', {}, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  cached = { at: Date.now(), settings: doc! };
  return doc!;
}

/** Only what the user paid for themselves earns: free money must not make more of it. */
export function pointsFor(
  tx: Pick<ITransaction, 'kind' | 'amount' | 'discount'> & Partial<Pick<ITransaction, 'fundedFrom'>>,
  s: Pick<IPointsSettings, 'billPointsPer100Naira' | 'transferPoints'>,
) {
  if (tx.kind === 'transfer_out') return s.transferPoints;
  // A split bill was paid from everyone's shares, not the starter's wallet.
  if (tx.kind !== 'bill' || tx.fundedFrom) return 0;
  const paidNaira = Math.max(0, tx.amount - tx.discount) / 100;
  return Math.floor((paidNaira / 100) * s.billPointsPer100Naira);
}

async function recordEntry(
  entry: { user: Types.ObjectId | string; type: 'earn' | 'redeem' | 'forfeit'; points: number; key: string; transaction?: Types.ObjectId },
  session: ClientSession,
) {
  await PointsEntryModel.create([entry], { session });
  const earned = entry.type === 'earn' ? entry.points : 0;
  const updated = await PointsBalanceModel.findOneAndUpdate(
    // A deduction only matches if the points are there.
    entry.points < 0 ? { user: entry.user, balance: { $gte: -entry.points } } : { user: entry.user },
    { $inc: { balance: entry.points, lifetimeEarned: earned } },
    { session, new: true, upsert: entry.points > 0 },
  );
  if (!updated) throw unprocessable('You do not have enough points', 'POINTS_INSUFFICIENT');
  return updated;
}

export const PointsService = {
  /** Safe to call any number of times for one transaction. */
  async earn(transactionId: string) {
    const tx = await TransactionModel.findById(transactionId);
    const s = await settings();
    if (!tx || tx.status !== 'success' || !s.active) return;
    const points = pointsFor(tx, s);
    if (points <= 0) return;
    await inTransaction((session) =>
      recordEntry({ user: tx.user, type: 'earn', points, key: `earn:${tx.id as string}`, transaction: tx._id }, session),
    ).catch((err) => {
      if (!isDuplicateKey(err)) throw err;
    });
  },

  /** Adds what a quote will earn if it succeeds, by the same rule that awards the points. */
  async withPoints<T extends { kind: string; amount: number; discount: number }>(quote: T) {
    const s = await settings();
    const kind = quote.kind === 'transfer' ? 'transfer_out' : quote.kind;
    return { ...quote, pointsToEarn: s.active ? pointsFor({ kind: kind as ITransaction['kind'], amount: quote.amount, discount: quote.discount }, s) : 0 };
  },

  async summary(userId: string) {
    const [s, row] = await Promise.all([settings(), PointsBalanceModel.findOne({ user: userId }).lean()]);
    const balance = row?.balance ?? 0;
    return {
      active: s.active,
      balance,
      lifetimeEarned: row?.lifetimeEarned ?? 0,
      /** What the balance converts to, kobo. */
      value: balance * s.pointValue,
      pointValue: s.pointValue,
      minRedeemPoints: s.minRedeemPoints,
    };
  },

  /** Points earned in a period and what they'd convert to today, kobo. Conversions don't count against it. */
  async earnedIn(userId: string, from: Date | null, to: Date) {
    const [s, entries] = await Promise.all([
      settings(),
      PointsEntryModel.find({ user: userId, type: 'earn', createdAt: { ...(from && { $gte: from }), $lt: to } }).select('points').lean(),
    ]);
    const earned = entries.reduce((sum, e) => sum + e.points, 0);
    return { earned, value: earned * s.pointValue };
  },

  async history(userId: string, page: number, limit: number) {
    const [items, total] = await Promise.all([
      PointsEntryModel.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate<{ transaction: ITransaction | null }>('transaction')
        .lean(),
      PointsEntryModel.countDocuments({ user: userId }),
    ]);
    // The transaction says what earned (or spent) the points; the app links to its receipt.
    const rows = items.map((e) => ({
      id: e._id.toString(),
      type: e.type,
      points: e.points,
      date: e.createdAt.toISOString(),
      transaction: e.transaction ? toTransactionDto(e.transaction) : null,
    }));
    return paginate(rows, total, page, limit);
  },

  /** Points out, wallet in, one Mongo transaction: they can't drift apart. */
  async redeem(userId: string, points: number, idempotencyKey: string) {
    const key = `redeem:${userId}:${idempotencyKey}`;
    const replay = async () => {
      const entry = await PointsEntryModel.findOne({ key });
      const tx = entry && (await TransactionModel.findById(entry.transaction));
      if (!tx) throw conflict('That conversion is still processing', 'POINTS_IN_PROGRESS');
      return { transaction: toTransactionDto(tx), summary: await this.summary(userId) };
    };
    if (await PointsEntryModel.exists({ key })) return replay();

    await PinService.assertCanSpend(userId);
    const s = await settings();
    if (!s.active) throw unprocessable('Points cannot be converted right now', 'POINTS_PAUSED');
    if (points < s.minRedeemPoints) throw unprocessable(`Convert at least ${s.minRedeemPoints} points`, 'POINTS_BELOW_MINIMUM');

    const amount = points * s.pointValue;
    try {
      const tx = await inTransaction(async (session) => {
        const [created] = await TransactionModel.create(
          [
            {
              reference: newReference('points'),
              user: userId,
              kind: 'points_redemption',
              direction: 'credit',
              status: 'success',
              amount,
              fee: 0,
              total: amount,
              narration: `${points} points`,
              completedAt: new Date(),
              events: [{ type: 'success', at: new Date(), note: `${points} points converted` }],
            },
          ],
          { session },
        );
        await recordEntry({ user: userId, type: 'redeem', points: -points, key, transaction: created!._id }, session);
        await LedgerService.post(
          {
            key: `points:${key}`,
            memo: `${points} points converted to wallet`,
            transactionId: created!._id,
            lines: [
              { account: Accounts.points, amount },
              { account: Accounts.wallet(userId), amount: -amount },
            ],
          },
          session,
        );
        return created!;
      });
      return { transaction: toTransactionDto(tx), summary: await this.summary(userId) };
    } catch (err) {
      if (isDuplicateKey(err)) return replay();
      throw err;
    }
  },

  /** Closing an account gives up its points; the ledger never held them, so nothing else moves. */
  async forfeitAll(userId: string) {
    const row = await PointsBalanceModel.findOne({ user: userId });
    if (!row?.balance) return;
    const { balance } = row;
    await inTransaction((session) => recordEntry({ user: userId, type: 'forfeit', points: -balance, key: `forfeit:${userId}` }, session));
  },

  /** Points earned but not yet converted: what they would cost if all came in today. */
  async adminSummary() {
    const s = await settings();
    const [row] = await PointsBalanceModel.aggregate<{ points: number }>([{ $group: { _id: null, points: { $sum: '$balance' } } }]);
    const points = row?.points ?? 0;
    return { settings: s, outstanding: { points, value: points * s.pointValue } };
  },

  /**
   * Every user's points, for staff: balance, what it's worth now, lifetime earned and when they
   * last earned or spent. Biggest balances first unless asked otherwise.
   */
  async adminBalances(q: { search?: string; sort: 'balance' | 'earned'; page: number; limit: number }) {
    const s = await settings();
    const filter: Record<string, unknown> = {};
    if (q.search) {
      const pattern = searchRegex(q.search);
      const users = await UserModel.find({ $or: [{ fullName: pattern }, { username: pattern }, { phone: pattern }, { email: pattern }] })
        .select('_id')
        .limit(500)
        .lean();
      filter.user = { $in: users.map((u) => u._id) };
    }
    const [rows, total] = await Promise.all([
      PointsBalanceModel.find(filter)
        .sort(q.sort === 'earned' ? { lifetimeEarned: -1, _id: 1 } : { balance: -1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      PointsBalanceModel.countDocuments(filter),
    ]);
    const ids = rows.map((r) => r.user);
    const [names, last] = await Promise.all([
      staffUserLabels(ids),
      PointsEntryModel.aggregate<{ _id: Types.ObjectId; at: Date }>([{ $match: { user: { $in: ids } } }, { $group: { _id: '$user', at: { $max: '$createdAt' } } }]),
    ]);
    const lastAt = new Map(last.map((l) => [l._id.toString(), l.at]));
    return paginate(
      rows.map((r) => ({
        userId: r.user.toString(),
        name: names.get(r.user.toString())?.name ?? null,
        username: names.get(r.user.toString())?.username ?? null,
        balance: r.balance,
        lifetimeEarned: r.lifetimeEarned,
        /** What the balance would convert to today, kobo. */
        value: r.balance * s.pointValue,
        lastActivityAt: lastAt.get(r.user.toString())?.toISOString() ?? null,
      })),
      total,
      q.page,
      q.limit,
    );
  },

  async updateSettings(changes: UpdatePointsSettings) {
    await PointsSettingsModel.updateOne({ _id: 'default' }, changes, { upsert: true, setDefaultsOnInsert: true });
    cached = null;
    return this.adminSummary();
  },
};
