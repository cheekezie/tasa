import { z } from 'zod';
import { KoboSchema, ObjectIdSchema, PinSchema } from '../../lib/schemas';
import { BillQuoteSchema } from '../bills/bills.schema';

export const MAX_SHARES = 20;
/** Long enough to collect from a household; short enough that a meter doesn't run dry waiting. */
export const MAX_SPLIT_HOURS = 7 * 24;

const ShareSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^@/, '')),
  /** Kobo. Without it, the total is shared equally between everyone without an amount. */
  amount: KoboSchema.optional(),
});

export const CreateSplitSchema = z.object({
  title: z.string().trim().min(2).max(60),
  /** The bill, as for a bill quote. No codes: a split pays full price. */
  bill: BillQuoteSchema.pick({ serviceId: true, provider: true, account: true, amount: true, product: true, planCode: true, meterType: true }),
  /** Include yourself to pay a share too. */
  shares: z.array(ShareSchema).min(2, 'Split it between at least 2 people').max(MAX_SHARES),
  hours: z.number().int().min(1).max(MAX_SPLIT_HOURS).default(48),
});
export type CreateSplitInput = z.infer<typeof CreateSplitSchema>;

/** The starter can rename an open split or move its deadline (from now, within the usual limit). */
export const UpdateSplitSchema = z
  .object({ title: z.string().trim().min(2).max(60), hours: z.number().int().min(1).max(MAX_SPLIT_HOURS) })
  .partial()
  .refine((v) => v.title !== undefined || v.hours !== undefined, 'Change the name or the deadline');

/** Starting the same split again; without `hours`, it lasts as long as the last one did. */
export const SplitAgainSchema = z.object({ hours: z.number().int().min(1).max(MAX_SPLIT_HOURS).optional() });

export const SplitShareQuoteSchema = z.object({
  kind: z.literal('split_share'),
  splitId: ObjectIdSchema,
});
export type SplitShareQuoteInput = z.infer<typeof SplitShareQuoteSchema>;

export const PayShareSchema = z.object({ quoteId: ObjectIdSchema, pin: PinSchema });
