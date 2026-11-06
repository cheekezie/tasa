import { z } from 'zod';
import { RECURRING_FREQUENCIES } from './schedule';
import { BillAccountSchema, ObjectIdSchema, ServiceIdSchema } from '../../lib/schemas';

export const CreateRecurringSchema = z.object({
  label: z.string().trim().min(2).max(40),
  serviceId: ServiceIdSchema,
  provider: z.string().trim().min(2).max(40),
  account: BillAccountSchema,
  /** Kobo, whole naira. Ignored for plan-based bills. */
  amount: z.number().int().positive().multipleOf(100, 'Amount must be whole naira').optional(),
  product: z.enum(['airtime', 'data']).default('airtime'),
  meterType: z.enum(['prepaid', 'postpaid']).default('prepaid'),
  planCode: z.string().trim().max(60).optional(),
  frequency: z.enum(RECURRING_FREQUENCIES),
  /** First payment date (YYYY-MM-DD, Lagos time). Today or later; today is paid at the next 15-minute run. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  beneficiaryId: ObjectIdSchema.optional(),
});
export type CreateRecurringInput = z.infer<typeof CreateRecurringSchema>;

/** The account, provider and service identify the schedule, so they can't change. */
export const UpdateRecurringSchema = z.object({
  label: z.string().trim().min(2).max(40).optional(),
  /** Kobo, whole naira. Ignored for plan-based bills. */
  amount: z.number().int().positive().multipleOf(100).optional(),
  planCode: z.string().trim().min(1).max(60).optional(),
  frequency: z.enum(RECURRING_FREQUENCIES).optional(),
  /** Next payment date (YYYY-MM-DD, Lagos time). Today or later; later runs keep this day. */
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
});
export type UpdateRecurringInput = z.infer<typeof UpdateRecurringSchema>;
