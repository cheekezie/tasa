import type { ClientSession, FilterQuery, Types } from 'mongoose';
import { inTransaction, isDuplicateKey } from '../../lib/db';
import { randomCode } from '../../lib/crypto';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { formatNaira } from '../../lib/money';
import { newReference } from '../../lib/references';
import { paginate } from '../../lib/response';
import type { ServiceId } from '../../lib/schemas';
import { ChargesService } from '../charges/charges.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { QuotesService, toQuoteDto } from '../quotes/quotes.service';
import { TransactionModel } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { PinService } from '../users/pin.service';
import { UserModel } from '../users/models/user.model';
import { UsersService, publicName, staffUserLabels } from '../users/users.service';
import { adminNames } from '../admins/admins.service';
import { recipientLabel, type Recipient } from '../../lib/schemas';
import type { CouponQuoteInput, CreatePromoInput, GiftQuoteInput, TelaCouponInput, UpdatePromoInput } from './coupons.schema';
import {
  CouponClaimModel,
  CouponModel,
  CouponUseModel,
  type CouponDoc,
  type CouponKind,
  type ICoupon,
  type ICouponClaim,
  type PromoRules,
} from './models/coupon.model';

const DAY = 86_400_000;
const GIFT_TTL_DAYS = 30;
const COUPON_TTL_DAYS = 30;

const generateCode = () => `${randomCode(4)}-${randomCode(4)}`;

/** What checkout knows about the bill when it evaluates a code. */
export type BillContext = { serviceId: ServiceId; provider: string; amount: number; fee: number };
/** How a quote / transaction refers to the code it used. */
export type CouponRef = { id: Types.ObjectId; kind: CouponKind; fundedBy?: 'user' | 'tela' };

const reject = (message: string, code: string) => unprocessable(message, code);

export function describePromo(p: PromoRules) {
  const off = p.valueType === 'percent' ? `${p.value}% off` : `${formatNaira(p.value)} off`;
  const what = p.appliesTo === 'fee' ? ' service charges' : '';
  const cap = p.maxDiscount ? `, up to ${formatNaira(p.maxDiscount)}` : '';
  const min = p.minSpend ? ` · bills from ${formatNaira(p.minSpend)}` : '';
  const uses = p.usesPerUser > 1 ? ` · ${p.usesPerUser} uses each` : '';
  return `${off}${what}${cap}${min}${uses}`;
}

/**
 * Turns what the sender typed into where the gift goes. A match locks it to that account;
 * an unknown phone/email becomes an invite. An unknown username is an error.
 */
async function resolveGiftRecipient(senderId: string | null, r: Recipient, recipientName?: string) {
  const user = await UsersService.resolve(r);
  if (senderId && user?.id === senderId) throw unprocessable("You can't gift yourself", 'SELF_GIFT');
  if (!user && r.type === 'username') throw notFound(`There's no Tela user @${r.value}`);
  return {
    recipientLabel: recipientLabel(r),
    recipientName: recipientName ?? (user ? publicName(user) : undefined),
    ...(user
      ? { recipientUser: user._id }
      : r.type === 'phone'
        ? { recipientPhone: r.value }
        : { recipientEmail: r.value }),
  };
}

/**
 * Mongo conditions for "gifts addressed to this user". Only adds a condition for what the
 * user actually has: an undefined value would be dropped by Mongo and match everyone's gifts.
 */
export function giftConditionsFor(u: { _id: Types.ObjectId; phone?: string; email?: string }): FilterQuery<ICoupon>[] {
  const mine: FilterQuery<ICoupon>[] = [{ recipientUser: u._id }];
  if (u.phone) mine.push({ recipientUser: null, recipientPhone: u.phone });
  if (u.email) mine.push({ recipientUser: null, recipientEmail: u.email });
  return mine;
}

/** Whether this user may use this gift. */
export function isGiftRecipient(c: Pick<ICoupon, 'recipientUser' | 'recipientPhone' | 'recipientEmail'>, u: { _id: Types.ObjectId; phone?: string; email?: string } | null) {
  if (!u) return false;
  if (c.recipientUser) return c.recipientUser.toString() === u._id.toString();
  if (c.recipientPhone) return Boolean(u.phone) && u.phone === c.recipientPhone;
  if (c.recipientEmail) return Boolean(u.email) && u.email === c.recipientEmail;
  return true;
}

const isAddressedGift = (c: Pick<ICoupon, 'recipientUser' | 'recipientPhone' | 'recipientEmail'>) =>
  Boolean(c.recipientUser || c.recipientPhone || c.recipientEmail);

const remainingFor = (claim: Pick<ICouponClaim, 'allowance' | 'used'> | null | undefined) =>
  claim?.allowance == null ? null : Math.max(0, claim.allowance - claim.used);

