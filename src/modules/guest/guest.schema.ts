import { z } from 'zod';
import { NigerianPhoneSchema } from '../../lib/schemas';
import { BillQuoteSchema } from '../bills/bills.schema';

/** What can be bought on the website: the one-off bills. Everything else needs the app. */
export const GUEST_SERVICES = ['jamb', 'electricity', 'airtime'] as const;
/** Kobo. More than this goes through the app, with its PIN and sign-in. */
export const GUEST_MAX_TOTAL = 5_000_000;
/** Orders one phone number can start in a day. */
export const GUEST_DAILY_ORDERS = 5;

const GuestBillSchema = BillQuoteSchema.pick({ serviceId: true, provider: true, account: true, amount: true, product: true, planCode: true, meterType: true }).refine(
  (b) => (GUEST_SERVICES as readonly string[]).includes(b.serviceId),
  { path: ['serviceId'], message: 'Use the Tela app for this bill' },
);

export const GuestVerifySchema = GuestBillSchema;

export const CreateGuestOrderSchema = z.object({
  bill: GuestBillSchema,
  /** Where the PIN or token is texted, and whose Tela wallet keeps any refund. */
  phone: NigerianPhoneSchema,
  email: z.string().trim().toLowerCase().email().max(120).optional(),
});
export type CreateGuestOrderInput = z.infer<typeof CreateGuestOrderSchema>;

export const GuestOrderParamsSchema = z.object({ reference: z.string().trim().regex(/^TLY[A-Z0-9]{8,20}$/) });
export const GuestOrderQuerySchema = z.object({ key: z.string().regex(/^[a-f0-9]{48}$/) });
export const GuestPlansParamsSchema = z.object({ serviceId: z.enum(GUEST_SERVICES), provider: z.string().trim().min(2).max(40) });
