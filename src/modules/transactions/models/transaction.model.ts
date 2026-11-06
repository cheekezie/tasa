import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SERVICE_IDS, type ServiceId } from '../../../lib/schemas';

export const TRANSACTION_KINDS = [
  'funding',
  'bill',
  'transfer_out',
  'transfer_in',
  /** Wallet → a coupon pool the user created. */
  'coupon_funding',
  /** Wallet → a gift for someone else. */
  'gift',
  /** Unredeemed coupon/gift money back to its creator. */
  'coupon_refund',
  /** A bank transfer into a beneficiary's virtual account. */
  'beneficiary_collection',
  /** A balance too small to transfer out, given up when closing the account. */
  'balance_forfeited',
  /** Points converted to wallet cash. */
  'points_redemption',
  /** Wallet → an organiser's ticket wallet. */
  'ticket_purchase',
  /** Back to the buyer inside the refund window. */
  'ticket_refund',
  /** An organiser's ticket wallet → their bill payment wallet. Can't be undone. */
  'ticket_withdrawal',
  /** An organiser's ticket wallet → their bank account, through SaySwitch. */
  'ticket_payout',
  /** A member's wallet → their group's balance, for one or more periods. */
  'group_dues',
  /** A group's balance → its locked payout account, through SaySwitch. */
  'group_payout',
  /** A wallet → a split bill's pot. */
  'split_share',
  /** A share back from a split that didn't get paid. */
  'split_refund',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/**
 * pending → success | failed | expired. `reversed` = succeeded, then undone (e.g. a vend
 * the provider later reported as failed).
 */
export const TRANSACTION_STATUSES = ['pending', 'success', 'failed', 'expired', 'reversed'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type ChargeLine = { code: string; label: string; amount: number };

/**
 * One row per thing the user sees in their activity feed. Money itself moves only
 * through LedgerService postings that reference this row.
 */
export interface ITransaction {
  _id: Types.ObjectId;
  reference: string;
  user: Types.ObjectId;
  kind: TransactionKind;
  direction: 'credit' | 'debit';
  status: TransactionStatus;
  /** Face value: the bill, the transfer, the amount credited. Kobo. */
  amount: number;
  fee: number;
  discount: number;
  /** Asked for at checkout: save this account as a beneficiary once the bill succeeds. */
  saveBeneficiary?: { label: string };
  /** What moved on the wallet (debits) or what the user had to send (funding). Kobo. */
  total: number;
  charges: ChargeLine[];
  quote?: Types.ObjectId;
  bill?: {
    serviceId: ServiceId;
    provider: string;
    account: string;
    product?: 'airtime' | 'data';
    meterType?: 'prepaid' | 'postpaid';
    planCode?: string;
    planName?: string;
    /** What the provider is paid against when it differs from `account` (Smile account id). */
    billersCode?: string;
    serviceID?: string;
    customerName?: string;
    token?: string;
    units?: string;
    pins?: { pin: string; serial?: string }[];
  };
  funding?: {
    /** `one_time` = a quoted funding account; `dedicated` = the user's permanent account. */
    channel?: 'one_time' | 'dedicated';
    accountNumber: string;
    bankName: string;
    accountName: string;
    expiresAt: Date;
    amountReceived?: number;
    providerFee?: number;
    /** false = SaySwitch didn't report its fee, so the recorded cost (0) is understated. */
    providerFeeReported?: boolean;
    lastCheckedAt?: Date;
  };
  counterparty?: { user?: Types.ObjectId; username?: string; name?: string; phone?: string };
  coupon?: { id: Types.ObjectId; code: string; kind: 'coupon' | 'gift' | 'promo'; fundedBy?: 'user' | 'tela' };
  beneficiary?: Types.ObjectId;
  /** A bill bought as a gift. The recipient sees it in their gift inbox once delivered. */
  giftTo?: {
    /** Set when the recipient is a Tela user (found by username/phone/email). */
    user?: Types.ObjectId;
    phone?: string;
    email?: string;
    /** What the sender typed — the only form shown to the sender. */
    label: string;
    name?: string;
    message?: string;
    seenAt?: Date;
  };
  recurring?: Types.ObjectId;
  /** VTpass: `requestId` is our request id, `transactionId` theirs; `cost` what they kept from their wallet. */
  /** Where a payout went, as the bank named it when it was requested. */
  payout?: { bankCode: string; bankName: string; accountNumber: string; accountName: string };
  /** The ledger account a payout or a bill was paid from, when it isn't the user's wallet (a group's balance, a split's pot). */
  fundedFrom?: string;
  /** Where it was started. Absent: the app. `web`: a website (guest) order, see `guestOrder`. */
  channel?: 'web';
  guestOrder?: Types.ObjectId;
  group?: { id: Types.ObjectId; name: string; periods?: number; dues?: { id: Types.ObjectId; name: string; periods: number[] }[] };
  split?: { id: Types.ObjectId; title: string };
  providerData?: {
    requestId?: string;
    transactionId?: string;
    sentAt?: Date;
    /** Last time a poll asked the provider (throttles GET /transactions/:reference). */
    lastCheckedAt?: Date;
    code?: string;
    message?: string;
    cost?: number;
    reference?: string;
    /** SaySwitch's payout fee as it quoted it while the payout was pending; booked when it settles. */
    fee?: number;
  };
  vendAttempts: number;
  /** Provider never gave a final answer; money is held until staff resolve it. */
  needsReview: boolean;
  narration?: string;
  events: { type: string; at: Date; note?: string }[];
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    reference: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: TRANSACTION_KINDS, required: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    status: { type: String, enum: TRANSACTION_STATUSES, default: 'pending' },
    amount: { type: Number, required: true, min: 0, validate: Number.isInteger },
    fee: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    discount: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    total: { type: Number, required: true, min: 0, validate: Number.isInteger },
    charges: [{ _id: false, code: String, label: String, amount: Number }],
    quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
    saveBeneficiary: { label: String },
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
      customerName: String,
      token: String,
      units: String,
      pins: [{ _id: false, pin: String, serial: String }],
    },
    funding: {
      channel: { type: String, enum: ['one_time', 'dedicated'] },
      accountNumber: String,
      bankName: String,
      accountName: String,
      expiresAt: Date,
      amountReceived: Number,
      providerFee: Number,
      providerFeeReported: Boolean,
      lastCheckedAt: Date,
    },
    counterparty: {
      user: { type: Schema.Types.ObjectId, ref: 'User' },
      username: String,
      name: String,
      phone: String,
    },
    coupon: { id: { type: Schema.Types.ObjectId, ref: 'Coupon' }, code: String, kind: { type: String, enum: ['coupon', 'gift', 'promo'] }, fundedBy: { type: String, enum: ['user', 'tela'] } },
    beneficiary: { type: Schema.Types.ObjectId, ref: 'Beneficiary' },
    giftTo: {
      user: { type: Schema.Types.ObjectId, ref: 'User' },
      phone: String,
      email: String,
      label: String,
      name: String,
      message: String,
      seenAt: Date,
    },
    recurring: { type: Schema.Types.ObjectId, ref: 'RecurringBill' },
    payout: { bankCode: String, bankName: String, accountNumber: String, accountName: String },
    fundedFrom: String,
    channel: { type: String, enum: ['web'] },
    guestOrder: { type: Schema.Types.ObjectId, ref: 'GuestOrder' },
    group: { id: { type: Schema.Types.ObjectId, ref: 'Group' }, name: String, periods: Number, dues: [{ _id: false, id: Schema.Types.ObjectId, name: String, periods: [Number] }] },
    split: { id: { type: Schema.Types.ObjectId, ref: 'Split' }, title: String },
    providerData: {
      requestId: String,
      transactionId: String,
      sentAt: Date,
      lastCheckedAt: Date,
      code: String,
      message: String,
      cost: Number,
      reference: String,
      fee: Number,
    },
    vendAttempts: { type: Number, default: 0 },
    needsReview: { type: Boolean, default: false },
    narration: String,
    events: [{ _id: false, type: { type: String }, at: { type: Date, default: Date.now }, note: String }],
    completedAt: Date,
  },
  { timestamps: true },
);

