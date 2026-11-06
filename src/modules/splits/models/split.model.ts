import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SERVICE_IDS, type ServiceId } from '../../../lib/schemas';
import type { ChargeLine } from '../../transactions/models/transaction.model';

export const SPLIT_STATUSES = ['open', 'paying', 'paid', 'failed', 'expired', 'cancelled'] as const;
export type SplitStatus = (typeof SPLIT_STATUSES)[number];

/**
 * One bill, shared. The starter picks it and who pays what; each share goes into the split's pot
 * (`split:<id>`). When every share is in, Tela pays the bill from the pot. If the deadline passes
 * first, or the bill fails, everyone gets their share back. Nobody fronts the money.
 */
export interface ISplit {
  _id: Types.ObjectId;
  starter: Types.ObjectId;
  title: string;
  /** What to pay, as the starter priced it. */
  bill: {
    serviceId: ServiceId;
    provider: string;
    account: string;
    product?: 'airtime' | 'data';
    meterType?: 'prepaid' | 'postpaid';
    planCode?: string;
    planName?: string;
    customerName?: string;
  };
  /** The bill's face value, kobo. If it's different when the pot is full, nothing is paid. */
  amount: number;
  /** The bill's charge, fixed when the split was made: the shares cover it. */
  fee: number;
  charges: ChargeLine[];
  shares: { _id: Types.ObjectId; user: Types.ObjectId; amount: number; paidAt?: Date; transaction?: Types.ObjectId; refundedAt?: Date }[];
  deadline: Date;
  status: SplitStatus;
  /** The bill quote the pot pays; the bill purchase is idempotent on it. */
  billQuote?: Types.ObjectId;
  billTransaction?: Types.ObjectId;
  payAttempts: number;
  closedReason?: string;
  closedAt?: Date;
  /** The first split of a bill split again and again (its own id when it's the first): its rounds share it. */
  series?: Types.ObjectId;
  createdAt: Date;
}

const splitSchema = new Schema<ISplit>(
  {
    starter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    bill: {
      serviceId: { type: String, enum: SERVICE_IDS, required: true },
      provider: { type: String, required: true },
      account: { type: String, required: true },
      product: { type: String, enum: ['airtime', 'data'] },
      meterType: { type: String, enum: ['prepaid', 'postpaid'] },
      planCode: String,
      planName: String,
      customerName: String,
    },
    amount: { type: Number, required: true },
    fee: { type: Number, required: true },
    charges: [{ _id: false, code: String, label: String, amount: Number }],
    shares: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        amount: { type: Number, required: true },
        paidAt: Date,
        transaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
        refundedAt: Date,
      },
    ],
    deadline: { type: Date, required: true },
    status: { type: String, enum: SPLIT_STATUSES, default: 'open' },
    billQuote: { type: Schema.Types.ObjectId, ref: 'Quote' },
    billTransaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    payAttempts: { type: Number, default: 0 },
    closedReason: String,
    closedAt: Date,
    series: { type: Schema.Types.ObjectId, ref: 'Split' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
splitSchema.index({ 'shares.user': 1, createdAt: -1 });
splitSchema.index({ starter: 1, createdAt: -1 });
splitSchema.index({ status: 1, deadline: 1 });
splitSchema.index({ series: 1, createdAt: -1 });

export const SplitModel = model<ISplit>('Split', splitSchema);
export type SplitDoc = HydratedDocument<ISplit>;
