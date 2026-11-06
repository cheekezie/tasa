import { Schema, model, type Types } from 'mongoose';

export const TICKET_STATUSES = ['valid', 'used', 'refunded'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** One entry to an event. `code` is what the QR holds, and it only works once. */
export interface ITicket {
  _id: Types.ObjectId;
  event: Types.ObjectId;
  tier: Types.ObjectId;
  tierName: string;
  /** As sold, so the ticket keeps saying what it was bought with. */
  covers?: string;
  eventTitle: string;
  buyer: Types.ObjectId;
  /** Who it's for: what the buyer typed, or their own name. */
  holderName: string;
  seller: Types.ObjectId;
  code: string;
  status: TicketStatus;
  /** Kobo. What the buyer gets back on a refund. */
  price: number;
  /** Kobo. What the organiser paid us for this sale; they keep `price − sellingFee`. */
  sellingFee: number;
  /** Until this moment the buyer can cancel and the seller can't withdraw it. null = no refunds. */
  refundableUntil: Date | null;
  purchase: Types.ObjectId;
  scannedAt?: Date;
  scannedBy?: Types.ObjectId;
  refundedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ticketSchema = new Schema<ITicket>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    tier: { type: Schema.Types.ObjectId, required: true },
    tierName: { type: String, required: true },
    covers: String,
    eventTitle: { type: String, required: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    holderName: { type: String, required: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code: { type: String, required: true, unique: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'valid' },
    price: { type: Number, required: true },
    sellingFee: { type: Number, required: true },
    refundableUntil: { type: Date, default: null },
    purchase: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    scannedAt: Date,
    scannedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    refundedAt: Date,
  },
  { timestamps: true },
);

// What's on hold for a seller: their valid tickets still inside a refund window.
ticketSchema.index({ seller: 1, status: 1, refundableUntil: 1 });

export const TicketModel = model<ITicket>('Ticket', ticketSchema);

/**
 * Someone who opted in to selling. The balance itself is the ledger's `tickets:<userId>`;
 * `withdrawals` is bumped first in every withdrawal so two at once can't both spend it.
 */
export const SELLER_VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SellerVerificationStatus = (typeof SELLER_VERIFICATION_STATUSES)[number];
export const SELLER_ID_TYPES = ['nin_slip', 'drivers_licence', 'passport', 'voters_card'] as const;
export type SellerIdType = (typeof SELLER_ID_TYPES)[number];

export interface SellerVerification {
  status: SellerVerificationStatus;
  idType: SellerIdType;
  photoKey: string;
  photoType: string;
  idKey: string;
  idMimeType: string;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  /** Why it was rejected, shown to them. */
  reason?: string;
}

export interface ISeller {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** The brand or group buyers see on every event and ticket, instead of the person. */
  organisation?: string;
  /** Their organisation's logo, in R2. */
  logoKey?: string;
  /** What buyers read on the organiser's page: who they are and how to reach them. */
  about?: string;
  contact?: { phone?: string; email?: string; website?: string; instagram?: string };
  /** Which selling terms they agreed to, and when. Creating an event needs the current ones. */
  termsVersion?: string;
  termsAcceptedAt?: Date;
  /**
   * Who they are, checked by compliance before they can run events: a photo of them and of an
   * ID. The files are encrypted in R2 (the bucket is public); only `SellerReviewService` reads them.
   */
  verification?: SellerVerification;
  /**
   * Earlier submissions, oldest first, kept (files too) when they send new ones, so compliance can
   * compare a resubmission with what was rejected. A `pending` entry was replaced before review.
   */
  verificationHistory: (SellerVerification & { _id: Types.ObjectId })[];
  /** Tela stopped them organising: their events are paused as Tela, and withdrawals wait. */
  suspension?: { active: boolean; reason?: string; at?: Date; by?: Types.ObjectId; liftedAt?: Date };
  /** Every suspension and lift, oldest first: who, why, when. */
  suspensionHistory: { action: 'suspended' | 'lifted'; reason?: string; by: Types.ObjectId; at: Date }[];
  withdrawals: number;
  /** Where they want their sales paid. `accountName` came from the bank, not from them. */
  bankAccount?: { bankCode: string; bankName: string; accountNumber: string; accountName: string };
  createdAt: Date;
}

/** One submission; history entries get an `_id` so a past one can be opened. */
const verificationFields = {
  status: { type: String, enum: SELLER_VERIFICATION_STATUSES },
  idType: { type: String, enum: SELLER_ID_TYPES },
  photoKey: String,
  photoType: String,
  idKey: String,
  idMimeType: String,
  submittedAt: Date,
  reviewedAt: Date,
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  reason: String,
};

const sellerSchema = new Schema<ISeller>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    organisation: { type: String, trim: true },
    logoKey: String,
    about: { type: String, trim: true },
    contact: { phone: String, email: String, website: String, instagram: String },
    termsVersion: String,
    termsAcceptedAt: Date,
    verification: verificationFields,
    verificationHistory: [verificationFields],
    suspension: {
      active: { type: Boolean, default: false },
      reason: String,
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: 'Admin' },
      liftedAt: Date,
    },
    suspensionHistory: [
      {
        _id: false,
        action: { type: String, enum: ['suspended', 'lifted'], required: true },
        reason: String,
        by: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
        at: { type: Date, required: true },
      },
    ],
    withdrawals: { type: Number, default: 0 },
    bankAccount: { bankCode: String, bankName: String, accountNumber: String, accountName: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

sellerSchema.index({ 'verification.status': 1, 'verification.submittedAt': 1 });

export const SellerModel = model<ISeller>('Seller', sellerSchema);