export function toCouponDto(c: ICoupon, viewerId?: string, claim?: ICouponClaim | null) {
  const isOwner = Boolean(viewerId && c.owner?.toString() === viewerId);
  const base = {
    id: c._id.toString(),
    code: c.code,
    kind: c.kind,
    fundedBy: c.kind === 'promo' ? ('tela' as const) : c.fundedBy,
    title: c.title,
    description: c.description ?? null,
    services: c.services,
    providers: c.providers,
    status: c.status,
    startsAt: c.startsAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  };
  if (c.kind === 'promo') {
    const p = c.promo!;
    return {
      ...base,
      terms: {
        valueType: p.valueType,
        value: p.value,
        maxDiscount: p.maxDiscount,
        minSpend: p.minSpend,
        appliesTo: p.appliesTo,
        usesPerUser: p.usesPerUser,
        summary: describePromo(p),
      },
      autoApply: p.autoApply,
      ...(claim && { myUses: claim.uses, myUsesLeft: Math.max(0, p.usesPerUser - claim.uses) }),
    };
  }
  return {
    ...base,
    /** What each person who claims it can spend, kobo. Matches the app's Coupon.amount. */
    amount: c.unitAmount!,
    quantity: c.quantity!,
    /** People who have claimed it. Matches the app's Coupon.redeemed. */
    redeemed: c.claimed,
    remaining: Math.max(0, c.quantity! - c.claimed),
    message: c.message ?? null,
    isOwner,
    ...(isOwner && { recipient: c.recipientLabel ? { label: c.recipientLabel, name: c.recipientName ?? null } : null }),
    /** The viewer's own balance on this code, once they've used it. */
    myBalance: claim ? { allowance: claim.allowance, used: claim.used, left: remainingFor(claim) } : null,
  };
}

export function toPromoAdminDto(c: ICoupon, stats: { uses: number; users: number }) {
  const p = c.promo!;
  return {
    ...toCouponDto(c),
    rules: p,
    stats: { ...stats, spent: p.spent, budgetLeft: Math.max(0, p.budget - p.spent) },
    createdBy: c.createdBy?.toString() ?? null,
  };
}

const hasPaidABill = async (userId: string) => Boolean(await TransactionModel.exists({ user: userId, kind: 'bill', status: 'success' }));

/** Why this user isn't in a promo's audience, or null. Checkout and the banners both ask here. */
function audienceBlock(p: PromoRules, user: { bvnStatus?: string | undefined } | null, paidABill: boolean) {
  if (p.audience === 'bvn_on_file' && user?.bvnStatus !== 'verified') return 'Verify your BVN in your profile to use this promo';
  if (p.audience === 'first_bill' && paidABill) return 'This promo is for your first bill payment';
  return null;
}

function scopeAllows(c: ICoupon, ctx: Pick<BillContext, 'serviceId' | 'provider'>) {
  if (c.services !== 'all' && !c.services.includes(ctx.serviceId)) return false;
  return c.providers.length === 0 || c.providers.includes(ctx.provider.toUpperCase());
}

function promoDiscount(p: PromoRules, ctx: BillContext) {
  const base = p.appliesTo === 'fee' ? ctx.fee : ctx.amount;
  const raw = p.valueType === 'percent' ? Math.floor((base * p.value) / 100) : p.value;
  return Math.min(raw, p.maxDiscount ?? Infinity, base, p.budget - p.spent);
}

