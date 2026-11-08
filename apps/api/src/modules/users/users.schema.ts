import { z } from 'zod';
import { ContactSchema, PinSchema } from '../../lib/schemas';

/** Matches the app's rules: 3–20 chars, starts with a letter, letters/digits/underscore. */
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ''))
  .refine((v) => /^[a-z][a-z0-9_]{2,19}$/.test(v), 'Usernames are 3–20 letters, numbers or _ and start with a letter');

const RESERVED = new Set(['tasa', 'tela', 'admin', 'support', 'help', 'root', 'system', 'official']);

export const UpdateProfileSchema = z
  .object({
    username: UsernameSchema.refine((v) => !RESERVED.has(v), 'That username is reserved'),
    // Phone and email are sign-in identities, so they change only through
    // POST /me/contacts/otp + /verify, never by a plain PATCH.
    fullName: z.string().trim().min(2).max(80),
    payday: z.number().int().min(1).max(31).nullable(),
    notificationPrefs: z
      .object({ shortfallReminders: z.boolean(), push: z.boolean(), paymentReceipts: z.boolean(), walletFunding: z.boolean(), offers: z.boolean() })
      .partial(),
  })
  .partial();
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const NinSchema = z.object({ nin: z.string().regex(/^\d{11}$/, 'NIN must be 11 digits') });
export const BvnSchema = z.object({ bvn: z.string().regex(/^\d{11}$/, 'BVN must be 11 digits') });

export const SetPinSchema = z.object({ pin: PinSchema, currentPin: PinSchema.optional() });
export const BillPinSchema = z.object({ enabled: z.boolean(), pin: PinSchema });
export const VerifyPinSchema = z.object({ pin: PinSchema });
export const ResetPinSchema = z.object({ pin: PinSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const CloseAccountSchema = z.object({
  pin: PinSchema,
  /** Kobo: the small balance the user agreed to give up, exactly as they saw it. */
  forfeitAmount: z.number().int().positive().optional(),
});
export const ContactVerifySchema = z.intersection(ContactSchema, z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }));

export const PushTokenSchema = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/, 'Not an Expo push token') });
