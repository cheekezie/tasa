import { z } from 'zod';
import { ObjectIdSchema, PaginationQuerySchema } from '../../lib/schemas';
import { MAX_LEVEL, PROGRAMMES } from './models/student.model';
import { SCHOOL_KINDS, SCHOOL_OWNERSHIPS } from './models/school.model';

const thisYear = () => new Date().getFullYear();

export const SchoolsQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
});

export const StudentProfileSchema = z
  .object({
    schoolId: ObjectIdSchema,
    faculty: z.string().trim().max(80).optional(),
    department: z.string().trim().min(2, 'Enter your department').max(80),
    programme: z.enum(PROGRAMMES),
    level: z.coerce.number().int().min(1).max(5),
    matricNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9/.\-]{3,24}$/, 'Enter your matric number as it is on your ID card'),
    admissionYear: z.coerce
      .number()
      .int()
      .min(1990)
      .refine((y) => y <= thisYear() + 1, 'Check your admission year'),
  })
  .refine((p) => p.level <= MAX_LEVEL[p.programme], { path: ['level'], message: 'Choose a level your programme has' });
export type StudentProfileInput = z.infer<typeof StudentProfileSchema>;

export const SchoolEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter your school email address').max(254),
});
export const SchoolEmailVerifySchema = SchoolEmailSchema.extend({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const DepartmentsQuerySchema = z.object({
  schoolId: ObjectIdSchema,
  search: z.string().trim().max(60).optional(),
});

// ── Back office ──
export const AdminStudentsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['unsubmitted', 'pending', 'verified', 'rejected']).optional(),
  schoolId: ObjectIdSchema.optional(),
  search: z.string().trim().min(2).max(60).optional(),
});
export const StudentReviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verified') }),
  z.object({
    status: z.literal('rejected'),
    reason: z.string().trim().min(5, 'Say why, so they can fix it').max(300),
  }),
]);

const DomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ''))
  .refine((v) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v), 'Enter a domain like live.unilag.edu.ng');

export const SchoolSchema = z.object({
  name: z.string().trim().min(3).max(120),
  shortName: z.string().trim().min(2).max(20),
  kind: z.enum(SCHOOL_KINDS),
  ownership: z.enum(SCHOOL_OWNERSHIPS).optional(),
  state: z.string().trim().min(2).max(40),
  website: z.string().trim().url().max(200).optional(),
  emailDomains: z.array(DomainSchema).max(5).default([]),
  active: z.boolean().default(false),
});
export const UpdateSchoolSchema = SchoolSchema.partial();
export const AdminSchoolsQuerySchema = PaginationQuerySchema.extend({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).max(60).optional(),
});

export const StudentTermsSchema = z.object({ acceptTerms: z.number().int().positive() });
export const SchoolParamsSchema = z.object({ id: ObjectIdSchema });

const NameSchema = z.string().trim().min(2).max(80);
export const FacultiesSchema = z.object({
  faculties: z
    .array(z.object({ name: NameSchema, departments: z.array(NameSchema).max(80) }))
    .max(40)
    .refine((list) => new Set(list.map((f) => f.name.toLowerCase())).size === list.length, 'List each faculty once'),
});

export const RevokeStudentSchema = z.object({ reason: z.string().trim().min(5, 'Say why').max(300) });