export const CouponsService = {
  // ── Creating coupons and gifts (users) ────────────────────────────────
  async quoteCoupon(userId: string, input: CouponQuoteInput) {
    if (input.code && (await CouponModel.exists({ code: input.code }))) throw conflict('That code is taken', 'CODE_TAKEN');
    const total = input.amount * input.quantity;
    const { charges, fee } = await ChargesService.compute({ scope: 'coupon' }, total);
    const quote = await QuotesService.create(userId, {
      kind: 'coupon',
      amount: total,
      charges,
      fee,
      couponCreate: {
        title: input.title,
        code: input.code,
        quantity: input.quantity,
        unitAmount: input.amount,
        services: input.services,
        expiresAt: input.expiresAt ?? new Date(Date.now() + COUPON_TTL_DAYS * DAY),
      },
    });
    return toQuoteDto(quote);
  },

  async quoteGift(userId: string, input: GiftQuoteInput) {
    const recipient = await resolveGiftRecipient(userId, input.recipient, input.recipientName);
    const { charges, fee } = await ChargesService.compute({ scope: 'gift', serviceId: input.serviceId }, input.amount);
    const quote = await QuotesService.create(userId, {
      kind: 'gift',
      amount: input.amount,
      charges,
      fee,
      gift: { ...recipient, serviceId: input.serviceId, message: input.message },
    });
    return toQuoteDto(quote);
  },

  /** Debits the wallet and parks the money in the coupon's ledger account. */
  async create(userId: string, quoteId: string, pin: string, kind: 'coupon' | 'gift') {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return { transaction: toTransactionDto(existing), coupon: null };
    await PinService.verify(userId, pin);

    const sender = await UserModel.findById(userId).select('fullName username');
    const result = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, kind, session);
      const spec = quote.couponCreate;
      const gift = quote.gift;
      let coupon: CouponDoc;
      try {
        [coupon] = (await CouponModel.create(
          [
            kind === 'coupon'
              ? {
                  code: spec!.code ?? generateCode(),
                  kind,
                  owner: userId,
                  title: spec!.title,
                  unitAmount: spec!.unitAmount,
                  quantity: spec!.quantity,
                  services: spec!.services,
                  expiresAt: spec!.expiresAt,
                }
              : {
                  code: generateCode(),
                  kind,
                  owner: userId,
                  title: `Gift from ${sender?.fullName ?? `@${sender?.username ?? 'a Tela user'}`}`,
                  unitAmount: quote.amount,
                  quantity: 1,
                  services: gift!.serviceId ? [gift!.serviceId] : 'all',
                  recipientUser: gift!.recipientUser ?? null,
                  recipientPhone: gift!.recipientPhone,
                  recipientEmail: gift!.recipientEmail,
                  recipientLabel: gift!.recipientLabel,
                  recipientName: gift!.recipientName,
                  message: gift!.message,
                  expiresAt: new Date(Date.now() + GIFT_TTL_DAYS * DAY),
                },
          ],
          { session },
        )) as [CouponDoc];
      } catch (err) {
        if (isDuplicateKey(err)) throw conflict('That code was just taken. Choose another', 'CODE_TAKEN');
        throw err;
      }
      const [tx] = await TransactionModel.create(
        [
          {
            reference: newReference(kind),
            user: userId,
            kind: kind === 'coupon' ? 'coupon_funding' : 'gift',
            direction: 'debit',
            status: 'success',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            coupon: { id: coupon._id, code: coupon.code, kind },
            ...(gift && {
              counterparty: { ...(gift.recipientUser && { user: gift.recipientUser }), name: gift.recipientName ?? gift.recipientLabel },
              ...(gift.serviceId && { bill: { serviceId: gift.serviceId, provider: '', account: '' } }),
            }),
            completedAt: new Date(),
            events: [{ type: 'success', at: new Date() }],
          },
        ],
        { session },
      );
      await LedgerService.post(
        {
          key: `coupon:${coupon.id}:fund`,
          memo: `${kind === 'gift' ? 'Gift' : 'Coupon'} ${coupon.code}`,
          transactionId: tx!._id,
          lines: [
            { account: Accounts.wallet(userId), amount: quote.total },
            { account: Accounts.coupon(coupon._id), amount: -quote.amount },
            { account: Accounts.charges(kind), amount: -quote.fee },
          ],
        },
        session,
      );
      return { tx: tx!, coupon };
    });
    if (kind === 'gift') bus.emit('gift.created', { couponId: result.coupon.id });
    return { transaction: toTransactionDto(result.tx), coupon: toCouponDto(result.coupon, userId) };
  },

  // ── Checkout ──────────────────────────────────────────────────────────
  /**
   * Can this user use this code on this bill, and for how much? Read-only: nothing is
   * reserved until `redeem` runs inside the purchase transaction.
   */
  async evaluate(codeOrCoupon: string | CouponDoc, userId: string, ctx: BillContext) {
    const coupon =
      typeof codeOrCoupon === 'string' ? await CouponModel.findOne({ code: codeOrCoupon.trim().toUpperCase() }) : codeOrCoupon;
    if (!coupon) throw reject("We couldn't find that code", 'COUPON_NOT_FOUND');
    const now = new Date();
    if (coupon.status === 'cancelled') throw reject('This code is no longer available', 'COUPON_CANCELLED');
    if (coupon.status === 'paused') throw reject('This code is paused right now', 'COUPON_PAUSED');
    if (coupon.startsAt > now) throw reject(`This code starts on ${coupon.startsAt.toDateString()}`, 'COUPON_NOT_STARTED');
    if (coupon.status === 'expired' || coupon.expiresAt <= now) throw reject('This code has expired', 'COUPON_EXPIRED');
    if (!scopeAllows(coupon, ctx)) throw reject("This code can't be used for this bill", 'COUPON_WRONG_SERVICE');

    const [user, claim] = await Promise.all([
      UserModel.findById(userId).select('phone email bvnStatus'),
      CouponClaimModel.findOne({ coupon: coupon._id, user: userId }),
    ]);

    if (coupon.kind !== 'promo') {
      if (isAddressedGift(coupon) && !isGiftRecipient(coupon, user)) {
        const missing = !coupon.recipientUser && ((coupon.recipientPhone && !user?.phone) || (coupon.recipientEmail && !user?.email));
        throw reject(
          missing ? `Add the ${coupon.recipientPhone ? 'phone number' : 'email'} this gift was sent to, to use it` : 'This gift belongs to someone else',
          'COUPON_NOT_YOURS',
        );
      }
      if (claim) {
        const left = remainingFor(claim) ?? 0;
        if (left <= 0) throw reject("You've used up this code's balance", 'COUPON_BALANCE_EMPTY');
        return { coupon, discount: Math.min(left, ctx.amount) };
      }
      if (coupon.claimed >= coupon.quantity!) throw reject('This code has been fully claimed', 'COUPON_USED_UP');
      return { coupon, discount: Math.min(coupon.unitAmount!, ctx.amount) };
    }

    const p = coupon.promo!;
    const notForYou = audienceBlock(p, user, await hasPaidABill(userId));
    if (notForYou) throw reject(notForYou, 'COUPON_AUDIENCE');
    if ((claim?.uses ?? 0) >= p.usesPerUser) {
      throw reject(p.usesPerUser === 1 ? "You've already used this promo" : `You've used this promo ${p.usesPerUser} times`, 'COUPON_LIMIT_REACHED');
    }
    if (ctx.amount < p.minSpend) throw reject(`${coupon.code} applies to bills of ${formatNaira(p.minSpend)} or more`, 'COUPON_MIN_SPEND');
    if (p.spent >= p.budget) throw reject('This promo has ended', 'PROMO_ENDED');
    const discount = promoDiscount(p, ctx);
    if (discount <= 0) throw reject("This promo doesn't apply to this bill", 'COUPON_NOT_APPLICABLE');
    return { coupon, discount };
  },

  /** The best auto-apply promo for this bill, if any. Never throws. */
  async bestAutoPromo(userId: string, ctx: BillContext) {
    const now = new Date();
    const candidates = await CouponModel.find({
      kind: 'promo',
      status: 'active',
      'promo.autoApply': true,
      startsAt: { $lte: now },
      expiresAt: { $gt: now },
    }).limit(20);
    let best: { coupon: CouponDoc; discount: number } | null = null;
    for (const c of candidates) {
      const result = await this.evaluate(c, userId, ctx).catch(() => null);
      if (result && (!best || result.discount > best.discount)) best = result;
    }
    return best;
  },

  /**
   * The user's own money-off to use without typing a code: gifts sent to them, and coupons
   * they've already started spending. Picks the one expiring soonest, so nothing is wasted.
   * Never throws.
   */
  async bestBalance(userId: string, ctx: BillContext) {
    const user = await UserModel.findById(userId).select('phone email');
    if (!user) return null;
    const now = new Date();
    const live = { status: 'active', startsAt: { $lte: now }, expiresAt: { $gt: now } };
    const claimed = await CouponClaimModel.find({ user: userId, allowance: { $ne: null }, $expr: { $lt: ['$used', '$allowance'] } }).select('coupon');
    const candidates = await CouponModel.find({
      ...live,
      kind: { $in: ['coupon', 'gift'] },
      $or: [{ kind: 'gift', $or: giftConditionsFor(user) }, { _id: { $in: claimed.map((c) => c.coupon) } }],
    })
      .sort({ expiresAt: 1 })
      .limit(20);
    for (const c of candidates) {
      const result = await this.evaluate(c, userId, ctx).catch(() => null);
      if (result && result.discount > 0) return result;
    }
    return null;
  },

  /** Where a discount's money comes from in the ledger. */
  discountAccount: (ref: CouponRef) =>
    ref.kind === 'promo' ? Accounts.promotions(ref.id) : ref.fundedBy === 'tela' ? Accounts.giveaways(ref.id) : Accounts.coupon(ref.id),

  /**
   * Inside the bill purchase transaction: takes the discount from the user's claim (and the
   * promo budget). Throws — rolling the whole purchase back — if anything changed since
   * the quote, so a user can never get more than the code allows.
   */
  async redeem(ref: CouponRef, userId: string, transactionId: Types.ObjectId, amount: number, session: ClientSession) {
    const now = new Date();
    const live = { _id: ref.id, status: 'active', startsAt: { $lte: now }, expiresAt: { $gt: now } };
    let coupon: CouponDoc | null;
    if (ref.kind === 'promo') {
      coupon = await CouponModel.findOneAndUpdate(
        { ...live, $expr: { $lte: [{ $add: ['$promo.spent', amount] }, '$promo.budget'] } },
        { $inc: { 'promo.spent': amount } },
        { new: true, session },
      );
      if (!coupon) throw reject('This promo ended before your payment went through. Review the payment again', 'PROMO_ENDED');
    } else {
      coupon = await CouponModel.findOne(live).session(session);
      if (!coupon) throw reject('This code is no longer available. Review the payment again', 'COUPON_EXPIRED');
    }

    const upserted = await CouponClaimModel.findOneAndUpdate(
      { coupon: ref.id, user: userId },
      { $setOnInsert: { allowance: ref.kind === 'promo' ? null : coupon.unitAmount, used: 0, uses: 0 } },
      { upsert: true, new: true, session, includeResultMetadata: true },
    );
    const isNewClaim = !upserted.lastErrorObject?.updatedExisting;
    if (isNewClaim && ref.kind !== 'promo') {
      const slot = await CouponModel.updateOne(
        { _id: ref.id, $expr: { $lt: ['$claimed', '$quantity'] } },
        { $inc: { claimed: 1 } },
        { session },
      );
      if (slot.modifiedCount === 0) throw reject('This code was fully claimed before your payment went through', 'COUPON_USED_UP');
    }

    const limit =
      ref.kind === 'promo'
        ? { uses: { $lt: coupon.promo!.usesPerUser } }
        : { $expr: { $lte: [{ $add: ['$used', amount] }, '$allowance'] } };
    const claim = await CouponClaimModel.findOneAndUpdate(
      { _id: upserted.value!._id, ...limit },
      { $inc: { used: amount, uses: 1 } },
      { new: true, session },
    );
    if (!claim) {
      throw reject(
        ref.kind === 'promo' ? "You've already used this promo" : "This code's balance changed. Review the payment again",
        ref.kind === 'promo' ? 'COUPON_LIMIT_REACHED' : 'COUPON_BALANCE_CHANGED',
      );
    }
    await CouponUseModel.create([{ coupon: ref.id, user: userId, transaction: transactionId, amount }], { session });
  },

  /** A failed bill gives back exactly what its use took: balance, use count, budget, slot. */
  async release(ref: CouponRef, transactionId: Types.ObjectId, session: ClientSession) {
    const use = await CouponUseModel.findOneAndDelete({ transaction: transactionId }, { session });
    if (!use) return;
    const claim = await CouponClaimModel.findOneAndUpdate(
      { coupon: use.coupon, user: use.user },
      { $inc: { used: -use.amount, uses: -1 } },
      { new: true, session },
    );
    if (ref.kind === 'promo') {
      await CouponModel.updateOne({ _id: use.coupon }, { $inc: { 'promo.spent': -use.amount } }, { session });
      return;
    }
    const freesSlot = claim?.uses === 0;
    if (freesSlot) await CouponClaimModel.deleteOne({ _id: claim._id }, { session });
    // The refunded discount lands back in the pool; if the pool was already settled, reopen
    // it so the next sweep returns that money to the owner.
    await CouponModel.updateOne(
      { _id: use.coupon },
      { ...(freesSlot && { $inc: { claimed: -1 } }), $unset: { settledAt: 1 } },
      { session },
    );
  },

  // ── Reading ───────────────────────────────────────────────────────────
  /** Coupons this user created. Gifts they sent are in `GET /gifts/history`. */
  async listMine(userId: string, page: number, limit: number) {
    const filter = { owner: userId, kind: 'coupon' };
    const [items, total] = await Promise.all([
      CouponModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      CouponModel.countDocuments(filter),
    ]);
    return paginate(items.map((c) => toCouponDto(c, userId)), total, page, limit);
  },

  /** Codes this user has used and still has balance on (coupons and gifts). */
  async myBalances(userId: string) {
    const claims = await CouponClaimModel.find({ user: userId, allowance: { $ne: null } }).sort({ updatedAt: -1 }).limit(100);
    const coupons = await CouponModel.find({ _id: { $in: claims.map((c) => c.coupon) }, status: 'active', expiresAt: { $gt: new Date() } });
    const byId = new Map(coupons.map((c) => [c.id as string, c]));
    return claims
      .filter((cl) => (remainingFor(cl) ?? 0) > 0 && byId.has(cl.coupon.toString()))
      .map((cl) => toCouponDto(byId.get(cl.coupon.toString())!, userId, cl));
  },

  /** Gifts sent to this user's phone number that still have money on them. */
  async receivedGifts(userId: string) {
    const user = await UserModel.findById(userId).select('phone email');
    if (!user) return [];
    const gifts = await CouponModel.find({ kind: 'gift', status: 'active', expiresAt: { $gt: new Date() }, $or: giftConditionsFor(user) }).sort({
      createdAt: -1,
    });
    const claims = await CouponClaimModel.find({ user: userId, coupon: { $in: gifts.map((g) => g._id) } });
    const byCoupon = new Map(claims.map((c) => [c.coupon.toString(), c]));
    return gifts
      .map((g) => ({ g, claim: byCoupon.get(g.id as string) ?? null }))
      .filter(({ claim }) => !claim || (remainingFor(claim) ?? 0) > 0)
      .map(({ g, claim }) => toCouponDto(g, userId, claim));
  },

  async getByCode(code: string, userId: string) {
    const coupon = await CouponModel.findOne({ code: code.toUpperCase() });
    if (!coupon) throw notFound("We couldn't find that code");
    if (coupon.kind === 'gift' && coupon.owner?.toString() !== userId) {
      const user = await UserModel.findById(userId).select('phone email');
      if (!isGiftRecipient(coupon, user)) throw notFound("We couldn't find that code");
    }
    const claim = await CouponClaimModel.findOne({ coupon: coupon._id, user: userId });
    return toCouponDto(coupon, userId, claim);
  },

  /** Promos the app can advertise right now. */
  async listedPromos(userId: string) {
    const now = new Date();
    const promos = await CouponModel.find({
      kind: 'promo',
      status: 'active',
      'promo.listed': true,
      startsAt: { $lte: now },
      expiresAt: { $gt: now },
      $expr: { $lt: ['$promo.spent', '$promo.budget'] },
    }).sort({ expiresAt: 1 });
    const [claims, user, paidABill] = await Promise.all([
      CouponClaimModel.find({ user: userId, coupon: { $in: promos.map((p) => p._id) } }),
      UserModel.findById(userId).select('bvnStatus'),
      hasPaidABill(userId),
    ]);
    const byCoupon = new Map(claims.map((c) => [c.coupon.toString(), c]));
    return promos
      .filter((p) => (byCoupon.get(p.id as string)?.uses ?? 0) < p.promo!.usesPerUser)
      .filter((p) => !audienceBlock(p.promo!, user, paidABill))
      .map((p) => toCouponDto(p, userId, byCoupon.get(p.id as string)));
  },

  // ── Owner actions and settlement ──────────────────────────────────────
  /**
   * Stops new claims and returns the unclaimed money now. People who already claimed keep
   * their balance until expiry; whatever they don't spend comes back then.
   */
  async cancel(userId: string, couponId: string) {
    const coupon = await CouponModel.findById(couponId);
    if (!coupon || coupon.kind === 'promo') throw notFound('Giveaway not found');
    if (coupon.owner?.toString() !== userId) throw forbidden();
    await this.close(coupon);
    return toCouponDto((await CouponModel.findById(couponId))!, userId);
  },

  /**
   * Stops new claims. A user-funded coupon returns its unclaimed money to the owner now;
   * a Tela giveaway simply stops costing more. Claimants keep their balance until expiry.
   */
  async close(coupon: ICoupon) {
    const couponId = coupon._id;
    if (coupon.status === 'cancelled') return;
    if (coupon.kind === 'gift' && coupon.claimed > 0) throw unprocessable('This gift has already been used', 'GIFT_USED');

    await inTransaction(async (session) => {
      const c = await CouponModel.findById(couponId).session(session);
      if (!c || c.status === 'cancelled') return;
      const unclaimed = (c.quantity! - c.claimed) * c.unitAmount!;
      const closed = await CouponModel.findOneAndUpdate(
        { _id: c._id, claimed: c.claimed },
        c.claimed === 0
          ? { status: 'cancelled', quantity: 0, settledAt: new Date(), closedAt: new Date() }
          : { quantity: c.claimed, closedAt: new Date() },
        { new: true, session },
      );
      if (!closed) throw new AppError(409, 'Someone just used this code. Try again', 'COUPON_BUSY');
      if (unclaimed > 0 && c.fundedBy === 'user') await this.refundToOwner(c, unclaimed, 'close', session);
    });
  },

  async refundToOwner(c: ICoupon, amount: number, step: string, session: ClientSession) {
    const [tx] = await TransactionModel.create(
      [
        {
          reference: newReference('refund'),
          user: c.owner,
          kind: 'coupon_refund',
          direction: 'credit',
          status: 'success',
          amount,
          total: amount,
          coupon: { id: c._id, code: c.code, kind: c.kind },
          completedAt: new Date(),
          events: [{ type: 'success', at: new Date() }],
        },
      ],
      { session },
    );
    await LedgerService.post(
      {
        key: `coupon:${c._id.toString()}:${step}`,
        memo: `Unused ${c.kind} ${c.code} returned`,
        transactionId: tx!._id,
        lines: [
          { account: Accounts.coupon(c._id), amount },
          { account: Accounts.wallet(c.owner!), amount: -amount },
        ],
      },
      session,
    );
  },

  /**
   * After expiry, returns whatever is left in a coupon/gift pool to its owner. Waits while
   * a bill using it is still pending, since that bill may yet fail and hand its discount back.
   */
  async settle(couponId: Types.ObjectId) {
    if (await TransactionModel.exists({ 'coupon.id': couponId, kind: 'bill', status: 'pending' })) return false;
    return inTransaction(async (session) => {
      const coupon = await CouponModel.findOneAndUpdate(
        { _id: couponId, kind: { $ne: 'promo' }, fundedBy: 'user', settledAt: null, status: { $in: ['expired', 'cancelled'] } },
        { settledAt: new Date() },
        { new: true, session },
      );
      if (!coupon) return false;
      const remaining = -(await LedgerService.balance(Accounts.coupon(coupon._id), session));
      if (remaining <= 0) return false;
      // A settlement can be reopened by a late refund, so each one gets its own key.
      await this.refundToOwner(coupon, remaining, `settle:${coupon.settledAt!.getTime()}`, session);
      return true;
    });
  },

  async sweep() {
    await CouponModel.updateMany({ status: { $in: ['active', 'paused'] }, expiresAt: { $lt: new Date() } }, { status: 'expired' });
    const finished = await CouponModel.find({ kind: { $ne: 'promo' }, fundedBy: 'user', settledAt: null, status: { $in: ['expired', 'cancelled'] } })
      .select('_id')
      .limit(200);
    for (const c of finished) await this.settle(c._id).catch((err) => console.error(`[coupons] settle ${c.id}`, err));
  },

  describeGift(c: ICoupon, senderName: string) {
    const what = c.services === 'all' ? 'any bill' : c.services.join(', ');
    return `${senderName} gifted you ${formatNaira(c.unitAmount!)} for ${what} on Tela. Use code ${c.code} at checkout before ${c.expiresAt.toDateString()}.`;
  },

  // ── Tela giveaways and gifts (admin) ──────────────────────────────────
  /**
   * A coupon or gift Tela pays for: launch giveaways, compensation for a failed token,
   * partner campaigns. No money moves now; each use is booked to `expense:giveaways:<id>`.
   */
  async createTelaCoupon(input: TelaCouponInput, adminId: string) {
    try {
      const c = await CouponModel.create({
        code: input.code ?? generateCode(),
        kind: input.kind,
        fundedBy: 'tela',
        owner: null,
        createdBy: adminId,
        title: input.title,
        description: input.description,
        unitAmount: input.amount,
        quantity: input.kind === 'gift' ? 1 : input.quantity,
        services: input.services,
        startsAt: input.startsAt ?? new Date(),
        expiresAt: input.expiresAt,
        ...(input.kind === 'gift' && { ...(await resolveGiftRecipient(null, input.recipient!, input.recipientName)), message: input.message }),
      });
      if (c.kind === 'gift') bus.emit('gift.created', { couponId: c.id });
      return this.adminCoupon(c);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('That code is already in use', 'CODE_TAKEN');
      throw err;
    }
  },

  /** A coupon or gift with what it has cost (Tela) or what's left in its pool (user). */
  async adminCoupon(c: ICoupon, names?: Awaited<ReturnType<typeof staffUserLabels>>, admins?: Map<string, string>) {
    const people = names ?? (await staffUserLabels([c.owner, c.recipientUser]));
    const staff = admins ?? (await adminNames([c.createdBy]));
    const [agg] = await CouponUseModel.aggregate<{ uses: number; amount: number }>([
      { $match: { coupon: c._id } },
      { $group: { _id: null, uses: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]);
    const used = agg?.amount ?? 0;
    const maxExposure = (c.quantity ?? 0) * (c.unitAmount ?? 0);
    return {
      ...toCouponDto(c),
      owner: c.owner?.toString() ?? null,
      ownerName: c.owner ? (people.get(c.owner.toString())?.name ?? null) : null,
      createdBy: c.createdBy?.toString() ?? null,
      createdByName: c.createdBy ? (staff.get(c.createdBy.toString()) ?? null) : null,
      /** Closed to new claims (claimants keep their balance), or cancelled outright. */
      closed: Boolean(c.closedAt) || c.status === 'cancelled',
      closedAt: c.closedAt?.toISOString() ?? null,
      recipient: c.recipientLabel
        ? {
            label: c.recipientLabel,
            name: c.recipientName ?? null,
            user: c.recipientUser?.toString() ?? null,
            userName: c.recipientUser ? (people.get(c.recipientUser.toString())?.name ?? null) : null,
          }
        : null,
      stats: {
        claims: c.claimed,
        uses: agg?.uses ?? 0,
        /** Discount given so far, kobo. For Tela coupons this is the cost. */
        used,
        ...(c.fundedBy === 'tela'
          ? { cost: await LedgerService.balance(Accounts.giveaways(c._id)), maxExposure, exposureLeft: Math.max(0, maxExposure - used) }
          : { poolLeft: -(await LedgerService.balance(Accounts.coupon(c._id))) || 0 }),
      },
    };
  },

  async adminList(q: { kind?: 'coupon' | 'gift'; fundedBy?: 'user' | 'tela'; status?: ICoupon['status']; owner?: string; code?: string; page: number; limit: number }) {
    const filter: FilterQuery<ICoupon> = {
      kind: q.kind ?? { $in: ['coupon', 'gift'] },
      ...(q.fundedBy && { fundedBy: q.fundedBy }),
      ...(q.status && { status: q.status }),
      ...(q.owner && { owner: q.owner }),
      ...(q.code && { code: q.code.toUpperCase() }),
    };
    const [items, total] = await Promise.all([
      CouponModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      CouponModel.countDocuments(filter),
    ]);
    // One name lookup for the page, not two per row.
    const [names, admins] = await Promise.all([staffUserLabels(items.flatMap((c) => [c.owner, c.recipientUser])), adminNames(items.map((c) => c.createdBy))]);
    return paginate(await Promise.all(items.map((c) => this.adminCoupon(c, names, admins))), total, q.page, q.limit);
  },

  /** One coupon, with who claimed it and what each has left. */
  async adminGet(id: string) {
    const c = await CouponModel.findOne({ _id: id, kind: { $in: ['coupon', 'gift'] } });
    if (!c) throw notFound('Giveaway not found');
    const claims = await CouponClaimModel.find({ coupon: c._id }).sort({ createdAt: -1 }).limit(500).lean();
    const names = await staffUserLabels([c.owner, c.recipientUser, ...claims.map((cl) => cl.user)]);
    return {
      ...(await this.adminCoupon(c, names)),
      claims: claims.map((cl) => ({
        id: cl._id.toString(),
        user: cl.user.toString(),
        userName: names.get(cl.user.toString())?.name ?? null,
        username: names.get(cl.user.toString())?.username ?? null,
        /** Kobo. null for promos (no balance, only uses). */
        allowance: cl.allowance,
        used: cl.used,
        left: cl.allowance === null ? null : Math.max(0, cl.allowance - cl.used),
        uses: cl.uses,
        claimedAt: cl.createdAt.toISOString(),
      })),
    };
  },

  async adminSetPaused(id: string, paused: boolean) {
    const c = await CouponModel.findOneAndUpdate(
      { _id: id, kind: { $in: ['coupon', 'gift'] }, status: { $in: ['active', 'paused'] } },
      { status: paused ? 'paused' : 'active' },
      { new: true },
    );
    if (!c) throw notFound('Giveaway not found or already ended');
    return this.adminCoupon(c);
  },

  /** Support/finance can close any coupon. A user's unclaimed money goes back to them. */
  async adminClose(id: string) {
    const c = await CouponModel.findOne({ _id: id, kind: { $in: ['coupon', 'gift'] } });
    if (!c) throw notFound('Giveaway not found');
    await this.close(c);
    return this.adminCoupon((await CouponModel.findById(id))!);
  },

  // ── Tela promotions (admin) ───────────────────────────────────────────
  async createPromo(input: CreatePromoInput, adminId?: string) {
    const { code, title, description, services, providers, startsAt, expiresAt, ...rules } = input;
    try {
      const c = await CouponModel.create({
        code,
        kind: 'promo',
        title,
        description,
        createdBy: adminId,
        services,
        providers,
        startsAt: startsAt ?? new Date(),
        expiresAt,
        promo: { ...rules, spent: 0 },
      });
      return { promo: toPromoAdminDto(c, { uses: 0, users: 0 }), warnings: promoWarnings(c.promo!) };
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('That code is already in use', 'CODE_TAKEN');
      throw err;
    }
  },

  async updatePromo(id: string, changes: UpdatePromoInput) {
    const c = await CouponModel.findOne({ _id: id, kind: 'promo' });
    if (!c) throw notFound('Promotion not found');
    if (c.status === 'expired' || c.status === 'cancelled') throw unprocessable('This promotion has ended', 'PROMO_ENDED');
    const { title, description, services, providers, startsAt, expiresAt, status, ...rules } = changes;
    if (rules.budget !== undefined && rules.budget < c.promo!.spent) {
      throw unprocessable(`Budget can't go below what's already been spent (${formatNaira(c.promo!.spent)})`, 'BUDGET_TOO_LOW');
    }
    Object.assign(c, {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(services !== undefined && { services }),
      ...(providers !== undefined && { providers }),
      ...(startsAt !== undefined && { startsAt }),
      ...(expiresAt !== undefined && { expiresAt }),
      ...(status !== undefined && { status }),
    });
    Object.assign(c.promo!, rules);
    if (c.promo!.valueType === 'percent' && (c.promo!.value > 100 || c.promo!.maxDiscount == null)) {
      throw unprocessable('Percentage promos need a value of 1–100 and a maxDiscount', 'INVALID_PROMO');
    }
    if (c.expiresAt <= c.startsAt) throw unprocessable('expiresAt must be after startsAt', 'INVALID_PROMO');
    await c.save();
    return { promo: toPromoAdminDto(c, await this.promoStats(c._id)), warnings: promoWarnings(c.promo!) };
  },

  /** Ends a promo now. Spent discounts stay spent; nothing is refunded. */
  async endPromo(id: string) {
    const c = await CouponModel.findOneAndUpdate({ _id: id, kind: 'promo' }, { status: 'cancelled', expiresAt: new Date() }, { new: true });
    if (!c) throw notFound('Promotion not found');
    return toPromoAdminDto(c, await this.promoStats(c._id));
  },

  async promoStats(couponId: Types.ObjectId) {
    const [uses, users] = await Promise.all([
      CouponUseModel.countDocuments({ coupon: couponId }),
      CouponClaimModel.countDocuments({ coupon: couponId, uses: { $gt: 0 } }),
    ]);
    return { uses, users };
  },

  async listPromos(q: { status?: ICoupon['status']; page: number; limit: number }) {
    const filter: FilterQuery<ICoupon> = { kind: 'promo', ...(q.status && { status: q.status }) };
    const [items, total] = await Promise.all([
      CouponModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      CouponModel.countDocuments(filter),
    ]);
    const rows = await Promise.all(items.map(async (c) => toPromoAdminDto(c, await this.promoStats(c._id))));
    return paginate(rows, total, q.page, q.limit);
  },

  async getPromo(id: string) {
    const c = await CouponModel.findOne({ _id: id, kind: 'promo' });
    if (!c) throw notFound('Promotion not found');
    return toPromoAdminDto(c, await this.promoStats(c._id));
  },
};

/** Nudges for risky-but-allowed setups, shown to the admin on save. */
function promoWarnings(p: PromoRules) {
  const warnings: string[] = [];
  if (p.valueType === 'fixed' && p.minSpend === 0 && p.appliesTo === 'amount') {
    warnings.push('A fixed discount with no minimum spend can be farmed with small bills (e.g. free ₦200 airtime). Consider a minSpend.');
  }
  if (p.audience === 'all' && p.usesPerUser > 3 && p.appliesTo === 'amount') {
    warnings.push('More than 3 uses per person on an open promo makes it easy to drain the budget.');
  }
  if (p.autoApply && p.audience === 'all' && p.appliesTo === 'amount') {
    warnings.push('Auto-apply gives this to every eligible bill without a code — watch the budget.');
  }
  return warnings;
}
