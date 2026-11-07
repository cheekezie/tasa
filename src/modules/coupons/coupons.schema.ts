import { z } from 'zod';
import { ObjectIdSchema, PaginationQuerySchema, PinSchema, RecipientSchema, ServiceIdSchema } from '../../lib/schemas';
import { PROMO_AUDIENCES } from './models/coupon.model';

const DAY = 86_400_000;

export const CouponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{3,23}$/, 'Codes are 4–24 letters, numbers or dashes');

export const CouponQuoteSchema = z.object({
  kind: z.literal('coupon'),
  title: z.string().trim().min(3).max(60),
  /** Per redemption, kobo. */
  amount: z.number().int().min(10_000, 'Each giveaway must be worth at least ₦100').max(10_000_000),
  quantity: z.number().int().min(1).max(10_000),
  services: z.union([z.literal('all'), z.array(ServiceIdSchema).min(1)]).default('all'),
  code: CouponCodeSchema.optional(),
  expiresAt: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now() + 3_600_000, 'Expiry must be at least an hour away')
    .refine((d) => d.getTime() < Date.now() + 366 * DAY, 'Expiry must be within a year')
    .optional(),
});
export type CouponQuoteInput = z.infer<typeof CouponQuoteSchema>;

export const GiftQuoteSchema = z.object({
  kind: z.literal('gift'),
  /** `{ type: 'username' | 'phone' | 'email', value }`. Check it with POST /api/users/lookup. */
  recipient: RecipientSchema,
  recipientName: z.string().trim().min(1).max(60).optional(),
  /** null = any bill. */
  serviceId: ServiceIdSchema.nullable().default(null),
  amount: z.number().int().min(10_000, 'The minimum gift is ₦100').max(10_000_000),
  message: z.string().trim().max(140).optional(),
});
export type GiftQuoteInput = z.infer<typeof GiftQuoteSchema>;

export const ConfirmQuoteSchema = z.object({ quoteId: ObjectIdSchema, pin: PinSchema });

// ── Tasa promotions (admin) ─────────────────────────────────────────────

const PromoScope = {
  services: z.union([z.literal('all'), z.array(ServiceIdSchema).min(1)]),
  /** Provider codes as the API returns them (MTN, IKEDC, DSTV…). */
  providers: z.array(z.string().trim().toUpperCase().min(2)).max(30),
};

export const CreatePromoSchema = z
  .object({
    code: CouponCodeSchema,
    title: z.string().trim().min(3).max(60),
    description: z.string().trim().max(280).optional(),
    valueType: z.enum(['percent', 'fixed']),
    /** Percent 1–100, or kobo for fixed. */
    value: z.number().int().positive(),
    maxDiscount: z.number().int().positive().nullable().default(null),
    minSpend: z.number().int().min(0).default(0),
    appliesTo: z.enum(['amount', 'fee']).default('amount'),
    budget: z.number().int().positive(),
    usesPerUser: z.number().int().min(1).max(100).default(1),
    audience: z.enum(PROMO_AUDIENCES).default('all'),
    autoApply: z.boolean().default(false),
    listed: z.boolean().default(true),
    services: PromoScope.services.default('all'),
    providers: PromoScope.providers.default([]),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date(),
  })
  .refine((p) => p.valueType !== 'percent' || p.value <= 100, { path: ['value'], message: 'A percentage must be 1–100' })
  // Uncapped percentages are how promos blow their budget on one big electricity bill.
  .refine((p) => p.valueType !== 'percent' || p.maxDiscount != null, { path: ['maxDiscount'], message: 'Percentage promos need a maxDiscount (cap per use)' })
  .refine((p) => p.expiresAt > (p.startsAt ?? new Date()), { path: ['expiresAt'], message: 'expiresAt must be after startsAt' })
  .refine((p) => p.valueType !== 'fixed' || p.value >= 100, { path: ['value'], message: 'Fixed values are kobo — at least 100 (₦1)' });
export type CreatePromoInput = z.infer<typeof CreatePromoSchema>;

export const UpdatePromoSchema = z
  .object({
    title: z.string().trim().min(3).max(60),
    description: z.string().trim().max(280),
    valueType: z.enum(['percent', 'fixed']),
    value: z.number().int().positive(),
    maxDiscount: z.number().int().positive().nullable(),
    minSpend: z.number().int().min(0),
    appliesTo: z.enum(['amount', 'fee']),
    budget: z.number().int().positive(),
    usesPerUser: z.number().int().min(1).max(100),
    audience: z.enum(PROMO_AUDIENCES),
    autoApply: z.boolean(),
    listed: z.boolean(),
    services: PromoScope.services,
    providers: PromoScope.providers,
    startsAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    /** Pause and resume. To end a promo for good use POST /:id/end. */
    status: z.enum(['active', 'paused']),
  })
  .partial();
export type UpdatePromoInput = z.infer<typeof UpdatePromoSchema>;

// ── Tasa giveaways and gifts (admin) ────────────────────────────────────

export const TasaCouponSchema = z
  .object({
    kind: z.enum(['coupon', 'gift']),
    /** Optional; generated when omitted. */
    code: CouponCodeSchema.optional(),
    title: z.string().trim().min(3).max(60),
    description: z.string().trim().max(280).optional(),
    /** Per person, kobo — spent as a balance across bills. */
    amount: z.number().int().min(10_000).max(10_000_000),
    /** How many people can claim it. Gifts are always 1. */
    quantity: z.number().int().min(1).max(100_000).default(1),
    services: z.union([z.literal('all'), z.array(ServiceIdSchema).min(1)]).default('all'),
    recipient: RecipientSchema.optional(),
    recipientName: z.string().trim().min(1).max(60).optional(),
    message: z.string().trim().max(140).optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), 'expiresAt must be in the future'),
  })
  .refine((c) => c.kind !== 'gift' || c.recipient, { path: ['recipient'], message: 'A gift needs a recipient' });
export type TasaCouponInput = z.infer<typeof TasaCouponSchema>;

export const AdminCouponListSchema = PaginationQuerySchema.extend({
  kind: z.enum(['coupon', 'gift']).optional(),
  fundedBy: z.enum(['user', 'tasa']).optional(),
  status: z.enum(['active', 'paused', 'expired', 'cancelled']).optional(),
  owner: ObjectIdSchema.optional(),
  code: z.string().trim().optional(),
});
