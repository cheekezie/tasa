import { z } from 'zod';
import { KoboSchema, NigerianPhoneSchema, ObjectIdSchema, PaginationQuerySchema, PinSchema } from '../../lib/schemas';
import { SELLER_ID_TYPES, SELLER_VERIFICATION_STATUSES } from './models/ticket.model';

/** Anything less can't carry the selling fee. */
const TICKET_MIN = 10_000;
export const MAX_TICKETS_PER_ORDER = 10;
const REFUND_DAYS_MAX = 30;

const TierSchema = z.object({
  name: z.string().trim().min(2).max(40),
  /** What it gets you, e.g. free drinks and popcorn. */
  covers: z.string().trim().max(160).optional(),
  price: z.number().int().min(TICKET_MIN, 'The minimum ticket price is ₦100').max(100_000_000),
  /** How many can be sold. Leave out for no limit. */
  limit: z.number().int().min(1).max(1_000_000).nullable().default(null),
});

export const CreateEventSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    /** Who buyers call about the event. The organiser's name comes from their seller profile. */
    phone: NigerianPhoneSchema,
    /** Who buyers write to about the event. */
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254).optional(),
    description: z.string().trim().max(1000).optional(),
    venue: z.string().trim().min(3).max(120),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
    /** 0 = no refunds. Otherwise buyers can cancel for this many days after buying. */
    refundDays: z.number().int().min(0).max(REFUND_DAYS_MAX).default(0),
    tiers: z.array(TierSchema).min(1, 'Add at least one ticket type').max(10),
  })
  .refine((e) => e.startsAt > new Date(), {
    path: ['startsAt'],
    message: 'The event must be in the future',
  })
  .refine((e) => !e.endsAt || e.endsAt > e.startsAt, {
    path: ['endsAt'],
    message: 'The event must end after it starts',
  });
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = z.object({
  /** There's no cancelling an event: this stops new sales, and turning it off starts them again. */
  salesPaused: z.boolean().optional(),
  /** New limits. null removes one. A limit can't go below what's already sold. */
  limits: z
    .array(
      z.object({
        tierId: ObjectIdSchema,
        limit: z.number().int().min(1).max(1_000_000).nullable(),
      }),
    )
    .max(10)
    .optional(),
});
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;

/** The brand or group buyers see on every event and ticket. */
const OrganisationSchema = z.string().trim().min(2, 'Enter your organisation name').max(60);

/**
 * The version of the selling terms the app shows. Bump it when the terms change: sellers
 * then accept again before their next event.
 */
export const SELLER_TERMS_VERSION = '2026-11-01';

const AcceptTermsSchema = z.literal(SELLER_TERMS_VERSION, {
  message: 'Accept the latest selling terms',
});

/** What buyers read on the organiser's page. Empty strings clear a field. */
const ProfileSchema = z.object({
  about: z.string().trim().max(600).optional(),
  phone: z.union([NigerianPhoneSchema, z.literal('')]).optional(),
  email: z.union([z.string().trim().toLowerCase().email('Enter a valid email address').max(254), z.literal('')]).optional(),
  website: z
    .union([
      z
        .string()
        .trim()
        .url('Enter a full web address, like https://…')
        .max(200)
        .refine((u) => /^https?:\/\//i.test(u), 'Use an http or https address'),
      z.literal(''),
    ])
    .optional(),
  /** A handle, with or without the @. */
  instagram: z
    .union([
      z
        .string()
        .trim()
        .transform((v) => v.replace(/^@/, ''))
        .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'Enter an Instagram handle')),
      z.literal(''),
    ])
    .optional(),
});
export type ProfileInput = z.infer<typeof ProfileSchema>;

/**
 * Who buyers see and the terms they agree to, plus where the money goes if they have it to hand
 * (it can wait until their first withdrawal). No PIN: nothing is paid; withdrawing takes it.
 */
export const OptInSchema = ProfileSchema.extend({
  organisation: OrganisationSchema,
  bankCode: z.string().trim().min(2).max(12).optional(),
  accountNumber: z
    .string()
    .regex(/^\d{10}$/, 'Account number must be 10 digits')
    .optional(),
  acceptTerms: AcceptTermsSchema,
}).refine((v) => !v.bankCode === !v.accountNumber, {
  path: ['accountNumber'],
  message: 'Give both the bank and the account number, or neither',
});
export type OptInInput = z.infer<typeof OptInSchema>;

