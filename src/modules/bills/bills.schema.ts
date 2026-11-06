import { z } from 'zod';
import { BillAccountSchema, ObjectIdSchema, PinSchema, RecipientSchema, ServiceIdSchema } from '../../lib/schemas';
import { CouponCodeSchema } from '../coupons/coupons.schema';

export const BillQuoteSchema = z.object({
  kind: z.literal('bill'),
  serviceId: ServiceIdSchema,
  provider: z.string().trim().min(2).max(40),
  account: BillAccountSchema,
  /** Kobo; whole naira. Ignored for plan-based bills (TV, data, internet, exams). */
  amount: z.number().int().positive().multipleOf(100, 'Amount must be whole naira').optional(),
  /** Under `airtime`: top-up or a data bundle. */
  product: z.enum(['airtime', 'data']).default('airtime'),
  /** VTpass variation code. Required for plan-based bills; to renew TV, pick the same package. */
  planCode: z.string().trim().min(1).max(60).optional(),
  meterType: z.enum(['prepaid', 'postpaid']).default('prepaid'),
  /** Any code: a user's coupon, a gift, or a Tela promo. */
  couponCode: CouponCodeSchema.optional(),
  /**
   * Without a code: apply the user's own gift/coupon balance (soonest-expiring first) or an
   * auto-apply Tela promo, whichever takes more off. false = full price.
   */
  autoApply: z.boolean().default(true),
  /** "Pay their bill": a gift. The recipient is told (with the token) once it's delivered. */
  giftTo: RecipientSchema.optional(),
  giftMessage: z.string().trim().max(140).optional(),
  beneficiaryId: ObjectIdSchema.optional(),
});
export type BillQuoteInput = z.infer<typeof BillQuoteSchema>;

export const PurchaseSchema = z.object({
  quoteId: ObjectIdSchema,
  /** Optional only if the user turned it off; the API decides. */
  pin: PinSchema.optional(),
  /** Saves this account as a beneficiary once the bill succeeds. */
  saveBeneficiary: z.object({ label: z.string().trim().min(2).max(40) }).optional(),
});

/** Checking who an account belongs to before anything is priced (e.g. while starting a split). */
export const VerifyAccountSchema = BillQuoteSchema.pick({ serviceId: true, provider: true, account: true, meterType: true, planCode: true });

export const PlansParamsSchema = z.object({ serviceId: ServiceIdSchema, provider: z.string().trim().min(2).max(40) });
