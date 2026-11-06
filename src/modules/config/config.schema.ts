import { z } from 'zod';
import { FEATURE_KEYS } from './config.service';

const Message = z.string().trim().max(200);

/** Any subset of features. A blank message falls back to the default one. */
export const UpdateFeaturesSchema = z
  .partialRecord(z.enum(FEATURE_KEYS), z.object({ enabled: z.boolean(), message: Message.optional() }))
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateFeaturesInput = z.infer<typeof UpdateFeaturesSchema>;

export const MaintenanceSchema = z.object({
  active: z.boolean(),
  message: Message.optional(),
  until: z.coerce.date().optional(),
});
export type MaintenanceInput = z.infer<typeof MaintenanceSchema>;
