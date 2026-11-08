import { Types } from 'mongoose';
import { LedgerEntryModel } from '../ledger/models/ledger-entry.model';
import { WalletModel } from '../ledger/models/wallet.model';
import { LedgerService, PNL_PREFIXES } from '../ledger/ledger.service';
import { CouponModel, CouponUseModel } from '../coupons/models/coupon.model';
import { TransactionModel } from '../transactions/models/transaction.model';
import { UserModel } from '../users/models/user.model';
import { WebhookEventModel } from '../webhooks/models/webhook-event.model';
import { SellerModel } from '../tickets/models/ticket.model';
import { SERVICES } from '../bills/bills.catalog';
import type { ServiceId } from '../../lib/schemas';
import { periodRange } from '../transactions/spending.service';
import { lagosParts, lagosRunTime } from '../recurring/schedule';
import { PAYOUT_KINDS } from '../tickets/tickets.service';
import type { SpendingPeriod } from '../transactions/transactions.schema';

export type Range = { from: Date; to: Date };

/** Income is stored negative (it's owed to the business); flip it for reading. */
const income = (v: number) => (v === 0 ? 0 : -v);
const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
const suffix = (account: string, prefix: string) => account.slice(prefix.length);

async function campaigns(prefix: string, range: Range) {
  const rows = await LedgerService.sumsByAccount(prefix, range);
  const ids = [...rows.keys()].map((a) => suffix(a, prefix)).filter((id) => Types.ObjectId.isValid(id));
  const coupons = await CouponModel.find({ _id: { $in: ids } }).select('code title kind');
  const byId = new Map(coupons.map((c) => [c.id as string, c]));
  return {
    total: sum(rows),
    byCampaign: [...rows.entries()]
      .map(([account, amount]) => {
        const c = byId.get(suffix(account, prefix));
        return { id: suffix(account, prefix), code: c?.code ?? null, title: c?.title ?? null, kind: c?.kind ?? null, amount };
      })
      .filter((r) => r.amount !== 0)
      .sort((a, b) => b.amount - a.amount),
  };
}

const LAGOS = 'Africa/Lagos';
const BILL_CHARGES = 'revenue:charges:bill:';

/** Every day (or month) key from `from` to `to`, Lagos time, so quiet ones show as zero. */
function bucketKeys(from: Date, to: Date, unit: 'day' | 'month') {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit' });
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let t = from.getTime(); t < to.getTime(); t += unit === 'day' ? 86_400_000 : 27 * 86_400_000) {
    const day = fmt.format(new Date(t));
    const key = unit === 'day' ? day : day.slice(0, 7);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  const last = fmt.format(new Date(to.getTime() - 1));
  const lastKey = unit === 'day' ? last : last.slice(0, 7);
  if (!seen.has(lastKey)) keys.push(lastKey);
  return keys;
}

