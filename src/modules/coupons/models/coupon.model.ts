import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SERVICE_IDS, type ServiceId } from '../../../lib/schemas';

/**
 * Every code a user can type at checkout lives here, so codes never clash and checkout
 * does one lookup. `kind` decides the rules:
 *
 *   coupon  made and prepaid by a user. Each person who claims it gets `unitAmount` to
 *           spend across bills until it expires; `quantity` is how many people can claim.
 *   gift    a coupon for exactly one phone number (quantity 1).
 *   promo   made by Tasa staff and paid for by Tasa (`expense:promotions`): percent or fixed
 *           off, capped per use, limited by a budget and per-user uses.
 *
 * `fundedBy` says whose money a coupon/gift spends. A user's sits in ledger account
 * `coupon:<id>` until it's spent or returned at expiry. A Tasa giveaway holds no money:
 * each use is booked to `expense:giveaways:<id>` as it happens, so its cost is exact.
 * Promos are always Tasa's.
 */
export const FUNDERS = ['user', 'tasa'] as const;
export type Funder = (typeof FUNDERS)[number];
export const COUPON_KINDS = ['coupon', 'gift', 'promo'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

export const PROMO_AUDIENCES = ['all', 'first_bill', 'bvn_on_file'] as const;
export type PromoAudience = (typeof PROMO_AUDIENCES)[number];

export type PromoRules = {
  valueType: 'percent' | 'fixed';
  /** Percent 1–100, or kobo. */
  value: number;
  /** Most one use can take off, kobo. null = no cap (only sensible for small fixed promos). */
  maxDiscount: number | null;
  /** Smallest bill (face value) the code works on, kobo. */
  minSpend: number;
  /** Discount the bill itself, or only our charges on it. */
  appliesTo: 'amount' | 'fee';
  /** Total Tasa will spend on this promo, kobo. */
  budget: number;
  /** Discount given so far, kobo. Only moves inside purchase/refund transactions. */
  spent: number;
  usesPerUser: number;
  audience: PromoAudience;
  /** Applied without a code to every eligible bill. */
  autoApply: boolean;
  /** Shown in the app's promotions list. Hidden codes are for partners and influencers. */
  listed: boolean;
};

export interface ICoupon {
  _id: Types.ObjectId;
  code: string;
  kind: CouponKind;
  title: string;
  description?: string;
  fundedBy: Funder;
  /** The user who paid for it. Tasa giveaways and promos have none. */
  owner?: Types.ObjectId | null;
  /** The admin who created a promo. */
  createdBy?: Types.ObjectId;
  services: ServiceId[] | 'all';
  /** Promo only: limit to these provider codes (e.g. ['MTN']). Empty = any. */
  providers: string[];
  status: 'active' | 'paused' | 'expired' | 'cancelled';
  startsAt: Date;
  expiresAt: Date;

  // coupon / gift
  /** What each claimant can spend, kobo. */
  unitAmount?: number;
  /** How many people can claim it. */
  quantity?: number;
  claimed: number;
  /**
   * Gift recipient. When the sender's username/phone/email matched a Tasa user, the gift is
   * locked to that account. Otherwise it waits for whoever signs up with the phone/email
   * the sender typed.
   */
  recipientUser?: Types.ObjectId | null;
  recipientPhone?: string;
  recipientEmail?: string;
  /** Exactly what the sender typed (@ada / 0803… / ada@x.com) — the only form shown to them. */
  recipientLabel?: string;
  recipientName?: string;
  /** When the recipient first saw it in their gift inbox (drives the unseen badge). */
  recipientSeenAt?: Date;
  message?: string;
  /** Set once unused money has gone back to the owner. */
  settledAt?: Date;
  /** When it was closed to new claims. Claimants keep their balance, so `status` can stay active. */
  closedAt?: Date;

  promo?: PromoRules;
  createdAt: Date;
  updatedAt: Date;
}

const promoSchema = new Schema<PromoRules>(
  {
    valueType: { type: String, enum: ['percent', 'fixed'], required: true },
    value: { type: Number, required: true, min: 1, validate: Number.isInteger },
    maxDiscount: { type: Number, default: null, min: 1 },
    minSpend: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    appliesTo: { type: String, enum: ['amount', 'fee'], default: 'amount' },
    budget: { type: Number, required: true, min: 1, validate: Number.isInteger },
    spent: { type: Number, default: 0, min: 0 },
    usesPerUser: { type: Number, default: 1, min: 1 },
    audience: { type: String, enum: PROMO_AUDIENCES, default: 'all' },
    autoApply: { type: Boolean, default: false },
    listed: { type: Boolean, default: true },
  },
  { _id: false },
);

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    kind: { type: String, enum: COUPON_KINDS, required: true },
    fundedBy: { type: String, enum: FUNDERS, default: 'user' },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    services: {
      type: Schema.Types.Mixed,
      required: true,
      validate: (v: unknown) => v === 'all' || (Array.isArray(v) && v.length > 0 && v.every((s) => SERVICE_IDS.includes(s))),
    },
    providers: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'paused', 'expired', 'cancelled'], default: 'active' },
    startsAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    unitAmount: { type: Number, min: 1, validate: Number.isInteger },
    quantity: { type: Number, min: 1, validate: Number.isInteger },
    claimed: { type: Number, default: 0, min: 0 },
    recipientUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    recipientPhone: String,
    recipientEmail: String,
    recipientLabel: String,
    recipientName: String,
    recipientSeenAt: Date,
    message: String,
    settledAt: Date,
    closedAt: Date,
    promo: promoSchema,
  },
  { timestamps: true },
);

