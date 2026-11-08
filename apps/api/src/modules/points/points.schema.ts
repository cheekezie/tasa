import { z } from 'zod';
import { PaginationQuerySchema } from '../../lib/schemas';

export const RedeemPointsSchema = z.object({
  points: z.number().int().positive(),
  /** Generated once per conversion by the client, so a retry can't convert twice. */
  idempotencyKey: z.string().trim().min(8).max(64),
});

export const PointsHistoryQuerySchema = PaginationQuerySchema;

export const UpdatePointsSettingsSchema = z
  .object({
    active: z.boolean(),
    billPointsPer100Naira: z.number().min(0).max(100),
    transferPoints: z.number().int().min(0).max(1000),
    pointValue: z.number().int().min(1).max(10_000),
    minRedeemPoints: z.number().int().min(1).max(1_000_000),
  })
  .partial();
export type UpdatePointsSettings = z.infer<typeof UpdatePointsSettingsSchema>;
