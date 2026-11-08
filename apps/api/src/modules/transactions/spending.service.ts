import { Types } from 'mongoose';
import { giftConditionsFor } from '../coupons/coupons.service';
import { billGiftConditions } from '../coupons/gift-inbox.service';
import { CouponClaimModel, CouponModel } from '../coupons/models/coupon.model';
import { PointsService } from '../points/points.service';
import { RecurringBillModel } from '../recurring/models/recurring-bill.model';
import { lagosParts, lagosRunTime, type RecurringFrequency } from '../recurring/schedule';
import { UserModel } from '../users/models/user.model';
import { TransactionModel, type ITransaction } from './models/transaction.model';
import type { SpendingPeriod } from './transactions.schema';

type Range = { from: Date | null; to: Date };
export type SpendingCategory = 'bills' | 'transfers' | 'gifts' | 'coupons' | 'tickets' | 'dues';

const TREND_MONTHS = 6;

/** Money leaving the wallet for good, plus unused coupon or gift money and refunded tickets coming back. */
const SPENDING_KINDS = [
  'bill',
  'transfer_out',
  'gift',
  'coupon_funding',
  'coupon_refund',
  'ticket_purchase',
  'ticket_refund',
  'group_dues',
  'split_share',
  'split_refund',
];

const isRefund = (t: Pick<ITransaction, 'kind'>) => t.kind === 'coupon_refund' || t.kind === 'ticket_refund' || t.kind === 'split_refund';

/** A bill bought for someone else is a gift, however it was paid for. */
export function categoryOf(t: Pick<ITransaction, 'kind' | 'giftTo' | 'coupon'>): SpendingCategory {
  if (t.kind === 'transfer_out') return 'transfers';
  if (t.kind === 'gift') return 'gifts';
  if (t.kind === 'ticket_purchase' || t.kind === 'ticket_refund') return 'tickets';
  if (t.kind === 'group_dues') return 'dues';
  // A share is their part of a bill; the bill itself, paid from the pot, isn't counted.
  if (t.kind === 'split_share' || t.kind === 'split_refund') return 'bills';
  if (t.kind === 'bill') return t.giftTo?.label ? 'gifts' : 'bills';
  return t.kind === 'coupon_refund' && t.coupon?.kind === 'gift' ? 'gifts' : 'coupons';
}

/** Calendar periods in Lagos time, and the one just before to compare with. */
export function periodRange(period: SpendingPeriod, now = new Date()): { current: Range; previous: Range | null } {
  const { y, m } = lagosParts(now);
  const monthStart = (back: number) => lagosRunTime(y, m - back, 1);
  // lagosRunTime lands at 07:00; a period starts at midnight.
  const midnight = (at: Date) => new Date(at.getTime() - 7 * 3_600_000);
  const months = (back: number) => midnight(monthStart(back));
  switch (period) {
    case 'this_month':
      return { current: { from: months(0), to: now }, previous: { from: months(1), to: months(0) } };
    case 'last_month':
      return { current: { from: months(1), to: months(0) }, previous: { from: months(2), to: months(1) } };
    case '3_months':
      return { current: { from: months(2), to: now }, previous: { from: months(5), to: months(2) } };
    case '6_months':
      return { current: { from: months(5), to: now }, previous: { from: months(11), to: months(5) } };
    case 'this_year': {
      const start = midnight(lagosRunTime(y, 0, 1));
      return { current: { from: start, to: now }, previous: { from: midnight(lagosRunTime(y - 1, 0, 1)), to: start } };
    }
    case 'all':
      return { current: { from: null, to: now }, previous: null };
  }
}

