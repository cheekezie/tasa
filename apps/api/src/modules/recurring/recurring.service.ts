import { isDuplicateKey } from '../../lib/db';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { formatNaira } from '../../lib/money';
import { BeneficiaryModel } from '../beneficiaries/models/beneficiary.model';
import { SERVICES } from '../bills/bills.catalog';
import { BillsService } from '../bills/bills.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserModel } from '../users/models/user.model';
import { PinService } from '../users/pin.service';
import { RecurringBillModel, type IRecurringBill, type RecurringBillDoc } from './models/recurring-bill.model';
import type { CreateRecurringInput, UpdateRecurringInput } from './recurring.schema';
import { lagosParts, lagosRunTime, nextRunAfter, parseLagosDate } from './schedule';
import { ConfigService } from '../config/config.service';

const MAX_MISSES = 3;
const RETRY_AFTER_MS = 24 * 3_600_000;
const REMINDER_WINDOW_MS = 3 * 86_400_000;

export const toRecurringDto = (r: IRecurringBill) => ({
  id: r._id.toString(),
  label: r.label,
  serviceId: r.serviceId,
  provider: r.provider,
  accountNumber: r.account,
  product: r.product ?? null,
  planCode: r.planCode ?? null,
  amount: r.amount,
  frequency: r.frequency,
  nextDate: r.nextRunAt.toISOString(),
  beneficiaryId: r.beneficiary?.toString() ?? null,
  active: r.active,
  lastRun: r.lastRun?.at
    ? { at: r.lastRun.at.toISOString(), status: r.lastRun.status, reason: r.lastRun.reason ?? null }
    : null,
});

function assertNotPast(run: Date) {
  const today = lagosParts(new Date());
  if (run < lagosRunTime(today.y, today.m, today.d)) throw unprocessable('The payment date has passed', 'START_IN_PAST');
}

async function load(userId: string, id: string) {
  const r = await RecurringBillModel.findOne({ _id: id, user: userId });
  if (!r) throw notFound('Recurring payment not found');
  return r;
}

