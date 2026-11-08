import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * A permanent SaySwitch account number. One SaySwitch customer per account, so a payment's
 * `customer_code` (from SaySwitch's verify) tells us exactly which account it went to.
 *
 *   wallet       anyone who transfers in tops up the user's wallet
 *   beneficiary  tops up the wallet and, while auto-pay is on, buys that bill (e.g. a
 *                saved meter's electricity). Issued only after the user opts in and accepts
 *                the auto-pay terms; the consent is kept here.
 *
 * Accounts are never deleted: people may have saved the number. Turning auto-pay off, or
 * removing the beneficiary, only stops the automatic purchase — money still lands in the wallet.
 */
export interface IDedicatedAccount {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  purpose: 'wallet' | 'beneficiary';
  beneficiary?: Types.ObjectId | null;
  accountNumber: string;
  bankName: string;
  accountName: string;
  customerCode: string;
  consent?: { termsVersion: string; acceptedAt: Date; ip?: string; userAgent?: string };
  createdAt: Date;
}

const dedicatedAccountSchema = new Schema<IDedicatedAccount>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['wallet', 'beneficiary'], required: true },
    beneficiary: { type: Schema.Types.ObjectId, ref: 'Beneficiary', default: null },
    accountNumber: { type: String, required: true, unique: true },
    bankName: { type: String, required: true },
    accountName: { type: String, required: true },
    customerCode: { type: String, required: true, unique: true },
    consent: { termsVersion: String, acceptedAt: Date, ip: String, userAgent: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One wallet account per user, one account per beneficiary.
dedicatedAccountSchema.index({ user: 1, purpose: 1 }, { unique: true, partialFilterExpression: { purpose: 'wallet' } });
dedicatedAccountSchema.index({ beneficiary: 1 }, { unique: true, partialFilterExpression: { beneficiary: { $type: 'objectId' } } });

export const DedicatedAccountModel = model<IDedicatedAccount>('DedicatedAccount', dedicatedAccountSchema);
export type DedicatedAccountDoc = HydratedDocument<IDedicatedAccount>;