transactionSchema.index({ guestOrder: 1 }, { sparse: true });
transactionSchema.index({ channel: 1, createdAt: -1 }, { sparse: true });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ user: 1, 'bill.serviceId': 1, status: 1, createdAt: -1 });
transactionSchema.index({ status: 1, kind: 1, createdAt: 1 });
transactionSchema.index({ 'giftTo.user': 1, status: 1 }, { partialFilterExpression: { 'giftTo.user': { $type: 'objectId' } } });
transactionSchema.index({ 'giftTo.phone': 1, status: 1 }, { partialFilterExpression: { 'giftTo.phone': { $type: 'string' } } });
transactionSchema.index({ 'giftTo.email': 1, status: 1 }, { partialFilterExpression: { 'giftTo.email': { $type: 'string' } } });
transactionSchema.index({ 'providerData.requestId': 1 }, { unique: true, partialFilterExpression: { 'providerData.requestId': { $type: 'string' } } });
transactionSchema.index({ needsReview: 1, createdAt: -1 }, { partialFilterExpression: { needsReview: true } });
// One transaction per quote: a double-tapped "Pay" can't spend a quote twice.
transactionSchema.index({ quote: 1 }, { unique: true, partialFilterExpression: { quote: { $exists: true } } });

export const TransactionModel = model<ITransaction>('Transaction', transactionSchema);
export type TransactionDoc = HydratedDocument<ITransaction>;