export const RecurringService = {
  async list(userId: string) {
    const items = await RecurringBillModel.find({ user: userId, active: true }).sort({ nextRunAt: 1 });
    return items.map(toRecurringDto);
  },

  /**
   * No PIN to set one up or change it: nothing is paid here. Each run is a payment, and runs
   * stop for a suspended account (`assertCanSpend`), as every automatic payment does.
   */
  async create(userId: string, input: CreateRecurringInput) {
    await PinService.assertCanSpend(userId);
    const service = SERVICES[input.serviceId];
    if (!service.available) throw unprocessable(`${service.name} payments are coming soon`, 'SERVICE_UNAVAILABLE');
    if (input.beneficiaryId && !(await BeneficiaryModel.exists({ _id: input.beneficiaryId, user: userId, archivedAt: null }))) {
      throw notFound('Beneficiary not found');
    }
    const firstRun = parseLagosDate(input.startDate);
    assertNotPast(firstRun);

    // Price it once now: proves the account and plan are valid, and fixes the amount for plans.
    const quote = await BillsService.quoteDto(userId, {
      kind: 'bill',
      serviceId: input.serviceId,
      provider: input.provider,
      account: input.account,
      amount: input.amount,
      product: input.product,
      planCode: input.planCode,
      meterType: input.meterType,
      autoApply: false, // only validating the account and plan here
    });
    const { d } = lagosParts(firstRun);
    try {
      const r = await RecurringBillModel.create({
        user: userId,
        label: input.label,
        serviceId: input.serviceId,
        provider: quote.bill!.provider,
        account: quote.bill!.account,
        product: quote.bill!.product ?? undefined,
        meterType: quote.bill!.meterType ?? undefined,
        planCode: quote.bill!.planCode ?? undefined,
        amount: quote.amount,
        frequency: input.frequency,
        anchorDay: d,
        nextRunAt: firstRun,
        beneficiary: input.beneficiaryId,
      });
      return toRecurringDto(r);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(`You already have a recurring payment for ${input.account}`, 'DUPLICATE_RECURRING');
      throw err;
    }
  },

  /**
   * This sets what gets charged without the user there, so it takes the PIN like creating one,
   * and a new amount or plan is priced the same way.
   */
  async update(userId: string, id: string, { label, amount, planCode, frequency, nextDate }: UpdateRecurringInput) {
    await PinService.assertCanSpend(userId);
    const r = await load(userId, id);

    if (amount !== undefined || planCode !== undefined) {
      const quote = await BillsService.quoteDto(userId, {
        kind: 'bill',
        serviceId: r.serviceId,
        provider: r.provider,
        account: r.account,
        amount: amount ?? r.amount,
        product: r.product ?? 'airtime',
        planCode: planCode ?? r.planCode,
        meterType: r.meterType ?? 'prepaid',
        autoApply: false, // only validating the account and plan here
      });
      r.amount = quote.amount;
      r.planCode = quote.bill!.planCode ?? undefined;
    }
    if (nextDate) {
      const next = parseLagosDate(nextDate);
      assertNotPast(next);
      r.nextRunAt = next;
      r.anchorDay = lagosParts(next).d;
      r.missedAttempts = 0;
    }
    if (label) r.label = label;
    if (frequency) r.frequency = frequency;
    await r.save();
    return toRecurringDto(r);
  },

  async cancel(userId: string, id: string) {
    const r = await load(userId, id);
    r.active = false;
    await r.save();
  },

  /** Pays everything due. Runs every 15 minutes; each schedule is claimed so two workers never double-pay. */
  async runDue(limit = 100) {
    // Paused, not failed: due bills stay due and run once it's back on.
    if ((await ConfigService.maintenance()) || !(await ConfigService.isEnabled('recurring')) || !(await ConfigService.isEnabled('bills'))) return;
    for (let i = 0; i < limit; i++) {
      const r = await RecurringBillModel.findOneAndUpdate(
        { active: true, nextRunAt: { $lte: new Date() } },
        // Claim: push nextRunAt forward until this run decides where it really goes.
        { nextRunAt: new Date(Date.now() + 10 * 60_000) },
        { sort: { nextRunAt: 1 }, new: false },
      );
      if (!r) return;
      await this.runOne(r).catch((err) => console.error(`[recurring] run ${r.id}`, err));
    }
  },

  async runOne(r: RecurringBillDoc) {
    const dueAt = r.nextRunAt;
    const userId = r.user.toString();
    const advance = () => ({ nextRunAt: nextRunAfter(new Date(), dueAt, r.frequency, r.anchorDay), missedAttempts: 0 });
    try {
      const quote = await BillsService.quote(userId, {
        kind: 'bill',
        serviceId: r.serviceId,
        provider: r.provider,
        account: r.account,
        amount: r.amount,
        product: r.product ?? 'airtime',
        planCode: r.planCode,
        meterType: r.meterType ?? 'prepaid',
        beneficiaryId: r.beneficiary?.toString(),
        autoApply: true,
      });
      const tx = await BillsService.purchase(userId, quote.id, { system: true, recurringId: r._id });
      await RecurringBillModel.updateOne(
        { _id: r._id },
        { ...advance(), lastRun: { at: new Date(), status: tx.status === 'success' ? 'success' : tx.status === 'pending' ? 'pending' : 'failed', transaction: tx.id } },
      );
    } catch (err) {
      const reason = err instanceof AppError ? err.message : 'Something went wrong';
      const lowBalance = err instanceof AppError && err.code === 'INSUFFICIENT_FUNDS';
      const misses = r.missedAttempts + 1;
      const giveUp = !lowBalance || misses >= MAX_MISSES;
      await RecurringBillModel.updateOne(
        { _id: r._id },
        giveUp
          ? { ...advance(), lastRun: { at: new Date(), status: 'skipped', reason } }
          : { nextRunAt: new Date(Date.now() + RETRY_AFTER_MS), missedAttempts: misses, lastRun: { at: new Date(), status: 'failed', reason } },
      );
      if (giveUp) bus.emit('recurring.skipped', { recurringId: r.id, reason });
      else {
        await NotificationsService.notify(r.user, {
          type: 'recurring',
          title: `${r.label} couldn't be paid`,
          body: `${reason}. We'll try again tomorrow.`,
          data: { recurringId: r.id },
          dedupeKey: `recurring:${r.id}:${dueAt.toISOString()}:${misses}`,
        });
      }
      if (!(err instanceof AppError)) throw err;
    }
  },

  /**
   * Morning heads-up: bills due in the next 3 days that the wallet can't cover. One
   * reminder per user per day.
   */
  async remindShortfalls() {
    const due = await RecurringBillModel.find({ active: true, nextRunAt: { $lte: new Date(Date.now() + REMINDER_WINDOW_MS) } });
    const byUser = new Map<string, IRecurringBill[]>();
    for (const r of due) byUser.set(r.user.toString(), [...(byUser.get(r.user.toString()) ?? []), r]);
    const today = new Date().toISOString().slice(0, 10);
    for (const [userId, bills] of byUser) {
      const user = await UserModel.findById(userId).select('notificationPrefs');
      if (!user?.notificationPrefs.shortfallReminders) continue;
      const needed = bills.reduce((s, b) => s + b.amount, 0);
      const balance = await LedgerService.walletBalance(userId);
      if (balance >= needed) continue;
      await NotificationsService.notify(userId, {
        type: 'reminder',
        title: 'Top up for upcoming bills',
        body: `${bills.length} bill${bills.length > 1 ? 's' : ''} due soon need ${formatNaira(needed)}. Add ${formatNaira(needed - balance)} to your wallet.`,
        dedupeKey: `shortfall:${userId}:${today}`,
      });
    }
  },
};
