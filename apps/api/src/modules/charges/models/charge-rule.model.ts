import { Schema, model, type Types } from 'mongoose';
import { SERVICE_IDS, type ServiceId } from '../../../lib/schemas';

export const CHARGE_SCOPES = [
  'funding',
  'bill',
  'transfer',
  'coupon',
  'gift',
  'ticket',
  'ticket_sale',
  'ticket_payout',
  /** Paid by a member on each dues payment. */
  'group_dues',
  /** Taken from what a group receives, per dues payment. */
  'group_fee',
  'group_payout',
  /** Paid by each person on their share of a split bill. */
  'split',
] as const;
export type ChargeScope = (typeof CHARGE_SCOPES)[number];

/**
 * One configurable charge. For each `code` (e.g. `service_charge`) the most specific
 * active-or-not rule wins: scope+service+provider › scope+service › scope. An inactive
 * specific rule therefore switches a charge off for that service (e.g. free airtime).
 *
 * fee = clamp(round(amount × rateBps / 10 000) + fixed, min, max). All kobo.
 */
export interface IChargeRule {
  _id: Types.ObjectId;
  scope: ChargeScope;
  serviceId: ServiceId | null;
  provider: string | null;
  code: string;
  label: string;
  rateBps: number;
  fixed: number;
  min: number;
  max: number | null;
  active: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const chargeRuleSchema = new Schema<IChargeRule>(
  {
    scope: { type: String, enum: CHARGE_SCOPES, required: true },
    serviceId: { type: String, enum: [...SERVICE_IDS, null], default: null },
    provider: { type: String, default: null, uppercase: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    rateBps: { type: Number, default: 0, min: 0, max: 10_000, validate: Number.isInteger },
    fixed: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    min: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    max: { type: Number, default: null, min: 0 },
    active: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true },
);

chargeRuleSchema.index({ scope: 1, serviceId: 1, provider: 1, code: 1 }, { unique: true });

export const ChargeRuleModel = model<IChargeRule>('ChargeRule', chargeRuleSchema);
