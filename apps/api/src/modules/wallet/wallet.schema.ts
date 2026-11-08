import { z } from 'zod';
import { ObjectIdSchema } from '../../lib/schemas';

/** ₦100 – ₦5,000,000, the same bounds the app enforces. */
export const FUNDING_MIN = 10_000;
export const FUNDING_MAX = 500_000_000;

export const FundingQuoteSchema = z.object({
  kind: z.literal('funding'),
  amount: z.number().int().min(FUNDING_MIN, 'The minimum top-up is ₦100').max(FUNDING_MAX, 'The maximum top-up is ₦5,000,000'),
});

export const StartFundingSchema = z.object({ quoteId: ObjectIdSchema });