export const ReportsService = {
  /**
   * The back office's version of the app's insights: what Tasa earned in a period, over time,
   * and what each bill category brought in (our charge plus VTpass's commission). Periods are
   * the app's, in Lagos time, from the ledger, so it agrees with the P&L.
   */
  async income(period: SpendingPeriod, now = new Date()) {
    const { current, previous } = periodRange(period, now);
    const revenueIn = (range: { from: Date | null; to: Date }) => ({
      account: { $regex: '^revenue:' },
      createdAt: { ...(range.from && { $gte: range.from }), $lt: range.to },
    });
    const isBill = { $or: [{ $regexMatch: { input: '$account', regex: '^revenue:charges:bill:' } }, { $regexMatch: { input: '$account', regex: '^revenue:commission:' } }] };

    // One bar per month, labelled Jan, Feb… like the app. A single month alone would be one bar, so
    // those periods show it with the five months before it (the app's six-month trend), dimmed.
    const { y, m } = lagosParts(now);
    const midnight = (at: Date) => new Date(at.getTime() - 7 * 3_600_000);
    const monthStart = (back: number) => midnight(lagosRunTime(y, m - back, 1));
    const chart =
      period === 'this_month'
        ? { from: monthStart(5), to: monthStart(-1) }
        : period === 'last_month'
          ? { from: monthStart(6), to: monthStart(0) }
          : period === 'this_year'
            ? { from: current.from!, to: midnight(lagosRunTime(y + 1, 0, 1)) }
            : current;
    const [rows, byAccount, prev, bills, first] = await Promise.all([
      LedgerEntryModel.aggregate<{ _id: string; income: number; bills: number }>([
        { $match: revenueIn({ from: chart.from, to: chart.to < current.to ? chart.to : current.to }) },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: LAGOS } },
            income: { $sum: '$amount' },
            bills: { $sum: { $cond: [isBill, '$amount', 0] } },
          },
        },
      ]),
      LedgerEntryModel.aggregate<{ _id: string; amount: number }>([
        { $match: { ...revenueIn(current), account: { $regex: '^revenue:(charges:bill:|commission:)' } } },
        { $group: { _id: '$account', amount: { $sum: '$amount' } } },
      ]),
      previous
        ? LedgerEntryModel.aggregate<{ income: number; bills: number }>([
            { $match: revenueIn(previous) },
            { $group: { _id: null, income: { $sum: '$amount' }, bills: { $sum: { $cond: [isBill, '$amount', 0] } } } },
          ])
        : Promise.resolve([]),
      TransactionModel.aggregate<{ _id: ServiceId; count: number; volume: number }>([
        { $match: { kind: 'bill', status: 'success', completedAt: { ...(current.from && { $gte: current.from }), $lt: current.to } } },
        { $group: { _id: '$bill.serviceId', count: { $sum: 1 }, volume: { $sum: '$amount' } } },
      ]),
      current.from ? Promise.resolve(null) : LedgerEntryModel.findOne({ account: { $regex: '^revenue:' } }).sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);

    const from = current.from ?? first?.createdAt ?? current.to;
    const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS }).format(now).slice(0, 7);
    // "This year" includes the months still to come; they're simply empty.
    const periodKeys = new Set(bucketKeys(from, period === 'this_year' ? chart.to : current.to, 'month'));
    const byKey = new Map(rows.map((r) => [r._id, r]));
    const series = bucketKeys(chart.from ?? from, chart.to, 'month').map((key) => {
      const r = byKey.get(key);
      return {
        key,
        income: income(r?.income ?? 0),
        bills: income(r?.bills ?? 0),
        /** Inside the period picked; the rest is context. */
        inPeriod: periodKeys.has(key),
        /** Hasn't happened yet (the rest of this year). */
        upcoming: key > thisMonth,
      };
    });

    const categories = new Map<string, { charges: number; commission: number }>();
    for (const row of byAccount) {
      const isCharge = row._id.startsWith(BILL_CHARGES);
      const service = isCharge ? row._id.slice(BILL_CHARGES.length) : suffix(row._id, PNL_PREFIXES.commission);
      const entry = categories.get(service) ?? { charges: 0, commission: 0 };
      if (isCharge) entry.charges += income(row.amount);
      else entry.commission += income(row.amount);
      categories.set(service, entry);
    }
    const billStats = new Map(bills.map((b) => [b._id, b]));
    // Every category we sell shows, earning or not, so a quiet one is visibly quiet rather than missing.
    for (const service of Object.values(SERVICES)) if (service.available && !categories.has(service.id)) categories.set(service.id, { charges: 0, commission: 0 });
    for (const id of billStats.keys()) if (!categories.has(id)) categories.set(id, { charges: 0, commission: 0 });
    const billIncome = [...categories.values()].reduce((s, c) => s + c.charges + c.commission, 0);

    const total = series.filter((p) => p.inPeriod).reduce((s, p) => s + p.income, 0);
    const previousTotal = prev[0] ? income(prev[0].income) : null;
    const change = (now: number, before: number | null) => (before === null || before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10);
    return {
      period,
      from: from.toISOString(),
      to: current.to.toISOString(),
      /** Kobo: everything Tasa earned, and the part that came from bills. */
      income: total,
      billIncome,
      previous: previous && { income: previousTotal ?? 0, billIncome: prev[0] ? income(prev[0].bills) : 0 },
      changePercent: change(total, previousTotal),
      series,
      byCategory: [...categories.entries()]
        .map(([serviceId, c]) => ({
          serviceId,
          name: SERVICES[serviceId as ServiceId]?.name ?? serviceId,
          charges: c.charges,
          commission: c.commission,
          income: c.charges + c.commission,
          bills: billStats.get(serviceId as ServiceId)?.count ?? 0,
          /** Face value of the bills delivered, kobo. */
          volume: billStats.get(serviceId as ServiceId)?.volume ?? 0,
          share: billIncome > 0 ? Math.round(((c.charges + c.commission) / billIncome) * 1000) / 10 : 0,
        }))
        // Biggest first; the ones with nothing yet in the catalogue's order.
        .sort((a, b) => b.income - a.income || b.bills - a.bills),
    };
  },

  /**
   * Profit and loss for postings in [from, to), straight from the ledger. Refunds reverse
   * their charges in the period the refund happened, so a failed bill nets to zero.
   * All kobo.
   */
  async pnl(range: Range) {
    const [charges, commission, fees, promotions, giveaways, points, unreportedFees, unreportedPayoutFees, unreportedBillCosts, pendingCharges] = await Promise.all([
      LedgerService.sumsByAccount(PNL_PREFIXES.charges, range),
      LedgerService.sumsByAccount(PNL_PREFIXES.commission, range),
      LedgerService.sumsByAccount(PNL_PREFIXES.providerFees, range),
      campaigns(PNL_PREFIXES.promotions, range),
      campaigns(PNL_PREFIXES.giveaways, range),
      LedgerService.sumsByAccount(PNL_PREFIXES.points, range),
      TransactionModel.countDocuments({
        kind: { $in: ['funding', 'beneficiary_collection'] },
        status: 'success',
        'funding.providerFeeReported': false,
        completedAt: { $gte: range.from, $lt: range.to },
      }),
      TransactionModel.countDocuments({
        kind: { $in: PAYOUT_KINDS },
        status: 'success',
        'providerData.cost': { $exists: false },
        completedAt: { $gte: range.from, $lt: range.to },
      }),
      // Delivered without VTpass saying what it kept: no commission was booked for these.
      TransactionModel.countDocuments({
        kind: 'bill',
        status: 'success',
        'providerData.cost': { $exists: false },
        completedAt: { $gte: range.from, $lt: range.to },
      }),
      // Charges booked on bills VTpass hasn't settled: these reverse if the bill fails.
      TransactionModel.aggregate<{ fee: number; count: number }>([
        { $match: { kind: 'bill', status: 'pending' } },
        { $group: { _id: null, fee: { $sum: '$fee' }, count: { $sum: 1 } } },
      ]),
    ]);

    // revenue:charges:<scope>[:<service>]
    const byScope: Record<string, { total: number; byService?: Record<string, number> }> = {};
    for (const [account, raw] of charges) {
      const [scope, service] = suffix(account, PNL_PREFIXES.charges).split(':') as [string, string | undefined];
      const v = income(raw);
      const entry = (byScope[scope] ??= { total: 0 });
      entry.total += v;
      if (service) (entry.byService ??= {})[service] = (entry.byService[service] ?? 0) + v;
    }
    const commissionByService = Object.fromEntries([...commission].map(([a, v]) => [suffix(a, PNL_PREFIXES.commission), income(v)]));
    const feesBySource = Object.fromEntries([...fees].map(([a, v]) => [suffix(a, PNL_PREFIXES.providerFees), v]));

    const revenue = {
      charges: { total: income(sum(charges)), byScope },
      commission: { total: income(sum(commission)), byService: commissionByService },
    };
    const costs = {
      /**
       * What SaySwitch charges us, which users never see: on money coming in (funding, collection),
       * going out (ticket payouts) and moving to VTpass (top-up). The charges we earn pay for it.
       */
      fundingFees: {
        total: sum(fees),
        bySource: feesBySource,
        /** Fundings where SaySwitch didn't report a fee: the true cost is higher than shown. */
        unreportedCount: unreportedFees,
      },
      promotions,
      giveaways,
      /** Points converted to wallet cash in the period. */
      points: { total: sum(points) },
    };
    const revenueTotal = revenue.charges.total + revenue.commission.total;
    const costsTotal = costs.fundingFees.total + costs.promotions.total + costs.giveaways.total + costs.points.total;
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      revenue: { ...revenue, total: revenueTotal },
      costs: { ...costs, total: costsTotal },
      net: revenueTotal - costsTotal,
      /** What the figures can't see yet, so nobody reads them as more exact than they are. */
      caveats: {
        /** Costs higher than shown: SaySwitch didn't say what it charged. */
        fundingsWithoutFee: unreportedFees,
        payoutsWithoutFee: unreportedPayoutFees,
        /** Revenue lower than shown: VTpass didn't say what it kept, so no commission was booked. */
        billsWithoutCost: unreportedBillCosts,
        /** Charges already counted as revenue on bills still pending (any period); they reverse if those fail. */
        pendingBillCharges: { amount: pendingCharges[0]?.fee ?? 0, count: pendingCharges[0]?.count ?? 0 },
      },
    };
  },

  /** Daily revenue, costs and net (Lagos days) for charts. */
  async pnlSeries(range: Range) {
    const rows = await LedgerEntryModel.aggregate<{ _id: { day: string; side: 'revenue' | 'cost' }; total: number }>([
      { $match: { createdAt: { $gte: range.from, $lt: range.to }, account: { $regex: '^(revenue|expense):' } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Lagos' } },
            side: { $cond: [{ $regexMatch: { input: '$account', regex: '^revenue:' } }, 'revenue', 'cost'] },
          },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]);
    const days = new Map<string, { day: string; revenue: number; costs: number; net: number }>();
    for (const r of rows) {
      const d = days.get(r._id.day) ?? { day: r._id.day, revenue: 0, costs: 0, net: 0 };
      if (r._id.side === 'revenue') d.revenue += income(r.total);
      else d.costs += r.total;
      d.net = d.revenue - d.costs;
      days.set(r._id.day, d);
    }
    return [...days.values()];
  },

  /**
   * Everything Tasa has given away: its own coupons/gifts and its promos, with cost in the
   * period, cost to date, and how much more each could still cost.
   */
  async giveaways(range: Range) {
    const [inPeriodGiveaways, inPeriodPromos] = await Promise.all([
      LedgerService.sumsByAccount(PNL_PREFIXES.giveaways, range),
      LedgerService.sumsByAccount(PNL_PREFIXES.promotions, range),
    ]);
    const [allGiveaways, allPromos] = await Promise.all([
      LedgerService.sumsByAccount(PNL_PREFIXES.giveaways),
      LedgerService.sumsByAccount(PNL_PREFIXES.promotions),
    ]);
    const tasaFunded = await CouponModel.find({ $or: [{ kind: 'promo' }, { fundedBy: 'tasa' }] }).sort({ createdAt: -1 });
    const usage = await CouponUseModel.aggregate<{ _id: Types.ObjectId; uses: number; users: Types.ObjectId[] }>([
      { $match: { coupon: { $in: tasaFunded.map((c) => c._id) } } },
      { $group: { _id: '$coupon', uses: { $sum: 1 }, users: { $addToSet: '$user' } } },
    ]);
    const usageBy = new Map(usage.map((u) => [u._id.toString(), u]));

    const items = tasaFunded.map((c) => {
      const isPromo = c.kind === 'promo';
      const account = `${isPromo ? PNL_PREFIXES.promotions : PNL_PREFIXES.giveaways}${c.id as string}`;
      const toDate = (isPromo ? allPromos : allGiveaways).get(account) ?? 0;
      const maxCost = isPromo ? c.promo!.budget : (c.quantity ?? 0) * (c.unitAmount ?? 0);
      const u = usageBy.get(c.id as string);
      return {
        id: c.id as string,
        code: c.code,
        title: c.title,
        kind: c.kind,
        status: c.status,
        startsAt: c.startsAt.toISOString(),
        expiresAt: c.expiresAt.toISOString(),
        uses: u?.uses ?? 0,
        people: u?.users.length ?? 0,
        costInPeriod: (isPromo ? inPeriodPromos : inPeriodGiveaways).get(account) ?? 0,
        costToDate: toDate,
        /** Ceiling: promo budget, or quantity × amount for a giveaway coupon. */
        maxCost,
        /** What it could still cost if every remaining claim/budget is used. */
        exposureLeft: c.status === 'active' || c.status === 'paused' ? Math.max(0, maxCost - toDate) : 0,
      };
    });
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      totals: {
        costInPeriod: sum(inPeriodGiveaways) + sum(inPeriodPromos),
        promotionsInPeriod: sum(inPeriodPromos),
        giveawaysInPeriod: sum(inPeriodGiveaways),
        costToDate: sum(allGiveaways) + sum(allPromos),
        exposureLeft: items.reduce((s, i) => s + i.exposureLeft, 0),
      },
      items,
    };
  },

  /** Back-office home screen. */
  async overview(range: Range) {
    const window = { $gte: range.from, $lt: range.to };
    const [users, newUsers, wallets, volumes, pending, needsReview, failedWebhooks, pendingBvn, pendingSellers, pnl] = await Promise.all([
      UserModel.countDocuments(),
      UserModel.countDocuments({ createdAt: window }),
      WalletModel.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: '$balance' } } }]),
      TransactionModel.aggregate<{ _id: { kind: string; status: string }; count: number; amount: number }>([
        { $match: { createdAt: window, kind: { $in: ['funding', 'bill', 'transfer_out', 'beneficiary_collection'] } } },
        { $group: { _id: { kind: '$kind', status: '$status' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      TransactionModel.countDocuments({ kind: 'bill', status: 'pending' }),
      TransactionModel.countDocuments({ needsReview: true, status: 'pending' }),
      WebhookEventModel.countDocuments({ status: 'failed' }),
      UserModel.countDocuments({ bvnStatus: 'pending' }),
      SellerModel.countDocuments({ 'verification.status': 'pending' }),
      this.pnl(range),
    ]);
    const pick = (kind: string, status: string) => volumes.find((v) => v._id.kind === kind && v._id.status === status);
    const billsDone = (pick('bill', 'success')?.count ?? 0) + (pick('bill', 'failed')?.count ?? 0);
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      users: { total: users, new: newUsers },
      /** What Tasa owes users right now (all wallet balances). */
      walletLiability: wallets[0]?.total ?? 0,
      funding: {
        count: (pick('funding', 'success')?.count ?? 0) + (pick('beneficiary_collection', 'success')?.count ?? 0),
        amount: (pick('funding', 'success')?.amount ?? 0) + (pick('beneficiary_collection', 'success')?.amount ?? 0),
      },
      bills: {
        count: pick('bill', 'success')?.count ?? 0,
        amount: pick('bill', 'success')?.amount ?? 0,
        failed: pick('bill', 'failed')?.count ?? 0,
        successRate: billsDone ? (pick('bill', 'success')?.count ?? 0) / billsDone : null,
      },
      transfers: { count: pick('transfer_out', 'success')?.count ?? 0, amount: pick('transfer_out', 'success')?.amount ?? 0 },
      attention: { pendingBills: pending, needsReview, failedWebhooks, pendingBvn, pendingSellers },
      pnl: { revenue: pnl.revenue.total, costs: pnl.costs.total, net: pnl.net },
    };
  },
};
