import type { FilterQuery, Types } from 'mongoose';
import { TransactionModel, type ITransaction } from '../transactions/models/transaction.model';
import { UserModel } from '../users/models/user.model';
import { publicName } from '../users/users.service';
import { giftConditionsFor } from './coupons.service';
import { paginate } from '../../lib/response';
import { CouponClaimModel, CouponModel, CouponUseModel, type ICoupon } from './models/coupon.model';

type Me = { _id: Types.ObjectId; phone?: string; email?: string };

/** "Pay their bill" gifts addressed to this user. Same rule as gift balances: no undefined filters. */
export function billGiftConditions(u: Me): FilterQuery<ITransaction>[] {
  const mine: FilterQuery<ITransaction>[] = [{ 'giftTo.user': u._id }];
  if (u.phone) mine.push({ 'giftTo.user': null, 'giftTo.phone': u.phone });
  if (u.email) mine.push({ 'giftTo.user': null, 'giftTo.email': u.email });
  return mine;
}

// Far more gifts than one person gets; it keeps the merge below in memory-sized bounds.
const HISTORY_MAX = 500;

function giftState(g: ICoupon, used: number, amount: number, now: Date) {
  if (used >= amount) return 'used_up' as const;
  if (g.status === 'cancelled') return 'cancelled' as const;
  if (g.status === 'expired' || g.expiresAt <= now) return 'expired' as const;
  return 'active' as const;
}

async function senderNames(ids: (Types.ObjectId | null | undefined)[]) {
  const users = await UserModel.find({ _id: { $in: ids.filter(Boolean) } }).select('fullName username');
  return new Map(users.map((u) => [u.id as string, publicName(u)]));
}

/**
 * Everything gifted to a user, in one place — so a missed push or SMS never means a missed
 * gift. Balances stay until spent or expired; delivered bills (with their token) stay for 90 days.
 */
