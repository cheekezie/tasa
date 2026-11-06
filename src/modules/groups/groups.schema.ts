import { z } from 'zod';
import { KoboSchema, ObjectIdSchema, PaginationQuerySchema, PinSchema } from '../../lib/schemas';
import { DUE_KINDS, GROUP_PERIODS } from './models/group.model';

/** Anything less can't carry the collection fee. */
const DUES_MIN = 10_000;
export const MAX_PERIODS_PER_PAYMENT = 60;
export const MAX_BACKFILL_PERIODS = 120;
export const MAX_EXECUTIVES = 10;
export const MIN_COSIGNERS = 2;

export const MAX_OPEN_DUES = 10;

/** A recurring due needs a period; a one-off can have a deadline. */
export const DueSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    kind: z.enum(DUE_KINDS),
    period: z.enum(GROUP_PERIODS).optional(),
    amount: KoboSchema.min(DUES_MIN, 'Dues must be at least ₦100'),
    compulsory: z.boolean().default(true),
    dueAt: z.coerce.date().optional(),
  })
  .refine((d) => d.kind === 'one_off' || !!d.period, { path: ['period'], message: 'Choose how often it repeats' })
  .refine((d) => !d.dueAt || d.dueAt > new Date(), { path: ['dueAt'], message: 'The deadline must be in the future' })
  .transform((d) => (d.kind === 'recurring' ? { ...d, dueAt: undefined } : { ...d, period: undefined }));
export type DueInput = z.infer<typeof DueSchema>;

const FieldSchema = z.object({
  label: z.string().trim().min(2).max(40),
  required: z.boolean().default(false),
});

const BankSchema = {
  bankCode: z.string().trim().min(2).max(12),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
};

export const CreateGroupSchema = z.object({
  name: z.string().trim().min(3).max(80),
  about: z.string().trim().max(600).optional(),
  requireApproval: z.boolean().default(false),
  fields: z.array(FieldSchema).max(5).default([]),
  dues: z.array(DueSchema).min(1).max(MAX_OPEN_DUES),
  ...BankSchema,
});
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

export const UpdateGroupSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    about: z.string().trim().max(600),
    requireApproval: z.boolean(),
    fields: z.array(FieldSchema).max(5),
  })
  .partial();

export const DueParamsSchema = z.object({ id: ObjectIdSchema, dueId: ObjectIdSchema });
/** Ending is the only change: a price never moves once people owe it. */
export const UpdateDueSchema = z.object({ ended: z.literal(true) });
export const DueReportQuerySchema = PaginationQuerySchema.extend({
  /** Every month (week) of this calendar year; this year by default. Yearly dues show every year. */
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  search: z.string().trim().max(60).optional(),
});

export const JoinCodeParamsSchema = z.object({ code: z.string().trim().toUpperCase().min(4).max(16) });
export const JoinGroupSchema = z.object({
  code: z.string().trim().toUpperCase().min(4).max(16),
  /** By field key. Required ones must be there. */
  fields: z.record(z.string(), z.string().trim().max(120)).default({}),
  /** The terms version they were shown: it must still be the current one. */
  acceptTerms: z.number().int().positive(),
});

export const AcceptTermsSchema = z.object({ acceptTerms: z.number().int().positive() });

export const MemberParamsSchema = z.object({ id: ObjectIdSchema, memberId: ObjectIdSchema });
export const MembersQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'active']).optional(),
  owing: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().max(60).optional(),
});
export const BackfillSchema = z.object({
  dueId: ObjectIdSchema,
  periods: z.number().int().min(1).max(MAX_BACKFILL_PERIODS),
  note: z.string().trim().max(200).optional(),
});

export const AddExecutiveSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^@/, '')),
});
export const ExecutiveParamsSchema = z.object({ id: ObjectIdSchema, userId: ObjectIdSchema });

export const ProposePayoutChangeSchema = z.object({
  ...BankSchema,
  /** Executives (not the owner) who must each approve. */
  cosigners: z.array(ObjectIdSchema).min(MIN_COSIGNERS, `Choose at least ${MIN_COSIGNERS} executives to approve`).max(MAX_EXECUTIVES),
  pin: PinSchema,
});
export const ApprovePayoutChangeSchema = z.object({ pin: PinSchema });
export const ObjectPayoutChangeSchema = z.object({ reason: z.string().trim().min(5).max(300) });

export const GroupDuesQuoteSchema = z.object({
  kind: z.literal('group_dues'),
  groupId: ObjectIdSchema,
  /** The periods chosen, of each due. A one-off's only period is 0. */
  items: z
    .array(z.object({ dueId: ObjectIdSchema, periods: z.array(z.number().int()).min(1).max(MAX_PERIODS_PER_PAYMENT) }))
    .min(1)
    .max(MAX_OPEN_DUES)
    .refine((items) => items.reduce((n, i) => n + i.periods.length, 0) <= MAX_PERIODS_PER_PAYMENT, `Pay up to ${MAX_PERIODS_PER_PAYMENT} periods at once`),
});
export type GroupDuesQuoteInput = z.infer<typeof GroupDuesQuoteSchema>;

export const GroupPayoutQuoteSchema = z.object({
  kind: z.literal('group_payout'),
  groupId: ObjectIdSchema,
  amount: KoboSchema,
});
export type GroupPayoutQuoteInput = z.infer<typeof GroupPayoutQuoteSchema>;

export const PayQuoteSchema = z.object({ quoteId: ObjectIdSchema, pin: PinSchema });

// ── Back office ──
export const AdminGroupsQuerySchema = PaginationQuerySchema.extend({
  suspended: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().min(2).max(60).optional(),
});
export const GroupSuspensionSchema = z.discriminatedUnion('suspended', [
  z.object({ suspended: z.literal(true), reason: z.string().trim().min(5, 'Say why').max(300) }),
  /** Optional: why it's being lifted, for the history. */
  z.object({ suspended: z.literal(false), reason: z.string().trim().max(300).optional() }),
]);
