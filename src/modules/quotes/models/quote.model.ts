import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SERVICE_IDS, type ServiceId } from '../../../lib/schemas';
import type { ChargeLine } from '../../transactions/models/transaction.model';

export const QUOTE_KINDS = ['funding', 'bill', 'transfer', 'coupon', 'gift', 'ticket', 'ticket_payout', 'group_dues', 'group_payout', 'split_share'] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

/**
 * A priced, single-use offer: "₦10,000 + ₦100 charge = ₦10,100". The app shows it, the
 * user confirms, and the action endpoint consumes it by id — so what the user saw is
 * exactly what they're charged, and charge changes never surprise someone mid-checkout.
 */
export interface IQuote {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  kind: QuoteKind;
  amount: number;
  charges: ChargeLine[];
  fee: number;
  discount: number;
  total: number;
  bill?: {
    serviceId: ServiceId;
    provider: string;
    account: string;
    product?: 'airtime' | 'data';
    meterType?: 'prepaid' | 'postpaid';
    planCode?: string;
    planName?: string;
    billersCode?: string;
    serviceID?: string;
    customer?: { name: string; address?: string; detail?: { label: string; value: string } };
  };
  /** `auto` = an auto-apply promo the user didn't type. */
  coupon?: { id: Types.ObjectId; code: string; kind: 'coupon' | 'gift' | 'promo'; fundedBy: 'user' | 'tela'; title: string; auto?: boolean };
  transfer?: { recipient: Types.ObjectId; username?: string; name: string; note?: string };
  couponCreate?: { title: string; code?: string; quantity: number; unitAmount: number; services: ServiceId[] | 'all'; expiresAt: Date };
  gift?: {
    recipientUser?: Types.ObjectId;
    recipientPhone?: string;
    recipientEmail?: string;
    recipientLabel: string;
    recipientName?: string;
    serviceId: ServiceId | null;
    message?: string;
  };
  ticket?: {
    event: Types.ObjectId;
    tier: Types.ObjectId;
    tierName: string;
    eventTitle: string;
    quantity: number;
    unitPrice: number;
    /** Per ticket, taken from what the organiser receives. */
    sellingFee: number;
  };
  /** Ticket sales to the seller's bank. The account is fixed here, so a change after quoting can't redirect it. */
  ticketPayout?: { bankCode: string; bankName: string; accountNumber: string; accountName: string };
  /**
   * Dues: which member pays how many periods, from when to when, at the plan's price.
   * `groupFee` is taken from what the group receives. `termsVersion` is what they accepted.
   */
  groupDues?: {
    group: Types.ObjectId;
    member: Types.ObjectId;
    /** The periods chosen of each due, at its price. The payment applies only if none got paid meanwhile. */
    items: { due: Types.ObjectId; name: string; amount: number; periods: number[] }[];
    groupFee: number;
    termsVersion: number;
  };
  /** A group's withdrawal. The account is copied in, so a change after quoting can't redirect it. */
  groupPayout?: { group: Types.ObjectId; bankCode: string; bankName: string; accountNumber: string; accountName: string };
  splitShare?: { split: Types.ObjectId };
  beneficiary?: Types.ObjectId;
  /** "Pay their bill" — a bill bought as a gift for someone. */
  giftTo?: {
    /** Set when the recipient is a Tela user (found by username/phone/email). */
    user?: Types.ObjectId;
    phone?: string;
    email?: string;
    /** What the sender typed — the only form shown to the sender. */
    label: string;
    name?: string;
    message?: string;
  };
  usedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

const quoteSchema = new Schema<IQuote>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: QUOTE_KINDS, required: true },
    amount: { type: Number, required: true },
    charges: [{ _id: false, code: String, label: String, amount: Number }],
    fee: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    bill: {
      serviceId: { type: String, enum: SERVICE_IDS },
      provider: String,
      account: String,
      product: { type: String, enum: ['airtime', 'data'] },
      meterType: { type: String, enum: ['prepaid', 'postpaid'] },
      planCode: String,
      planName: String,
      billersCode: String,
      serviceID: String,
      customer: { name: String, address: String, detail: { label: String, value: String } },
    },
    coupon: {
      id: { type: Schema.Types.ObjectId, ref: 'Coupon' },
      code: String,
      kind: { type: String, enum: ['coupon', 'gift', 'promo'] },
      fundedBy: { type: String, enum: ['user', 'tela'] },
      title: String,
      auto: Boolean,
    },
    transfer: { recipient: { type: Schema.Types.ObjectId, ref: 'User' }, username: String, name: String, note: String },
    couponCreate: {
      title: String,
      code: String,
      quantity: Number,
      unitAmount: Number,
      services: Schema.Types.Mixed,
      expiresAt: Date,
    },
    gift: {
      recipientUser: { type: Schema.Types.ObjectId, ref: 'User' },
      recipientPhone: String,
      recipientEmail: String,
      recipientLabel: String,
      recipientName: String,
      serviceId: { type: String, enum: [...SERVICE_IDS, null] },
      message: String,
    },
    ticket: {
      event: { type: Schema.Types.ObjectId, ref: 'Event' },
      tier: Schema.Types.ObjectId,
      tierName: String,
      eventTitle: String,
      quantity: Number,
      unitPrice: Number,
      sellingFee: Number,
    },
    ticketPayout: { bankCode: String, bankName: String, accountNumber: String, accountName: String },
    groupDues: {
      group: { type: Schema.Types.ObjectId, ref: 'Group' },
      member: { type: Schema.Types.ObjectId, ref: 'GroupMember' },
      items: [{ _id: false, due: Schema.Types.ObjectId, name: String, amount: Number, periods: [Number] }],
      groupFee: Number,
      termsVersion: Number,
    },
    groupPayout: { group: { type: Schema.Types.ObjectId, ref: 'Group' }, bankCode: String, bankName: String, accountNumber: String, accountName: String },
    splitShare: { split: { type: Schema.Types.ObjectId, ref: 'Split' } },
    beneficiary: { type: Schema.Types.ObjectId, ref: 'Beneficiary' },
    giftTo: {
      user: { type: Schema.Types.ObjectId, ref: 'User' },
      phone: String,
      email: String,
      label: String,
      name: String,
      message: String,
    },
    usedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Keep used/expired quotes a day for support, then let Mongo drop them.
quoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const QuoteModel = model<IQuote>('Quote', quoteSchema);
export type QuoteDoc = HydratedDocument<IQuote>;