export const UpdateSellerSchema = ProfileSchema.extend({
  organisation: OrganisationSchema.optional(),
  acceptTerms: AcceptTermsSchema.optional(),
}).refine((v) => Object.values(v).some((field) => field !== undefined), 'Nothing to change');
export type UpdateSellerInput = z.infer<typeof UpdateSellerSchema>;

/** Only someone whose ticket was scanned at the event can rate it. */
export const RateEventSchema = z.object({
  stars: z.number().int().min(1).max(5),
});

export const FeesQuerySchema = z.object({
  price: z.coerce.number().int().positive(),
});

export const EventListQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
});

export const EventCodeParamsSchema = z.object({
  code: z.string().trim().min(4).max(20),
});

export const MediaParamsSchema = z.object({
  id: ObjectIdSchema,
  mediaId: ObjectIdSchema,
});

export const StaffSchema = z.object({
  username: z.string().trim().min(2).max(40),
});
export const StaffParamsSchema = z.object({
  id: ObjectIdSchema,
  userId: ObjectIdSchema,
});

export const ScanSchema = z.object({ code: z.string().trim().min(8).max(40) });

export const TicketQuoteSchema = z.object({
  kind: z.literal('ticket'),
  eventId: ObjectIdSchema,
  tierId: ObjectIdSchema,
  quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER).default(1),
});
export type TicketQuoteInput = z.infer<typeof TicketQuoteSchema>;

export const BuyTicketsSchema = z.object({
  quoteId: ObjectIdSchema,
  pin: PinSchema,
  /** Who each ticket is for, in order: one name per ticket, checked at the door. */
  holders: z.array(z.string().trim().min(2, 'Enter a name for each ticket').max(60)).min(1).max(MAX_TICKETS_PER_ORDER),
});

export const VerifyBankSchema = z.object({
  bankCode: z.string().trim().min(2).max(12),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
});

/** No account name: the bank says what that is, not the seller. */
/** No PIN: saving where sales go moves no money. Withdrawing there does, and takes the PIN. */
export const BankAccountSchema = VerifyBankSchema;
export type BankAccountInput = z.infer<typeof BankAccountSchema>;

/** Ticket sales to the seller's saved bank account. Priced first: the bank withdrawal fee is a charge rule. */
export const TicketPayoutQuoteSchema = z.object({
  kind: z.literal('ticket_payout'),
  amount: KoboSchema,
});
export type TicketPayoutQuoteInput = z.infer<typeof TicketPayoutQuoteSchema>;

export const PayoutSchema = z.object({
  quoteId: ObjectIdSchema,
  pin: PinSchema,
});

/** To the bill payment wallet: for bills only, and it can't come back out. */
export const WithdrawSchema = z.object({
  amount: KoboSchema,
  pin: PinSchema,
  /** Generated once per withdrawal by the client, so a retry can't withdraw twice. */
  idempotencyKey: z.string().trim().min(8).max(64),
});

export const AdminEventsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().min(1).max(60).optional(),
  sales: z.enum(['on_sale', 'paused', 'ended', 'tasa_paused']).optional(),
  owner: ObjectIdSchema.optional(),
});

export const SellerIdTypeSchema = z.enum(SELLER_ID_TYPES, { message: 'Choose the kind of ID' });

export const AdminSellersQuerySchema = PaginationQuerySchema.extend({
  verification: z.enum([...SELLER_VERIFICATION_STATUSES, 'unsubmitted']).optional(),
  suspended: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().min(2).max(60).optional(),
});

export const SellerDocumentParamsSchema = z.object({ id: ObjectIdSchema, kind: z.enum(['photo', 'id']) });
/** An earlier submission's id (from the detail's `verification.history`); without it, the current one. */
export const SellerDocumentQuerySchema = z.object({ submission: ObjectIdSchema.optional() });

export const SellerReviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved') }),
  z.object({ status: z.literal('rejected'), reason: z.string().trim().min(5, 'Say why, so they can fix it').max(300) }),
]);

export const SellerSuspensionSchema = z.discriminatedUnion('suspended', [
  z.object({ suspended: z.literal(true), reason: z.string().trim().min(5, 'Say why').max(300) }),
  /** Optional: why it's being lifted, for the history. */
  z.object({ suspended: z.literal(false), reason: z.string().trim().max(300).optional() }),
]);
