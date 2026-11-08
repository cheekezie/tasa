import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SERVICE_IDS, type ServiceId } from '../../../lib/schemas';

/**
 * A saved bill destination ("Mama's Shop IKEDC"). After the user opts in and accepts the
 * auto-pay terms it gets its own permanent account number (a DedicatedAccount): anyone who
 * transfers into it tops up the owner's wallet and, while `autoPay` is on, buys that bill
 * straight away — so family can pay a meter from any bank app. `virtualAccount` is a copy
 * for display.
 */
export interface IBeneficiary {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  label: string;
  serviceId: ServiceId;
  provider: string;
  account: string;
  /** Who the provider says owns the account (meter, smart card, Smile, JAMB), checked when saved. */
  customerName?: string;
  product?: 'airtime' | 'data';
  meterType?: 'prepaid' | 'postpaid';
  /** For plan-based bills (TV, data) paid automatically. */
  planCode?: string;
  autoPay: boolean;
  virtualAccount?: { accountNumber: string; bankName: string; accountName: string; customerCode: string };
  archivedAt?: Date | null;
  createdAt: Date;
}

const beneficiarySchema = new Schema<IBeneficiary>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, required: true, trim: true },
    serviceId: { type: String, enum: SERVICE_IDS, required: true },
    provider: { type: String, required: true },
    account: { type: String, required: true },
    customerName: String,
    product: { type: String, enum: ['airtime', 'data'] },
    meterType: { type: String, enum: ['prepaid', 'postpaid'] },
    planCode: String,
    autoPay: { type: Boolean, default: false },
    virtualAccount: { accountNumber: String, bankName: String, accountName: String, customerCode: String },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

beneficiarySchema.index({ user: 1, serviceId: 1, account: 1 }, { unique: true, partialFilterExpression: { archivedAt: null } });


export const BeneficiaryModel = model<IBeneficiary>('Beneficiary', beneficiarySchema);
export type BeneficiaryDoc = HydratedDocument<IBeneficiary>;
