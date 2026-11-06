import { z } from 'zod';
import { ObjectIdSchema, PinSchema, RecipientSchema } from '../../lib/schemas';

export const TRANSFER_MIN = 10_000;

export const TransferQuoteSchema = z.object({
  kind: z.literal('transfer'),
  /** `{ type: 'username' | 'phone' | 'email', value }` — check it first with POST /api/users/lookup. */
  recipient: RecipientSchema,
  amount: z.number().int().min(TRANSFER_MIN, 'The minimum transfer is ₦100').max(100_000_000, 'The maximum transfer is ₦1,000,000'),
  note: z.string().trim().max(80).optional(),
});
export type TransferQuoteInput = z.infer<typeof TransferQuoteSchema>;

export const SendTransferSchema = z.object({ quoteId: ObjectIdSchema, pin: PinSchema });
