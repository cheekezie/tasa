import type { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { isDuplicateKey } from '../../lib/db';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { SessionModel } from '../auth/models/session.model';
import { AdminModel, type AdminRole, type IAdmin } from './models/admin.model';

const toDto = (a: IAdmin) => ({
  id: a._id.toString(),
  name: a.name,
  email: a.email,
  role: a.role,
  isActive: a.isActive,
  lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

const signOutEverywhere = (adminId: string) =>
  SessionModel.updateMany({ actor: 'admin', subject: adminId, revokedAt: null }, { revokedAt: new Date() });

/** Staff names by id, for back-office rows that record who acted. */
export async function adminNames(ids: (string | Types.ObjectId | null | undefined)[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const admins = unique.length ? await AdminModel.find({ _id: { $in: unique } }).select('name').lean() : [];
  return new Map(admins.map((a) => [a._id.toString(), a.name]));
}

export const AdminsService = {
  async me(id: string) {
    const a = await AdminModel.findById(id);
    if (!a) throw notFound('Admin not found');
    return toDto(a);
  },

  async list() {
    return (await AdminModel.find().sort({ createdAt: 1 })).map(toDto);
  },

  async create(input: { name: string; email: string; role: AdminRole; password: string }) {
    try {
      const a = await AdminModel.create({ ...input, passwordHash: await bcrypt.hash(input.password, 12) });
      return toDto(a);
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('An admin with that email already exists', 'EMAIL_TAKEN');
      throw err;
    }
  },

  async update(actorId: string, id: string, changes: { name?: string; role?: AdminRole; isActive?: boolean }) {
    if (actorId === id && (changes.role || changes.isActive === false)) {
      throw forbidden("You can't change your own role or deactivate yourself");
    }
    const a = await AdminModel.findById(id);
    if (!a) throw notFound('Admin not found');
    // Never leave the platform without someone who can manage staff.
    if (a.role === 'super_admin' && (changes.role && changes.role !== 'super_admin' || changes.isActive === false)) {
      const others = await AdminModel.countDocuments({ _id: { $ne: a._id }, role: 'super_admin', isActive: true });
      if (others === 0) throw unprocessable('This is the last active super admin', 'LAST_SUPER_ADMIN');
    }
    Object.assign(a, changes);
    await a.save();
    if (changes.isActive === false) await signOutEverywhere(id);
    return toDto(a);
  },

  async changePassword(id: string, current: string, next: string) {
    const a = await AdminModel.findById(id).select('+passwordHash');
    // A form error, not a 401: to every client a 401 means the session is gone.
    if (!a || !(await bcrypt.compare(current, a.passwordHash))) throw unprocessable('Current password is incorrect', 'PASSWORD_INCORRECT');
    a.passwordHash = await bcrypt.hash(next, 12);
    await a.save();
    await signOutEverywhere(id);
  },

  /** Super admins reset a colleague's password; it signs them out everywhere. */
  async resetPassword(id: string, next: string) {
    const a = await AdminModel.findById(id).select('+passwordHash');
    if (!a) throw notFound('Admin not found');
    a.passwordHash = await bcrypt.hash(next, 12);
    await a.save();
    await signOutEverywhere(id);
  },
};
