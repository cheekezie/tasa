import { z } from 'zod';
import { ServiceIdSchema } from '../../lib/schemas';
import { CHARGE_SCOPES } from './models/charge-rule.model';

const kobo = z.number().int().min(0);

export const ChargeRuleInputSchema = z
  .object({
    scope: z.enum(CHARGE_SCOPES),
    serviceId: ServiceIdSchema.nullable().default(null),
    provider: z.string().trim().toUpperCase().min(1).nullable().default(null),
    code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lowercase letters, digits and _').default('service_charge'),
    label: z.string().trim().min(2).max(60),
    rateBps: z.number().int().min(0).max(10_000).default(0),
    fixed: kobo.default(0),
    min: kobo.default(0),
    max: kobo.nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((r) => r.max == null || r.max >= r.min, { path: ['max'], message: 'max must be at least min' })
  .refine((r) => !r.provider || r.serviceId, { path: ['provider'], message: 'A provider rule needs a serviceId' });
export type ChargeRuleInput = z.infer<typeof ChargeRuleInputSchema>;

export const ChargeRuleUpdateSchema = z
  .object({
    label: z.string().trim().min(2).max(60),
    rateBps: z.number().int().min(0).max(10_000),
    fixed: kobo,
    min: kobo,
    max: kobo.nullable(),
    active: z.boolean(),
  })
  .partial();
export type ChargeRuleUpdate = z.infer<typeof ChargeRuleUpdateSchema>;

export const ChargePreviewSchema = z.object({
  scope: z.enum(CHARGE_SCOPES),
  serviceId: ServiceIdSchema.optional(),
  provider: z.string().optional(),
  amount: z.coerce.number().int().positive(),
});
