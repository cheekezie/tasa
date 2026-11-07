import { Types, type FilterQuery } from 'mongoose';
import { decryptBytes, encryptBytes } from '../../lib/crypto';
import { isDuplicateKey } from '../../lib/db';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { r2 } from '../../lib/r2';
import { paginate } from '../../lib/response';
import { adminNames } from '../admins/admins.service';
import { AdminAuditModel } from '../admins/models/admin-audit.model';
import { OtpService } from '../auth/otp.service';
import { UserModel } from '../users/models/user.model';
import { AvatarsService, AVATAR_MAX_BYTES, sniffImage } from '../users/avatars.service';
import { staffUserLabels } from '../users/users.service';
import { SchoolModel, type ISchool } from './models/school.model';
import { departmentKey, levelLabel, StudentProfileModel, type IStudentProfile, type StudentVerificationStatus } from './models/student.model';
import { GENERAL_FACULTIES } from './faculties.data';
import type { StudentProfileInput } from './students.schema';

/** Bump when the student terms change: everyone accepts again before saving their details. */
export const STUDENT_TERMS_VERSION = 1;

/** What a user agrees to when they say they're a student. */
const STUDENT_TERMS = [
  'I’m a student at a Nigerian university, polytechnic or college, and the details I give are true.',
  'Tasa checks I’m a student with my school email or a photo of my student ID card, which only Tasa staff see.',
  'Pretending to be another student, or giving false details, can get my account suspended.',
];

/** The route an ID card view is logged under, so the audit trail reads like any other admin action. */
export const CARD_ROUTE = '/api/admin/students/:id/card';

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const schoolDto = (s: Pick<ISchool, '_id' | 'name' | 'shortName' | 'kind' | 'state' | 'emailDomains' | 'logoKey' | 'ownership'>) => ({
  id: s._id.toString(),
  name: s.name,
  shortName: s.shortName,
  kind: s.kind,
  ownership: s.ownership ?? null,
  state: s.state,
  logoUrl: s.logoKey ? r2.publicUrl(s.logoKey) : null,
  /** A code to an address at one of these verifies them; none means ID card only. */
  emailDomains: s.emailDomains,
});

function verificationDto(p: Pick<IStudentProfile, 'verification'>) {
  const v = p.verification;
  return {
    status: (v?.status ?? 'unsubmitted') as StudentVerificationStatus,
    method: v?.method ?? null,
    email: v?.method === 'email' ? (v.email ?? null) : null,
    submittedAt: v?.submittedAt?.toISOString() ?? null,
    verifiedAt: v?.verifiedAt?.toISOString() ?? null,
    reason: v?.status === 'rejected' ? (v.reason ?? null) : null,
    /** Staff took it back: only staff can verify them again (send an ID card). */
    revoked: Boolean(v?.revokedAt),
  };
}

function profileDto(p: IStudentProfile, school: ISchool | null) {
  return {
    school: school ? schoolDto(school) : null,
    faculty: p.faculty ?? null,
    department: p.department,
    programme: p.programme,
    level: p.level,
    /** "300 level", "ND1", "Year 1 · Master’s". */
    levelLabel: levelLabel(p.programme, p.level),
    matricNumber: p.matricNumber,
    admissionYear: p.admissionYear,
    verification: verificationDto(p),
  };
}

/** The bytes decide, as with every upload: a photo staff can see in place, not a PDF. */
function checkImage(buffer: Buffer, what: string) {
  if (buffer.length > AVATAR_MAX_BYTES) throw unprocessable(`Use a ${what} under 5MB`, 'PHOTO_TOO_LARGE');
  const image = sniffImage(buffer);
  if (!image) throw unprocessable(`Use a JPEG, PNG or WebP photo of your ${what}`, 'PHOTO_INVALID');
  return image;
}

/** Encrypted in the public bucket, like organisers' IDs: only staff can open it, through the API. */
export async function storePrivately(folder: string, buffer: Buffer) {
  const { key } = await r2.uploadFile(encryptBytes(buffer), 'bin', 'application/octet-stream', folder);
  return key;
}

