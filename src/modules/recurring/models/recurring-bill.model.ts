import { RECURRING_FREQUENCIES, type RecurringFrequency } from '../schedule';
import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SERVICE_IDS, type ServiceId } from '../../../lib/schemas';

/** A bill Tela pays from the wallet on a schedule. Created with the user's PIN. */
export interface IRecurringBill {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  label: string;
  serviceId: ServiceId;
  provider: string;
  account: string;
  product?: 'airtime' | 'data';
  meterType?: 'prepaid' | 'postpaid';
  planCode?: string;
  /** Kobo. For plan-based bills, the price when it was set up (the plan's live price is charged). */
  amount: number;
  frequency: RecurringFrequency;
  /** Day of month (monthly) or weekday 0–6 (weekly) the schedule was anchored to. */
  anchorDay: number;
  nextRunAt: Date;
  beneficiary?: Types.ObjectId;
  active: boolean;
  /** Tries in the current cycle that couldn't pay (low balance). Reset each cycle. */
  missedAttempts: number;
  lastRun?: { at: Date; status: 'success' | 'pending' | 'failed' | 'skipped'; reason?: string; transaction?: Types.ObjectId };
  createdAt: Date;
}

const recurringSchema = new Schema<IRecurringBill>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, required: true, trim: true },
    serviceId: { type: String, enum: SERVICE_IDS, required: true },
    provider: { type: String, required: true },
    account: { type: String, required: true },
    product: { type: String, enum: ['airtime', 'data'] },
    meterType: { type: String, enum: ['prepaid', 'postpaid'] },
    planCode: String,
    amount: { type: Number, required: true, min: 1, validate: Number.isInteger },
    frequency: { type: String, enum: RECURRING_FREQUENCIES, required: true },
    anchorDay: { type: Number, required: true },
    nextRunAt: { type: Date, required: true },
    beneficiary: { type: Schema.Types.ObjectId, ref: 'Beneficiary' },
    active: { type: Boolean, default: true },
    missedAttempts: { type: Number, default: 0 },
    lastRun: {
      at: Date,
      status: { type: String, enum: ['success', 'pending', 'failed', 'skipped'] },
      reason: String,
      transaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

recurringSchema.index({ active: 1, nextRunAt: 1 });
recurringSchema.index({ user: 1, serviceId: 1, account: 1 }, { unique: true, partialFilterExpression: { active: true } });

export const RecurringBillModel = model<IRecurringBill>('RecurringBill', recurringSchema);
export type RecurringBillDoc = HydratedDocument<IRecurringBill>;