couponSchema.index({ recipientPhone: 1, status: 1 }, { partialFilterExpression: { recipientPhone: { $type: 'string' } } });
couponSchema.index({ recipientEmail: 1, status: 1 }, { partialFilterExpression: { recipientEmail: { $type: 'string' } } });
couponSchema.index({ recipientUser: 1, status: 1 }, { partialFilterExpression: { recipientUser: { $type: 'objectId' } } });
couponSchema.index({ kind: 1, status: 1, expiresAt: 1 });
couponSchema.index({ fundedBy: 1, kind: 1, createdAt: -1 });
couponSchema.index({ 'promo.autoApply': 1, status: 1 }, { partialFilterExpression: { kind: 'promo' } });

export const CouponModel = model<ICoupon>('Coupon', couponSchema);
export type CouponDoc = HydratedDocument<ICoupon>;

/**
 * One user's share of one code. Coupons/gifts: `allowance` is theirs to spend and `used`
 * how much they have. Promos: `uses` counts against `usesPerUser`. A failed bill gives
 * back exactly what its CouponUse took.
 */
export interface ICouponClaim {
  _id: Types.ObjectId;
  coupon: Types.ObjectId;
  user: Types.ObjectId;
  allowance: number | null;
  used: number;
  uses: number;
  createdAt: Date;
  updatedAt: Date;
}

const claimSchema = new Schema<ICouponClaim>(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    allowance: { type: Number, default: null },
    used: { type: Number, default: 0, min: 0 },
    uses: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);
claimSchema.index({ coupon: 1, user: 1 }, { unique: true });
claimSchema.index({ user: 1, updatedAt: -1 });

export const CouponClaimModel = model<ICouponClaim>('CouponClaim', claimSchema);

/** One row per bill a code was used on. */
export interface ICouponUse {
  coupon: Types.ObjectId;
  user: Types.ObjectId;
  transaction: Types.ObjectId;
  amount: number;
  createdAt: Date;
}

const useSchema = new Schema<ICouponUse>(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, unique: true },
    amount: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const CouponUseModel = model<ICouponUse>('CouponUse', useSchema);
