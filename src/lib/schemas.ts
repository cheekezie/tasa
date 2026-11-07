import { z } from 'zod';

export const ObjectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const IdParamsSchema = z.object({ id: ObjectIdSchema });

/** Accepts 080..., 23480..., +23480... and normalises to E.164 (+234XXXXXXXXXX). */
export const NigerianPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => /^(\+?234|0)[789][01]\d{8}$/.test(v), 'Enter a valid Nigerian phone number')
  .transform((v) => `+234${v.replace(/^(\+?234|0)/, '')}`);

/** Local 11-digit form (080…) — what VTU providers expect for airtime and data. */
export const localPhone = (e164: string) => `0${e164.replace(/^\+234/, '')}`;

/** Meter, smart card, phone, JAMB profile ID — or the email on a Smile account. */
export const BillAccountSchema = z
  .string()
  .trim()
  .min(4)
  .max(80)
  .regex(/^[0-9+]+$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Use digits only (or the email on a Smile account)');

/** Integer kobo. */
export const KoboSchema = z.number().int('Amount must be in kobo (a whole number)').positive();

export const PinSchema = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Same ids as the app's ServiceId. Data bundles are `airtime` with `product: 'data'`. */
export const SERVICE_IDS = ['electricity', 'airtime', 'tv', 'water', 'internet', 'jamb'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];
export const ServiceIdSchema = z.enum(SERVICE_IDS);

/**
 * How a person identifies themselves: a phone number, or an email for when SMS doesn't
 * get through. The app says which it is.
 */
export const ContactSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phone'), value: NigerianPhoneSchema }),
  z.object({ type: z.literal('email'), value: z.string().trim().toLowerCase().email('Enter a valid email address').max(254) }),
]);
export type Contact = z.infer<typeof ContactSchema>;

/** Who money or a gift is for: a Tasa username, a phone number or an email. */
export const RecipientSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('username'),
    value: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => v.replace(/^@/, ''))
      .refine((v) => /^[a-z][a-z0-9_]{2,19}$/.test(v), 'Enter a valid Tasa username'),
  }),
  ...ContactSchema.options,
]);
export type Recipient = z.infer<typeof RecipientSchema>;

/** How a recipient appears in the sender's own history: exactly what they typed. */
export const recipientLabel = (r: Recipient) => (r.type === 'username' ? `@${r.value}` : r.type === 'phone' ? localPhone(r.value) : r.value);