const MONTHLY_RUNS: Record<RecurringFrequency, number> = {
  daily: 365 / 12,
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

async function spendingIn(userId: string, { from, to }: Range) {
  return TransactionModel.find({
    user: userId,
    kind: { $in: SPENDING_KINDS },
    status: 'success',
    // Paid from a split's pot: everyone's share already counts.
    fundedFrom: { $exists: false },
    createdAt: { ...(from && { $gte: from }), $lt: to },
  })
    .select('kind total amount discount giftTo coupon bill createdAt reference')
    .lean();
}

type Row = Awaited<ReturnType<typeof spendingIn>>[number];

/** What this row took from the wallet, charges included: refunds count against it. */
const netOf = (t: Row) => (isRefund(t) ? -t.amount : t.total);

/** The gift, coupon or bill itself. The breakdown shows these, so it won't add up to `spent`. */
const valueOf = (t: Row) => (isRefund(t) ? -t.amount : t.amount);

const totalOf = (rows: Row[]) => rows.reduce((sum, t) => sum + netOf(t), 0);

function breakdown<K extends string>(rows: Row[], keyOf: (t: Row) => K | null) {
  const groups = new Map<K, { amount: number; count: number }>();
  for (const t of rows) {
    const key = keyOf(t);
    if (key === null) continue;
    const group = groups.get(key) ?? { amount: 0, count: 0 };
    group.amount += valueOf(t);
    if (!isRefund(t)) group.count += 1;
    groups.set(key, group);
  }
  const total = [...groups.values()].reduce((sum, g) => sum + Math.max(0, g.amount), 0);
  return [...groups.entries()]
    .map(([key, g]) => ({ key, amount: Math.max(0, g.amount), count: g.count, share: total > 0 ? Math.max(0, g.amount) / total : 0 }))
    .filter((g) => g.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export const SpendingService = {
  async summary(userId: string, period: SpendingPeriod, now = new Date()) {
    const { current, previous } = periodRange(period, now);
    const [rows, earlier, trendRows, schedules, received, points] = await Promise.all([
      spendingIn(userId, current),
      previous ? spendingIn(userId, previous) : Promise.resolve([]),
      this.trend(userId, now),
      RecurringBillModel.find({ user: new Types.ObjectId(userId), active: true }).select('amount frequency').lean(),
      this.received(userId, current),
      PointsService.earnedIn(userId, current.from, current.to),
    ]);

    const spent = Math.max(0, totalOf(rows));
    const before = Math.max(0, totalOf(earlier));
    const ownBills = rows.filter((t) => t.kind === 'bill' && categoryOf(t) === 'bills');
    const biggest = rows.filter((t) => !isRefund(t)).sort((a, b) => b.amount - a.amount)[0];

    return {
      period,
      from: current.from?.toISOString() ?? null,
      to: current.to.toISOString(),
      spent,
      /** Same-length period before this one. null when there's nothing to compare. */
      previousSpent: previous && before > 0 ? before : null,
      changePercent: previous && before > 0 ? Math.round(((spent - before) / before) * 100) : null,
      transactions: rows.filter((t) => !isRefund(t)).length,
      byCategory: breakdown<SpendingCategory>(rows, categoryOf),
      byService: breakdown(ownBills, (t) => t.bill?.serviceId ?? null),
      byProvider: breakdown(ownBills, (t) => t.bill?.provider ?? null),
      /** What promos, gifts and coupons took off. */
      saved: rows.reduce((sum, t) => sum + (t.discount ?? 0), 0),
      biggest: biggest
        ? { amount: biggest.amount, kind: biggest.kind, serviceId: biggest.bill?.serviceId ?? null, provider: biggest.bill?.provider ?? null, reference: biggest.reference, date: biggest.createdAt.toISOString() }
        : null,
      received,
      points,
      trend: trendRows,
      /** What active recurring payments will cost in a typical month. */
      recurringMonthly: Math.round(schedules.reduce((sum, r) => sum + r.amount * MONTHLY_RUNS[r.frequency], 0)),
    };
  },

  /**
   * What other people gave this user in the period, at full value: gifts, bills paid for them,
   * and coupons they claimed. A coupon they made themselves isn't something they received.
   */
  async received(userId: string, { from, to }: Range) {
    const me = await UserModel.findById(userId).select('phone email');
    if (!me) return { gifts: 0, coupons: 0 };
    const createdAt = { ...(from && { $gte: from }), $lt: to };
    const [gifts, bills, claims] = await Promise.all([
      CouponModel.find({ kind: 'gift', status: { $ne: 'cancelled' }, createdAt, $or: giftConditionsFor(me) }).select('unitAmount').lean(),
      TransactionModel.find({ kind: 'bill', status: 'success', createdAt, $or: billGiftConditions(me) }).select('amount').lean(),
      CouponClaimModel.find({ user: userId, createdAt }).select('coupon allowance').lean(),
    ]);
    const others = await CouponModel.find({ _id: { $in: claims.map((c) => c.coupon) }, kind: 'coupon', owner: { $ne: userId } }).select('_id').lean();
    const fromOthers = new Set(others.map((c) => c._id.toString()));
    return {
      gifts: gifts.reduce((sum, g) => sum + (g.unitAmount ?? 0), 0) + bills.reduce((sum, t) => sum + t.amount, 0),
      coupons: claims.filter((c) => fromOthers.has(c.coupon.toString())).reduce((sum, c) => sum + (c.allowance ?? 0), 0),
    };
  },

  /** Six calendar months ending now, zero-filled, whatever period is selected. */
  async trend(userId: string, now: Date) {
    const { y, m } = lagosParts(now);
    const months = Array.from({ length: TREND_MONTHS }, (_, i) => {
      const start = lagosRunTime(y, m - (TREND_MONTHS - 1 - i), 1);
      return { key: start.toISOString().slice(0, 7), label: start.toLocaleString('en-NG', { month: 'short', timeZone: 'UTC' }), amount: 0 };
    });
    const rows = await spendingIn(userId, { from: new Date(lagosRunTime(y, m - (TREND_MONTHS - 1), 1).getTime() - 7 * 3_600_000), to: now });
    for (const t of rows) {
      const { y: ty, m: tm } = lagosParts(t.createdAt);
      const month = months.find((item) => item.key === lagosRunTime(ty, tm, 1).toISOString().slice(0, 7));
      if (month) month.amount += netOf(t);
    }
    return months.map(({ key, label, amount }) => ({ month: key, label, amount: Math.max(0, amount) }));
  },
};
