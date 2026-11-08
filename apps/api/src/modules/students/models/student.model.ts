import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * What they're studying for. Levels run 1–5 within a programme: 3 on an undergraduate degree is
 * 300 level, 1 on an ND is ND1. `MAX_LEVEL` is how many years each one has.
 */
export const PROGRAMMES = [
  'undergraduate',
  'part_time',
  'masters',
  'doctorate',
  'pgd',
  'nd',
  'hnd',
  'nce',
  'diploma',
  'jupeb',
  'ijmb',
  'pre_degree',
  'pre_science',
  'foundation',
] as const;
export type Programme = (typeof PROGRAMMES)[number];

export const MAX_LEVEL: Record<Programme, number> = {
  undergraduate: 5,
  part_time: 5,
  masters: 2,
  doctorate: 5,
  pgd: 1,
  nd: 2,
  hnd: 2,
  nce: 3,
  diploma: 2,
  jupeb: 1,
  ijmb: 1,
  pre_degree: 1,
  pre_science: 1,
  foundation: 1,
};

const PROGRAMME_NAMES: Record<Programme, string> = {
  undergraduate: 'Undergraduate',
  part_time: 'Part-time / Sandwich',
  masters: 'Master’s',
  doctorate: 'Doctorate (PhD)',
  pgd: 'Postgraduate Diploma',
  nd: 'National Diploma (ND)',
  hnd: 'Higher National Diploma (HND)',
  nce: 'NCE',
  diploma: 'Diploma',
  jupeb: 'JUPEB',
  ijmb: 'IJMB',
  pre_degree: 'Pre-degree',
  pre_science: 'Pre-science',
  foundation: 'Foundation',
};
export const programmeName = (p: Programme) => PROGRAMME_NAMES[p];

/** "300 level", "ND1", "Year 2 · Master’s": how the level reads. */
export function levelLabel(programme: Programme, level: number) {
  if (programme === 'undergraduate' || programme === 'part_time') return `${level}00 level`;
  if (programme === 'nd' || programme === 'hnd') return `${programme.toUpperCase()}${level}`;
  if (MAX_LEVEL[programme] === 1) return PROGRAMME_NAMES[programme];
  return `Year ${level} · ${PROGRAMME_NAMES[programme]}`;
}

export type StudentVerificationStatus = 'unsubmitted' | 'pending' | 'verified' | 'rejected';

/**
 * Who a user is at school, told once: every class and association on Tasa reads it instead of
 * asking again. It counts once verified, by a code sent to their school email or by Tasa staff
 * checking a photo of their student ID card. Changing the school, department or matric number
 * takes it back to unverified; the level moves every session, so it doesn't.
 */
export interface IStudentProfile {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  school: Types.ObjectId;
  faculty?: string;
  department: string;
  /** `department`, lowercased and stripped, so "Dept. of Computer Science" finds "computer science". */
  departmentKey: string;
  programme: Programme;
  /** 1–5, up to `MAX_LEVEL[programme]`. */
  level: number;
  /** Uppercase, as printed on the ID card. Unique per school among verified students. */
  matricNumber: string;
  admissionYear: number;
  verification: {
    status: StudentVerificationStatus;
    method?: 'email' | 'id_card';
    /** The school address the code went to (email method). */
    email?: string;
    /** Encrypted photo of the ID card, for staff only (id_card method). */
    cardKey?: string;
    cardType?: string;
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: Types.ObjectId;
    reason?: string;
    verifiedAt?: Date;
    /** Staff took a verification back: only staff can verify them again. */
    revokedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const studentSchema = new Schema<IStudentProfile>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    school: { type: Schema.Types.ObjectId, ref: 'School', required: true },
    faculty: { type: String, trim: true },
    department: { type: String, required: true, trim: true },
    departmentKey: { type: String, required: true },
    programme: { type: String, enum: PROGRAMMES, required: true },
    level: { type: Number, min: 1, max: 5, required: true },
    matricNumber: { type: String, required: true, trim: true, uppercase: true },
    admissionYear: { type: Number, required: true },
    verification: {
      status: {
        type: String,
        enum: ['unsubmitted', 'pending', 'verified', 'rejected'],
        default: 'unsubmitted',
      },
      method: { type: String, enum: ['email', 'id_card'] },
      email: String,
      cardKey: String,
      cardType: String,
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
      reason: String,
      verifiedAt: Date,
      revokedAt: Date,
    },
  },
  { timestamps: true },
);
studentSchema.index({ user: 1 }, { unique: true });
// One verified account per matric number per school: nobody passes as someone else.
studentSchema.index(
  { school: 1, matricNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { 'verification.status': 'verified' },
  },
);
studentSchema.index({
  'verification.status': 1,
  'verification.submittedAt': 1,
});
studentSchema.index({ school: 1, departmentKey: 1 });

export const StudentProfileModel = model<IStudentProfile>('StudentProfile', studentSchema);
export type StudentProfileDoc = HydratedDocument<IStudentProfile>;

/** "Dept. of Computer Science " → "computer science": so the same department typed two ways counts once. */
export const departmentKey = (department: string) =>
  department
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(the )?(department|dept)\.?( of)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
