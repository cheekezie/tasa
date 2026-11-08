import { z } from 'zod';
import { ObjectIdSchema, PaginationQuerySchema, ServiceIdSchema } from '../../lib/schemas';
import { TRANSACTION_STATUSES } from './models/transaction.model';

export const TransactionListQuerySchema = PaginationQuerySchema.extend({
  /** Comma-separated kinds, e.g. `bill,funding`. */
  kind: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  direction: z.enum(['credit', 'debit']).optional(),
  serviceId: ServiceIdSchema.optional(),
  beneficiaryId: ObjectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;

export const SPENDING_PERIODS = ['this_month', 'last_month', '3_months', '6_months', 'this_year', 'all'] as const;
export type SpendingPeriod = (typeof SPENDING_PERIODS)[number];
export const SpendingQuerySchema = z.object({ period: z.enum(SPENDING_PERIODS).default('this_month') });

export const InsightsQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) });