export const GiftInboxService = {
  async inbox(userId: string) {
    const me = await UserModel.findById(userId).select('phone email');
    if (!me) return { unseen: 0, balance: 0, items: [] };
    const now = new Date();
    const [gifts, bills] = await Promise.all([
      CouponModel.find({ kind: 'gift', status: 'active', expiresAt: { $gt: now }, $or: giftConditionsFor(me) }).sort({ createdAt: -1 }).limit(50),
      TransactionModel.find({
        kind: 'bill',
        status: 'success',
        createdAt: { $gt: new Date(now.getTime() - 90 * 86_400_000) },
        $or: billGiftConditions(me),
      })
        .sort({ createdAt: -1 })
        .limit(50),
    ]);
    const claims = await CouponClaimModel.find({ user: userId, coupon: { $in: gifts.map((g) => g._id) } });
    const claimBy = new Map(claims.map((c) => [c.coupon.toString(), c]));
    const names = await senderNames([...gifts.map((g) => g.owner), ...bills.map((b) => b.user)]);

    const balances = gifts
      .map((g) => {
        const claim = claimBy.get(g.id as string);
        const left = claim ? Math.max(0, (claim.allowance ?? 0) - claim.used) : g.unitAmount!;
        return {
          type: 'balance' as const,
          id: g.id as string,
          code: g.code,
          from: g.fundedBy === 'tasa' ? 'Tasa' : (names.get(g.owner?.toString() ?? '') ?? 'A friend'),
          message: g.message ?? null,
          amount: g.unitAmount!,
          /** Applied automatically at checkout; no code needed. */
          left,
          services: g.services,
          expiresAt: g.expiresAt.toISOString(),
          seen: Boolean(g.recipientSeenAt),
          createdAt: g.createdAt.toISOString(),
        };
      })
      .filter((b) => b.left > 0);

    const paidBills = bills.map((t) => ({
      type: 'bill_paid' as const,
      id: t.id as string,
      reference: t.reference,
      from: names.get(t.user.toString()) ?? 'A friend',
      message: t.giftTo?.message ?? null,
      serviceId: t.bill!.serviceId,
      provider: t.bill!.provider,
      account: t.bill!.account,
      planName: t.bill!.planName ?? null,
      amount: t.amount,
      token: t.bill!.token ?? null,
      units: t.bill!.units ?? null,
      pins: t.bill!.pins?.length ? t.bill!.pins.map((p) => ({ pin: p.pin, serial: p.serial ?? null })) : null,
      seen: Boolean(t.giftTo?.seenAt),
      createdAt: t.createdAt.toISOString(),
    }));

    const items = [...balances, ...paidBills].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      unseen: items.filter((i) => !i.seen).length,
      /** Total gift money waiting to be spent, kobo. */
      balance: balances.reduce((s, b) => s + b.left, 0),
      items,
    };
  },

  /**
   * Every gift this user received or sent, in any state, with what each was spent on. The two
   * kinds of gift live in different collections, so they're merged here, newest first.
   */
  async history(userId: string, direction: 'received' | 'sent', page: number, limit: number) {
    const me = await UserModel.findById(userId).select('phone email');
    if (!me) return paginate([], 0, page, limit);
    const received = direction === 'received';
    const [gifts, bills] = await Promise.all([
      CouponModel.find({ kind: 'gift', ...(received ? { $or: giftConditionsFor(me) } : { owner: userId }) })
        .sort({ createdAt: -1 })
        .limit(HISTORY_MAX),
      TransactionModel.find(
        received
          ? { kind: 'bill', status: 'success', $or: billGiftConditions(me) }
          : { kind: 'bill', user: userId, 'giftTo.label': { $exists: true } },
      )
        .sort({ createdAt: -1 })
        .limit(HISTORY_MAX),
    ]);

    const couponIds = gifts.map((g) => g._id);
    const [claims, uses, names] = await Promise.all([
      CouponClaimModel.find({ coupon: { $in: couponIds } }),
      CouponUseModel.find({ coupon: { $in: couponIds } }).sort({ createdAt: -1 }),
      received ? senderNames([...gifts.map((g) => g.owner), ...bills.map((b) => b.user)]) : new Map<string, string>(),
    ]);
    const spentOn = await TransactionModel.find({ _id: { $in: uses.map((u) => u.transaction) }, status: { $ne: 'failed' } }).select('reference bill');
    const billOf = new Map(spentOn.map((t) => [t.id as string, t]));
    const claimOf = new Map(claims.map((c) => [c.coupon.toString(), c]));
    const now = new Date();

    const balanceGifts = gifts.map((g) => {
      const used = claimOf.get(g.id as string)?.used ?? 0;
      const amount = g.unitAmount!;
      const state = giftState(g, used, amount, now);
      return {
        id: g.id as string,
        type: 'balance' as const,
        person: received
          ? g.fundedBy === 'tasa'
            ? 'Tasa'
            : (names.get(g.owner?.toString() ?? '') ?? 'A friend')
          : (g.recipientName ?? g.recipientLabel ?? 'A friend'),
        message: g.message ?? null,
        amount,
        used,
        left: state === 'active' ? amount - used : 0,
        state,
        services: g.services,
        expiresAt: g.expiresAt.toISOString(),
        date: g.createdAt.toISOString(),
        spentOn: uses
          .filter((u) => u.coupon.toString() === g.id && billOf.has(u.transaction.toString()))
          .map((u) => {
            const t = billOf.get(u.transaction.toString())!;
            return { amount: u.amount, reference: t.reference, serviceId: t.bill?.serviceId ?? null, provider: t.bill?.provider ?? null, date: u.createdAt.toISOString() };
          }),
      };
    });

    const paidBills = bills.map((t) => ({
      id: t.id as string,
      type: 'bill' as const,
      person: received ? (names.get(t.user.toString()) ?? 'A friend') : (t.giftTo?.name ?? t.giftTo?.label ?? 'A friend'),
      message: t.giftTo?.message ?? null,
      amount: t.amount,
      state: t.status === 'success' ? ('delivered' as const) : t.status === 'pending' ? ('pending' as const) : ('failed' as const),
      serviceId: t.bill!.serviceId,
      provider: t.bill!.provider,
      account: t.bill!.account,
      date: t.createdAt.toISOString(),
    }));

    const all = [...balanceGifts, ...paidBills].sort((a, b) => b.date.localeCompare(a.date));
    return paginate(all.slice((page - 1) * limit, page * limit), all.length, page, limit);
  },

  /** For the dashboard badge and "₦X in gifts" card. */
  async summary(userId: string) {
    const { unseen, balance } = await this.inbox(userId);
    return { unseen, balance };
  },

  /** Marks gifts seen (all, or the given ids). Only ever touches gifts addressed to this user. */
  async markSeen(userId: string, ids?: string[]) {
    const me = await UserModel.findById(userId).select('phone email');
    if (!me) return;
    const now = new Date();
    await Promise.all([
      CouponModel.updateMany(
        { kind: 'gift', recipientSeenAt: null, $or: giftConditionsFor(me), ...(ids?.length && { _id: { $in: ids } }) },
        { recipientSeenAt: now },
      ),
      TransactionModel.updateMany(
        { kind: 'bill', 'giftTo.seenAt': null, $or: billGiftConditions(me), ...(ids?.length && { _id: { $in: ids } }) },
        { 'giftTo.seenAt': now },
      ),
    ]);
  },
};
