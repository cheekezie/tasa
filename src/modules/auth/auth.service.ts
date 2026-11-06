import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env';
import type { Contact } from '../../lib/schemas';
import { randomToken, sha256 } from '../../lib/crypto';
import { forbidden, unauthorized } from '../../lib/errors';
import type { Actor } from '../../plugins/auth';
import { AdminModel, type AdminRole } from '../admins/models/admin.model';
import { UserModel } from '../users/models/user.model';
import { UsersService } from '../users/users.service';
import { SessionModel } from './models/session.model';
import { OtpService } from './otp.service';

type ClientMeta = { ip?: string; userAgent?: string };
type Subject = { id: string; actor: Actor; role?: AdminRole };

// Same cost whether or not the account exists, so login timing doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

export function createAuthService(app: FastifyInstance) {
  async function issueTokens(subject: Subject, meta: ClientMeta, family = randomToken(12)) {
    const accessToken = app.jwt.sign({ sub: subject.id, actor: subject.actor, role: subject.role });
    const refreshToken = randomToken();
    await SessionModel.create({
      actor: subject.actor,
      subject: subject.id,
      tokenHash: sha256(refreshToken),
      family,
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });
    return { accessToken, refreshToken };
  }

  return {
    requestOtp: (contact: Contact) => OtpService.send(contact, 'login'),

    /** Signs in, creating the account (and wallet) the first time a phone or email is used. */
    async verifyOtp(contact: Contact, code: string, meta: ClientMeta) {
      await OtpService.verify(contact, code, 'login');
      const { user, isNew } = await UsersService.findOrCreate(contact);
      if (user.status !== 'active') throw forbidden('This account is suspended. Contact support');
      user.lastLoginAt = new Date();
      // Whoever just proved this number may not be its owner: only the PIN can turn this off again.
      user.billPinEnabled = true;
      await user.save();
      const tokens = await issueTokens({ id: user.id, actor: 'user' }, meta);
      return { ...tokens, isNewUser: isNew, user: await UsersService.me(user.id) };
    },

    async adminLogin(email: string, password: string, meta: ClientMeta) {
      const admin = await AdminModel.findOne({ email, isActive: true }).select('+passwordHash');
      const valid = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
      if (!admin || !valid) throw unauthorized('Incorrect email or password');
      admin.lastLoginAt = new Date();
      await admin.save();
      const tokens = await issueTokens({ id: admin.id, actor: 'admin', role: admin.role }, meta);
      return { ...tokens, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } };
    },

    /** Rotates the refresh token. Reuse of a rotated token revokes the whole family. */
    async refresh(refreshToken: string, meta: ClientMeta) {
      const session = await SessionModel.findOne({ tokenHash: sha256(refreshToken) });
      if (!session || session.expiresAt < new Date()) throw unauthorized('Session expired');

      if (session.revokedAt) {
        await SessionModel.updateMany({ family: session.family }, { revokedAt: new Date() });
        throw unauthorized('Session expired');
      }

      let role: AdminRole | undefined;
      if (session.actor === 'admin') {
        const admin = await AdminModel.findOne({ _id: session.subject, isActive: true });
        if (!admin) throw unauthorized('Session expired');
        role = admin.role;
      } else {
        const user = await UserModel.findById(session.subject);
        if (!user || user.status !== 'active') throw unauthorized('Session expired');
      }

      const tokens = await issueTokens({ id: session.subject.toString(), actor: session.actor, role }, meta, session.family);
      session.revokedAt = new Date();
      session.replacedBy = sha256(tokens.refreshToken);
      await session.save();
      return tokens;
    },

    async logout(refreshToken: string | undefined) {
      if (!refreshToken) return;
      const session = await SessionModel.findOne({ tokenHash: sha256(refreshToken) });
      if (session) await SessionModel.updateMany({ family: session.family }, { revokedAt: new Date() });
    },
  };
}
