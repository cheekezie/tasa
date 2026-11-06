import { z } from 'zod';
import { BillAccountSchema, ServiceIdSchema } from '../../lib/schemas';

export const CreateBeneficiarySchema = z.object({
  label: z.string().trim().min(2).max(40),
  serviceId: ServiceIdSchema,
  provider: z.string().trim().min(2).max(40),
  account: BillAccountSchema,
  product: z.enum(['airtime', 'data']).optional(),
  meterType: z.enum(['prepaid', 'postpaid']).optional(),
  planCode: z.string().trim().max(60).optional(),
});
export type CreateBeneficiaryInput = z.infer<typeof CreateBeneficiarySchema>;

export const UpdateBeneficiarySchema = z
  .object({
    label: z.string().trim().min(2).max(40),
    autoPay: z.boolean(),
    planCode: z.string().trim().max(60).nullable(),
    meterType: z.enum(['prepaid', 'postpaid']),
  })
  .partial();
export type UpdateBeneficiaryInput = z.infer<typeof UpdateBeneficiarySchema>;

/** The app shows the terms from GET /beneficiaries/auto-pay-terms and sends back the version accepted. */
export const OptInSchema = z.object({
  acceptTerms: z.literal(true, { error: 'You need to accept the auto-pay terms' }),
  termsVersion: z.string().min(1),
});
export type OptInInput = z.infer<typeof OptInSchema>;
