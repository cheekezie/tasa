import type { ClientSession, Types } from 'mongoose';
import { AppError } from '../../lib/errors';
import { formatNaira } from '../../lib/money';
import type { ChargeScope } from '../charges/models/charge-rule.model';
import { LedgerEntryModel } from './models/ledger-entry.model';
import { WalletModel } from './models/wallet.model';

/**
 * Accounts (signs: assets +, liabilities and income −, expenses +):
 *   provider:sayswitch                 money at SaySwitch — collections land here
 *   provider:vtpass                    our prepaid VTpass wallet — bills are paid from it
 *   wallet:<userId>                    what we owe a user
 *   bills:in_flight                    debited from a wallet, vend not yet confirmed
 *   coupon:<couponId>                  a user-funded coupon/gift pool until spent or returned
 *   tickets:<userId>                   ticket sales we owe an organiser, withdrawn to their wallet
 *   group:<groupId>                    dues we hold for a group, withdrawn only to its locked payout account
 *   split:<splitId>                    shares paid towards a split bill, until it's paid or refunded
 *
 * Profit and loss — split by dimension so reports are sums of real postings:
 *   revenue:charges:<scope>[:<service>]   our charges   (e.g. revenue:charges:bill:electricity)
 *   revenue:commission:<service>          VTpass's discount: face value minus what it debited
 *   expense:provider_fees:<source>        SaySwitch's cut on funding / beneficiary collections
 *   expense:promotions:<couponId>         Tela promo discounts
 *   expense:giveaways:<couponId>          Tela-funded coupons and gifts
 */
export const Accounts = {
  collections: 'provider:sayswitch',
  biller: 'provider:vtpass',
  wallet: (userId: string | Types.ObjectId) => `wallet:${String(userId)}`,
  billsInFlight: 'bills:in_flight',
  coupon: (couponId: string | Types.ObjectId) => `coupon:${String(couponId)}`,
  ticketWallet: (userId: string | Types.ObjectId) => `tickets:${String(userId)}`,
  group: (groupId: string | Types.ObjectId) => `group:${String(groupId)}`,
  split: (splitId: string | Types.ObjectId) => `split:${String(splitId)}`,
  /** Ticket sales on their way to a seller's bank: out of their ticket wallet, not yet confirmed sent. */
  payoutsInFlight: 'payouts:in_flight',
  charges: (scope: ChargeScope, serviceId?: string | null) =>
    serviceId ? `revenue:charges:${scope}:${serviceId}` : `revenue:charges:${scope}`,
  commission: (serviceId: string) => `revenue:commission:${serviceId}`,
  providerFees: (source: 'funding' | 'collection' | 'payout' | 'topup') => `expense:provider_fees:${source}`,
  promotions: (couponId: string | Types.ObjectId) => `expense:promotions:${String(couponId)}`,
  giveaways: (couponId: string | Types.ObjectId) => `expense:giveaways:${String(couponId)}`,
  /** Points converted to cash. Earning posts nothing: only a conversion moves money. */
  points: 'expense:points',
  /** Left behind by closed accounts. Held as owed, not income, until finance decides otherwise. */
  forfeited: 'liability:forfeited_balances',
} as const;

/** Income/expense roots, for reports. */
export const PNL_PREFIXES = {
  charges: 'revenue:charges:',
  commission: 'revenue:commission:',
  providerFees: 'expense:provider_fees:',
  promotions: 'expense:promotions:',
  giveaways: 'expense:giveaways:',
  points: 'expense:points',
} as const;

export type LedgerLine = { account: string; amount: number };

export const insufficientFunds = (shortfall: number) =>
  new AppError(422, `Insufficient wallet balance. Top up ${formatNaira(shortfall)} to continue`, 'INSUFFICIENT_FUNDS', {
    shortfall: String(shortfall),
  });

const WALLET_PREFIX = 'wallet:';

export const LedgerService = {
  /**
   * Posts one balanced set of lines and moves the cached wallet balances with it.
   * Must run inside `inTransaction`. A debit that would take a wallet below zero throws
   * INSUFFICIENT_FUNDS and the whole transaction rolls back. Returns false if `key` was
   * already posted (replayed webhook, retried job).
   */
  async post(
    p: { key: string; memo: string; lines: LedgerLine[]; transactionId?: Types.ObjectId },
    session: ClientSession,
  ): Promise<boolean> {
    const lines = p.lines.filter((l) => l.amount !== 0);
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    if (sum !== 0 || lines.some((l) => !Number.isInteger(l.amount))) {
      throw new Error(`Unbalanced ledger posting ${p.key}: ${JSON.stringify(lines)}`);
    }
    if (lines.length === 0) return true;
    if (await LedgerEntryModel.exists({ idempotencyKey: `${p.key}#0` }).session(session)) return false;

    // Net change per wallet, from the user's side (+ = their balance goes up).
    const walletDeltas = new Map<string, number>();
    for (const l of lines) {
      if (!l.account.startsWith(WALLET_PREFIX)) continue;
      const userId = l.account.slice(WALLET_PREFIX.length);
      walletDeltas.set(userId, (walletDeltas.get(userId) ?? 0) - l.amount);
    }
    for (const [userId, delta] of walletDeltas) {
      if (delta === 0) continue;
      const updated = await WalletModel.findOneAndUpdate(
        delta < 0 ? { user: userId, balance: { $gte: -delta } } : { user: userId },
        { $inc: { balance: delta } },
        { session, new: true, upsert: delta > 0 },
      );
      if (!updated) {
        const wallet = await WalletModel.findOne({ user: userId }).session(session);
        throw insufficientFunds(-delta - (wallet?.balance ?? 0));
      }
    }

    await LedgerEntryModel.insertMany(
      lines.map((l, i) => ({
        posting: p.key,
        account: l.account,
        amount: l.amount,
        transaction: p.transactionId,
        memo: p.memo,
        idempotencyKey: `${p.key}#${i}`,
      })),
      { session, ordered: true },
    );
    return true;
  },

  async balance(account: string, session?: ClientSession) {
    const [row] = await LedgerEntryModel.aggregate<{ total: number }>([
      { $match: { account } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).session(session ?? null);
    return row?.total ?? 0;
  },

  /**
   * Sum per account under a prefix, optionally for postings in [from, to). Used by P&L:
   * `sumsByAccount('revenue:charges:', range)`.
   */
  async sumsByAccount(prefix: string, range: { from?: Date; to?: Date } = {}) {
    const rows = await LedgerEntryModel.aggregate<{ _id: string; total: number }>([
      {
        $match: {
          account: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
          ...((range.from || range.to) && {
            createdAt: { ...(range.from && { $gte: range.from }), ...(range.to && { $lt: range.to }) },
          }),
        },
      },
      { $group: { _id: '$account', total: { $sum: '$amount' } } },
    ]);
    return new Map(rows.map((r) => [r._id, r.total]));
  },

  async walletBalance(userId: string | Types.ObjectId) {
    const wallet = await WalletModel.findOne({ user: userId });
    return wallet?.balance ?? 0;
  },

  /** For reconciliation: the cached balance must equal −(ledger sum). */
  async checkWallet(userId: string) {
    const [cached, ledger] = await Promise.all([this.walletBalance(userId), this.balance(Accounts.wallet(userId))]);
    const owed = ledger === 0 ? 0 : -ledger;
    return { cached, ledger: owed, matches: cached === owed };
  },
};
