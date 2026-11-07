import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import type { ServiceId } from '../../../lib/schemas';

export const GUEST_ORDER_STATUSES = ['awaiting_payment', 'paying', 'delivered', 'failed'] as const;
export type GuestOrderStatus = (typeof GUEST_ORDER_STATUSES)[number];

/**
 * A one-off bill bought on the website without the app: JAMB, WAEC, electricity, airtime.
 *
 * It rides on two things Tasa already does. The bank transfer is an ordinary one-time funding
 * of the wallet that belongs to the buyer's phone number (an account is made for it if there
 * isn't one: whoever signs up with that number later owns it). Once that funding is credited,
 * the bill is bought from the same wallet as an automatic payment. So a failed bill, or a
 * transfer of the wrong amount, leaves the money in that wallet: never lost, never paid out.
 */
export interface IGuestOrder {
  _id: Types.ObjectId;
  reference: string;
  /** The wallet it's paid into and bought from: the phone number's Tasa account. */
  user: Types.ObjectId;
  /** E.164; where the PIN or token is texted. */
  phone: string;
  email?: string;
  /** What to buy, as priced: re-priced at payment, and only bought if the price held. */
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
  /** Kobo: the bill, its charge, and the total the transfer must cover. */
  amount: number;
  fee: number;
  total: number;
  status: GuestOrderStatus;
  /** The wallet funding the transfer pays (its reference is what SaySwitch knows). */
  funding: Types.ObjectId;
  billTransaction?: Types.ObjectId;
  /** Tries at buying the bill; it gives up after a few. */
  payAttempts: number;
  /** Why it didn't go through, in words for the buyer. */
  failureReason?: string;
  /** Secret in the status page's link: the reference alone mustn't reveal a PIN. */
  accessKey: string;
  createdAt: Date;
}

const guestOrderSchema = new Schema<IGuestOrder>(
  {
    reference: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, required: true },
    email: String,
    bill: {
      serviceId: { type: String, required: true },
      provider: { type: String, required: true },
      account: { type: String, required: true },
      product: String,
      meterType: String,
      planCode: String,
      planName: String,
      customerName: String,
    },
    amount: { type: Number, required: true },
    fee: { type: Number, required: true },
    total: { type: Number, required: true },
    status: { type: String, enum: GUEST_ORDER_STATUSES, default: 'awaiting_payment' },
    funding: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, unique: true },
    billTransaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    payAttempts: { type: Number, default: 0 },
    failureReason: String,
    accessKey: { type: String, required: true, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
guestOrderSchema.index({ phone: 1, createdAt: -1 });
guestOrderSchema.index({ status: 1, createdAt: 1 });
guestOrderSchema.index({ billTransaction: 1 }, { sparse: true });

export const GuestOrderModel = model<IGuestOrder>('GuestOrder', guestOrderSchema);
export type GuestOrderDoc = HydratedDocument<IGuestOrder>;