const domainOf = (email: string) => email.split('@')[1] ?? '';
/** `live.unilag.edu.ng` accepts that domain and anything under it. */
const onDomain = (email: string, domains: string[]) => domains.some((d) => domainOf(email) === d || domainOf(email).endsWith(`.${d}`));

async function activeSchool(id: string | Types.ObjectId) {
  const school = await SchoolModel.findById(id).lean();
  if (!school?.active) throw unprocessable('Choose your school from the list', 'SCHOOL_UNAVAILABLE');
  return school;
}

const matricTaken = () => conflict('Another Tasa account is verified with this matric number. Contact Tasa support if it’s yours.', 'MATRIC_TAKEN');

export const SchoolsService = {
  /** The schools a student can pick: active ones only. */
  async search(search?: string) {
    const filter: FilterQuery<ISchool> = { active: true };
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: pattern }, { shortName: pattern }, { state: pattern }];
    }
    const schools = await SchoolModel.find(filter).sort({ shortName: 1 }).limit(50).lean();
    return schools.map(schoolDto);
  },

  async list(q: { active?: boolean | undefined; search?: string | undefined; page: number; limit: number }) {
    const filter: FilterQuery<ISchool> = {};
    if (q.active !== undefined) filter.active = q.active;
    if (q.search) {
      const pattern = new RegExp(escapeRegex(q.search), 'i');
      filter.$or = [{ name: pattern }, { shortName: pattern }, { state: pattern }];
    }
    const [items, total] = await Promise.all([
      SchoolModel.find(filter)
        .sort({ active: -1, shortName: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      SchoolModel.countDocuments(filter),
    ]);
    const counts = await StudentProfileModel.aggregate<{
      _id: { school: Types.ObjectId; status: string };
      n: number;
    }>([
      { $match: { school: { $in: items.map((s) => s._id) } } },
      {
        $group: {
          _id: { school: '$school', status: '$verification.status' },
          n: { $sum: 1 },
        },
      },
    ]);
    const count = (id: Types.ObjectId, status: string) => counts.find((c) => c._id.school.equals(id) && c._id.status === status)?.n ?? 0;
    return paginate(
      items.map((s) => ({
        ...schoolDto(s),
        active: s.active,
        website: s.website ?? null,
        students: {
          verified: count(s._id, 'verified'),
          pending: count(s._id, 'pending'),
        },
        createdAt: s.createdAt.toISOString(),
      })),
      total,
      q.page,
      q.limit,
    );
  },

  async create(input: {
    name: string;
    shortName: string;
    kind: ISchool['kind'];
    ownership?: ISchool['ownership'] | undefined;
    state: string;
    website?: string | undefined;
    emailDomains: string[];
    active: boolean;
  }) {
    try {
      const school = await SchoolModel.create({
        ...input,
        emailDomains: [...new Set(input.emailDomains)],
      });
      return { ...schoolDto(school), active: school.active };
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('A school with this name is already listed', 'SCHOOL_EXISTS');
      throw err;
    }
  },

  async update(
    id: string,
    input: Partial<{
      name: string;
      shortName: string;
      kind: ISchool['kind'];
      ownership: ISchool['ownership'];
      state: string;
      website: string;
      emailDomains: string[];
      active: boolean;
    }>,
  ) {
    try {
      const school = await SchoolModel.findByIdAndUpdate(
        id,
        {
          ...input,
          ...(input.emailDomains && {
            emailDomains: [...new Set(input.emailDomains)],
          }),
        },
        { new: true },
      );
      if (!school) throw notFound('School not found');
      return {
        ...schoolDto(school),
        active: school.active,
        website: school.website ?? null,
      };
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('A school with this name is already listed', 'SCHOOL_EXISTS');
      throw err;
    }
  },

  /** One school for staff, as a list row has it. */
  async get(id: string) {
    const school = await SchoolModel.findById(id).lean();
    if (!school) throw notFound('School not found');
    const counts = await StudentProfileModel.aggregate<{ _id: string; n: number }>([
      { $match: { school: school._id } },
      { $group: { _id: '$verification.status', n: { $sum: 1 } } },
    ]);
    const count = (status: string) => counts.find((c) => c._id === status)?.n ?? 0;
    return {
      ...schoolDto(school),
      active: school.active,
      website: school.website ?? null,
      students: { verified: count('verified'), pending: count('pending') },
      createdAt: school.createdAt.toISOString(),
    };
  },

  /** Its faculties and departments to choose from: its own once staff have added them, else the general list. */
  async faculties(id: string) {
    const school = await activeSchool(id);
    return school.faculties.length ? { general: false, faculties: school.faculties } : { general: true, faculties: GENERAL_FACULTIES };
  },

  /** For staff: the school's own list (empty until added), the general one to start from, and what students typed. */
  async adminFaculties(id: string) {
    const school = await SchoolModel.findById(id).select('faculties').lean();
    if (!school) throw notFound('School not found');
    return { faculties: school.faculties, general: GENERAL_FACULTIES, unlisted: await this.unlisted(id) };
  },

  /** Staff replace a school's list. Empty brings back the general one. */
  async setFaculties(id: string, faculties: { name: string; departments: string[] }[]) {
    const clean = faculties.map((f) => ({ name: f.name, departments: [...new Set(f.departments)] }));
    const school = await SchoolModel.findByIdAndUpdate(id, { faculties: clean }, { new: true }).lean();
    if (!school) throw notFound('School not found');
    return { faculties: school.faculties, unlisted: await this.unlisted(id) };
  },

  /**
   * Departments students at a school typed because they weren't on its list (or the general
   * one), with how many students each: what to add next.
   */
  async unlisted(id: string) {
    const school = await SchoolModel.findById(id).select('faculties').lean();
    if (!school) throw notFound('School not found');
    const listed = new Set((school.faculties.length ? school.faculties : GENERAL_FACULTIES).flatMap((f) => f.departments.map(departmentKey)));
    const rows = await StudentProfileModel.aggregate<{ _id: string; department: string; faculty: string | null; students: number }>([
      { $match: { school: school._id } },
      { $group: { _id: '$departmentKey', department: { $first: '$department' }, faculty: { $first: '$faculty' }, students: { $sum: 1 } } },
      { $sort: { students: -1 } },
    ]);
    return rows.filter((r) => !listed.has(r._id)).map((r) => ({ department: r.department, faculty: r.faculty ?? null, students: r.students }));
  },

  /** Its logo, shown wherever students pick or see their school. Replacing it removes the old file. */
  async setLogo(id: string, buffer: Buffer) {
    const image = sniffImage(buffer);
    if (!image) throw unprocessable('Use a JPEG, PNG or WebP image', 'PHOTO_INVALID');
    if (!(await SchoolModel.exists({ _id: id }))) throw notFound('School not found');
    const { key } = await r2.uploadFile(buffer, image.extension, image.mimeType, 'schools');
    const previous = await SchoolModel.findByIdAndUpdate(id, { logoKey: key, $unset: { logoSource: 1 } });
    if (previous?.logoKey) await AvatarsService.purge(previous.logoKey);
    const school = (await SchoolModel.findById(id))!;
    return {
      ...schoolDto(school),
      active: school.active,
      website: school.website ?? null,
    };
  },
};

export const StudentsService = {
  /** The student terms, and whether they've accepted this version. */
  async terms(userId: string) {
    const user = await UserModel.findById(userId).select('studentTerms').lean();
    return { version: STUDENT_TERMS_VERSION, points: STUDENT_TERMS, accepted: user?.studentTerms?.version === STUDENT_TERMS_VERSION };
  },

  /** They say they're a student and accept the terms shown (`version`). */
  async acceptTerms(userId: string, version: number) {
    if (version !== STUDENT_TERMS_VERSION) throw conflict('The student terms have changed. Read them again.', 'STUDENT_TERMS_CHANGED');
    await UserModel.updateOne({ _id: userId }, { studentTerms: { version, at: new Date() } });
    return this.terms(userId);
  },

  /** Their profile, or null before they've told us. */
  async me(userId: string) {
    const profile = await StudentProfileModel.findOne({ user: userId }).lean();
    if (!profile) return null;
    return profileDto(profile, await SchoolModel.findById(profile.school).lean());
  },

  /** For gates elsewhere: the profile, verified or not. */
  profileOf: (userId: string | Types.ObjectId) => StudentProfileModel.findOne({ user: userId }).lean(),

  /**
   * Tells us (or updates) who they are at school. Changing the school, department or matric
   * number undoes a verification, and drops an ID card waiting for review: it showed the old one.
   */
  async save(userId: string, input: StudentProfileInput) {
    if (!(await this.terms(userId)).accepted) throw conflict('Accept the student terms first', 'STUDENT_TERMS_REQUIRED');
    const school = await activeSchool(input.schoolId);
    const existing = await StudentProfileModel.findOne({ user: userId });
    const key = departmentKey(input.department);
    if (!key) throw unprocessable('Enter your department', 'FIELD_REQUIRED');
    const taken = await StudentProfileModel.exists({
      school: school._id,
      matricNumber: input.matricNumber,
      'verification.status': 'verified',
      user: { $ne: userId },
    });
    if (taken) throw matricTaken();

    const identityChanged = !existing || !existing.school.equals(school._id) || existing.departmentKey !== key || existing.matricNumber !== input.matricNumber;
    const fields = {
      school: school._id,
      faculty: input.faculty || undefined,
      department: input.department,
      departmentKey: key,
      programme: input.programme,
      level: input.level,
      matricNumber: input.matricNumber,
      admissionYear: input.admissionYear,
    };
    if (!existing) {
      await StudentProfileModel.create({
        user: userId,
        ...fields,
        verification: { status: 'unsubmitted' },
      });
    } else {
      const dropCard = identityChanged ? existing.verification?.cardKey : undefined;
      existing.set(fields);
      if (identityChanged && existing.verification?.status !== 'unsubmitted') existing.verification = { status: 'unsubmitted' };
      try {
        await existing.save();
      } catch (err) {
        if (isDuplicateKey(err)) throw matricTaken();
        throw err;
      }
      if (dropCard) await AvatarsService.purge(dropCard);
    }
    return this.me(userId);
  },

  /** A code to their school address. Only the school's own domains count. */
  async sendEmailCode(userId: string, email: string) {
    const profile = await StudentProfileModel.findOne({ user: userId }).lean();
    if (!profile) throw unprocessable('Add your student details first', 'STUDENT_PROFILE_MISSING');
    if (profile.verification?.status === 'verified') throw conflict('You’re already verified', 'STUDENT_ALREADY_VERIFIED');
    const school = await activeSchool(profile.school);
    if (!school.emailDomains.length)
      throw unprocessable(`${school.shortName} email can’t be used yet. Send a photo of your student ID card instead.`, 'SCHOOL_EMAIL_UNAVAILABLE');
    if (!onDomain(email, school.emailDomains)) {
      throw unprocessable(`Use your ${school.shortName} email (ending in @${school.emailDomains[0]})`, 'SCHOOL_EMAIL_INVALID');
    }
    if (
      await StudentProfileModel.exists({
        'verification.email': email,
        'verification.status': 'verified',
        user: { $ne: userId },
      })
    ) {
      throw conflict('Another Tasa account is verified with this email', 'SCHOOL_EMAIL_TAKEN');
    }
    return OtpService.send({ type: 'email', value: email }, 'student_email');
  },

  async verifyEmail(userId: string, email: string, code: string) {
    const profile = await StudentProfileModel.findOne({ user: userId }).lean();
    if (!profile) throw unprocessable('Add your student details first', 'STUDENT_PROFILE_MISSING');
    const school = await activeSchool(profile.school);
    if (!onDomain(email, school.emailDomains)) throw unprocessable(`Use your ${school.shortName} email`, 'SCHOOL_EMAIL_INVALID');
    await OtpService.verify({ type: 'email', value: email }, code, 'student_email');
    const dropCard = profile.verification?.cardKey;
    try {
      const updated = await StudentProfileModel.findOneAndUpdate(
        { _id: profile._id, 'verification.status': { $ne: 'verified' } },
        {
          verification: {
            status: 'verified',
            method: 'email',
            email,
            submittedAt: new Date(),
            verifiedAt: new Date(),
          },
        },
      );
      if (!updated) throw conflict('You’re already verified', 'STUDENT_ALREADY_VERIFIED');
    } catch (err) {
      if (isDuplicateKey(err)) throw matricTaken();
      throw err;
    }
    if (dropCard) await AvatarsService.purge(dropCard);
    bus.emit('student.verified', { userId, status: 'verified' });
    return this.me(userId);
  },

  /** A photo of their student ID card, for Tasa staff to check against what they told us. */
  async submitCard(userId: string, buffer: Buffer) {
    const profile = await StudentProfileModel.findOne({ user: userId }).lean();
    if (!profile) throw unprocessable('Add your student details first', 'STUDENT_PROFILE_MISSING');
    if (profile.verification?.status === 'verified') throw conflict('You’re already verified', 'STUDENT_ALREADY_VERIFIED');
    const image = checkImage(buffer, 'student ID card');
    const cardKey = await storePrivately(`students/${userId}`, buffer);
    // Compare-and-set on what we read, so a review landing meanwhile isn't overwritten.
    const updated = await StudentProfileModel.findOneAndUpdate(
      {
        _id: profile._id,
        'verification.status': profile.verification?.status ?? 'unsubmitted',
      },
      {
        verification: {
          status: 'pending',
          method: 'id_card',
          cardKey,
          cardType: image.mimeType,
          submittedAt: new Date(),
        },
      },
    );
    if (!updated) {
      await AvatarsService.purge(cardKey);
      throw conflict('Your details were just reviewed. Check your student profile.', 'STUDENT_REVIEW_CHANGED');
    }
    if (profile.verification?.cardKey) await AvatarsService.purge(profile.verification.cardKey);
    return this.me(userId);
  },

  /** Department names already used at a school, most common first: so classmates type the same one. */
  async departments(schoolId: string, search?: string) {
    const match: FilterQuery<IStudentProfile> = {
      school: new Types.ObjectId(schoolId),
    };
    if (search) match.departmentKey = new RegExp(escapeRegex(departmentKey(search)), 'i');
    const rows = await StudentProfileModel.aggregate<{
      _id: string;
      name: string;
      n: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: '$departmentKey',
          name: { $first: '$department' },
          n: { $sum: 1 },
        },
      },
      { $sort: { n: -1, name: 1 } },
      { $limit: 20 },
    ]);
    return rows.map((r) => r.name);
  },

  // ── Back office ────────────────────────────────────────────────────────
  async list(q: { status?: StudentVerificationStatus | undefined; schoolId?: string | undefined; search?: string | undefined; page: number; limit: number }) {
    const filter: FilterQuery<IStudentProfile> = {};
    if (q.status) filter['verification.status'] = q.status;
    if (q.schoolId) filter.school = q.schoolId;
    if (q.search) {
      const pattern = new RegExp(escapeRegex(q.search), 'i');
      const users = await UserModel.find({
        $or: [{ fullName: pattern }, { username: pattern }, { phone: pattern }, { email: pattern }],
      })
        .select('_id')
        .limit(200)
        .lean();
      filter.$or = [{ matricNumber: pattern }, { department: pattern }, { user: { $in: users.map((u) => u._id) } }];
    }
    // The review queue reads oldest first; everything else newest first.
    const sort: Record<string, 1 | -1> = q.status === 'pending' ? { 'verification.submittedAt': 1 } : { updatedAt: -1 };
    const [items, total] = await Promise.all([
      StudentProfileModel.find(filter)
        .sort(sort)
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      StudentProfileModel.countDocuments(filter),
    ]);
    const [names, schools] = await Promise.all([staffUserLabels(items.map((p) => p.user)), SchoolModel.find({ _id: { $in: items.map((p) => p.school) } }).lean()]);
    return paginate(
      items.map((p) => ({
        id: p.user.toString(),
        name: names.get(p.user.toString())?.name ?? null,
        username: names.get(p.user.toString())?.username ?? null,
        ...profileDto(p, schools.find((s) => s._id.equals(p.school)) ?? null),
        updatedAt: p.updatedAt.toISOString(),
      })),
      total,
      q.page,
      q.limit,
    );
  },

  /** Everything staff need to decide, except the card itself (see `card`). Ids are the user's. */
  async detail(userId: string) {
    const profile = await StudentProfileModel.findOne({ user: userId }).lean();
    if (!profile) throw notFound('Student not found');
    const [user, school, staff] = await Promise.all([
      UserModel.findById(userId).select('fullName username phone email avatarKey status createdAt').lean(),
      SchoolModel.findById(profile.school).lean(),
      adminNames([profile.verification?.reviewedBy]),
    ]);
    return {
      id: userId,
      ...profileDto(profile, school),
      verification: {
        ...verificationDto(profile),
        hasCard: Boolean(profile.verification?.cardKey),
        reviewedAt: profile.verification?.reviewedAt?.toISOString() ?? null,
        reviewedBy: profile.verification?.reviewedBy ? (staff.get(profile.verification.reviewedBy.toString()) ?? null) : null,
      },
      user: user && {
        name: user.fullName ?? null,
        username: user.username ?? null,
        phone: user.phone ?? null,
        email: user.email ?? null,
        avatarUrl: user.avatarKey ? r2.publicUrl(user.avatarKey) : null,
        status: user.status,
        joinedAt: user.createdAt.toISOString(),
      },
    };
  },

  /** The ID card, decrypted for staff. Logged before decrypting: if the log can't be written, nobody sees it. */
  async card(userId: string, audit: { admin: string; role?: string | undefined; ip: string }) {
    const profile = await StudentProfileModel.findOne({ user: userId }).select('verification').lean();
    const key = profile?.verification?.cardKey;
    if (!key) throw notFound('No ID card to show');
    await AdminAuditModel.create({
      admin: audit.admin,
      role: audit.role,
      method: 'POST',
      route: CARD_ROUTE,
      params: { id: userId },
      details: { status: profile.verification.status },
      statusCode: 200,
      ip: audit.ip,
    });
    return {
      bytes: decryptBytes(await r2.getFile(key)),
      mimeType: profile.verification.cardType ?? 'image/jpeg',
    };
  },

  /** Staff decide on a pending ID card. Compare-and-set, so two reviewers can't both decide. */
  async review(userId: string, decision: { status: 'verified' | 'rejected'; reason?: string | undefined }, adminId: string) {
    const now = new Date();
    try {
      const updated = await StudentProfileModel.findOneAndUpdate(
        { user: userId, 'verification.status': 'pending' },
        {
          'verification.status': decision.status,
          'verification.reviewedAt': now,
          'verification.reviewedBy': adminId,
          ...(decision.status === 'verified'
            ? {
                'verification.verifiedAt': now,
                $unset: { 'verification.reason': 1 },
              }
            : { 'verification.reason': decision.reason }),
        },
      );
      if (!updated) {
        if (!(await StudentProfileModel.exists({ user: userId }))) throw notFound('Student not found');
        throw conflict('This student has nothing waiting for review', 'STUDENT_NOT_PENDING');
      }
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('Another account is already verified with this matric number at this school', 'MATRIC_TAKEN');
      throw err;
    }
    bus.emit('student.verified', {
      userId,
      status: decision.status,
      reason: decision.reason,
    });
    return this.detail(userId);
  },
};

/** Staff take a verification back (a fake card found later, say). Only staff can verify them again. */
export async function revokeStudent(userId: string, reason: string, adminId: string) {
  const now = new Date();
  const updated = await StudentProfileModel.findOneAndUpdate(
    { user: userId, 'verification.status': 'verified' },
    {
      'verification.status': 'rejected',
      'verification.reason': reason,
      'verification.reviewedAt': now,
      'verification.reviewedBy': adminId,
      'verification.revokedAt': now,
    },
  );
  if (!updated) {
    if (!(await StudentProfileModel.exists({ user: userId }))) throw notFound('Student not found');
    throw conflict('This student isn’t verified', 'STUDENT_NOT_VERIFIED');
  }
  bus.emit('student.verified', { userId, status: 'rejected', reason });
  return StudentsService.detail(userId);
}

/** For gates that need a verified student and nothing else. */
export async function assertVerifiedStudent(userId: string) {
  const profile = await StudentProfileModel.findOne({ user: userId }).lean();
  if (profile?.verification?.status !== 'verified') throw forbidden('Verify your student profile first');
  return profile;
}
