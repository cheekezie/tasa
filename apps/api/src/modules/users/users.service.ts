import type { Types } from 'mongoose';
import { AdminAuditModel } from '../admins/models/admin-audit.model';
import { SessionModel } from '../auth/models/session.model';
import { BeneficiaryModel } from '../beneficiaries/models/beneficiary.model';
import { CouponModel } from '../coupons/models/coupon.model';
import { RecurringBillModel } from '../recurring/models/recurring-bill.model';
import { EventModel } from '../tickets/models/event.model';
import { TransactionModel } from '../transactions/models/transaction.model';
import { AvatarsService } from './avatars.service';
import { PointsService } from '../points/points.service';
import { PinService } from './pin.service';
import { decrypt, encrypt } from '../../lib/crypto';
import { bus } from '../../lib/events';
import { r2 } from '../../lib/r2';
import { inTransaction, isDuplicateKey } from '../../lib/db';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { newReference } from '../../lib/references';
import type { Contact, Recipient } from '../../lib/schemas';
import { OtpService } from '../auth/otp.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { WalletModel } from '../ledger/models/wallet.model';
import { TRANSFER_MIN } from '../transfers/transfers.schema';
import { UserModel, type IUser } from './models/user.model';
import type { UpdateProfileInput } from './users.schema';

export const maskPhone = (phone: string) => `${phone.slice(0, 7)}****${phone.slice(-3)}`;

const field = (c: Contact) => (c.type === 'phone' ? 'phone' : 'email');

/**
 * What other users may see: "Adaeze O." from the legal name, else @username. Never the
 * phone number or email — a lookup must not turn a username into contact details.
 */
async function forfeitBalance(userId: string, amount: number) {
  await inTransaction(async (session) => {
    const [tx] = await TransactionModel.create(
      [
        {
          reference: newReference('forfeit'),
          user: userId,
          kind: 'balance_forfeited',
          direction: 'debit',
          status: 'success',
          amount,
          fee: 0,
          total: amount,
          completedAt: new Date(),
          events: [{ type: 'success', at: new Date(), note: 'Given up by the user when closing the account' }],
        },
      ],
      { session },
    );
    // Keyed on the user: an account closes once, so a retry can't take the money twice.
    await LedgerService.post(
      {
        key: `forfeit:${userId}`,
        memo: 'Balance forfeited on closing the account',
        transactionId: tx!._id,
        lines: [
          { account: Accounts.wallet(userId), amount },
          { account: Accounts.forfeited, amount: -amount },
        ],
      },
      session,
    );
  });
}

export const REVEAL_ROUTE = '/api/admin/users/:id/bvn/reveal';

export const revokeUserSessions = (userId: string) =>
  SessionModel.updateMany({ actor: 'user', subject: userId, revokedAt: null }, { revokedAt: new Date() });

/**
 * Who a user is, for staff: the full name, not the shortened public one, in one query for a
 * whole page of rows. Ids with no user (deleted) are simply absent.
 */
export async function staffUserLabels(ids: (string | Types.ObjectId | null | undefined)[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const users = unique.length ? await UserModel.find({ _id: { $in: unique } }).select('fullName username phone email').lean() : [];
  return new Map(
    users.map((u) => [
      u._id.toString(),
      { name: u.fullName || (u.username ? `@${u.username}` : (u.phone ?? u.email ?? 'Tasa user')), username: u.username ?? null },
    ]),
  );
}

export function publicName(u: Pick<IUser, 'fullName' | 'username'>) {
  if (u.fullName) {
    const [first, ...rest] = u.fullName.trim().split(/\s+/);
    return rest.length ? `${first} ${rest.map((r) => `${r[0]!.toUpperCase()}.`).join(' ')}` : first!;
  }
  return u.username ? `@${u.username}` : 'Tasa user';
}

export const toPublicUser = (u: IUser) => ({ username: u.username ?? null, name: publicName(u) });

export function toProfile(u: IUser, walletBalance?: number) {
  return {
    id: u._id.toString(),
    phone: u.phone ?? null,
    username: u.username ?? null,
    email: u.email ?? null,
    fullName: u.fullName ?? null,
    avatarUrl: u.avatarKey ? r2.publicUrl(u.avatarKey) : null,
    /** Only the last 4 digits ever leave the server. */
    bvn: u.bvnStatus ? { status: u.bvnStatus, last4: u.bvnLast4 ?? null, rejectionReason: u.bvnRejectionReason ?? null } : null,
    nin: u.ninLast4 ? { last4: u.ninLast4 } : null,
    hasPin: Boolean(u.pinHash),
    billPinEnabled: u.billPinEnabled,
    payday: u.payday,
    notificationPrefs: u.notificationPrefs,
    ...(walletBalance !== undefined && { walletBalance }),
    createdAt: u.createdAt.toISOString(),
  };
}

export const UsersService = {
  /** Creates the user and their wallet the first time a phone or email signs in. */
  async findOrCreate(contact: Contact) {
    const filter = { [field(contact)]: contact.value };
    const existing = await UserModel.findOne(filter);
    if (existing) return { user: existing, isNew: false };
    try {
      const user = await UserModel.create(filter);
      await WalletModel.create({ user: user._id, balance: 0 });
      return { user, isNew: true };
    } catch (err) {
      // Two OTP verifications racing for a brand-new phone/email.
      if (isDuplicateKey(err)) return { user: (await UserModel.findOne(filter))!, isNew: false };
      throw err;
    }
  },

  /** The active Tasa user a username / phone / email belongs to, if any. */
  async resolve(r: Recipient) {
    const filter = r.type === 'username' ? { username: r.value } : { [r.type]: r.value };
    return UserModel.findOne({ ...filter, status: 'active' });
  },

  /**
   * "Is this person on Tasa?" before a transfer or gift. Not found isn't an error: for a
   * phone or email the app can still send a gift, which arrives as an invite.
   */
  async lookup(viewerId: string, r: Recipient) {
    const user = await this.resolve(r);
    if (!user) return { found: false as const, canInvite: r.type !== 'username' };
    return { found: true as const, isSelf: user.id === viewerId, user: toPublicUser(user) };
  },

  /** Step 1 of adding or changing a phone/email: send a code to it. */
  async requestContactCode(userId: string, contact: Contact) {
    await this.assertContactFree(userId, contact);
    return OtpService.send(contact, 'link');
  },

  /** Step 2: the code proves they own it; it replaces any previous phone/email. */
  async verifyContact(userId: string, contact: Contact, code: string) {
    await this.assertContactFree(userId, contact);
    await OtpService.verify(contact, code, 'link');
    try {
      await UserModel.updateOne({ _id: userId }, { [field(contact)]: contact.value });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict(`That ${contact.type} belongs to another Tasa account`, 'CONTACT_TAKEN');
      throw err;
    }
    return this.me(userId);
  },

  async assertContactFree(userId: string, contact: Contact) {
    const owner = await UserModel.findOne({ [field(contact)]: contact.value }).select('_id');
    if (owner && owner._id.toString() !== userId) {
      throw conflict(`That ${contact.type} belongs to another Tasa account`, 'CONTACT_TAKEN');
    }
  },

  async me(userId: string) {
    const user = await UserModel.findById(userId).select('+pinHash');
    if (!user) throw notFound('Account not found');
    const wallet = await WalletModel.findOne({ user: userId });
    return toProfile(user, wallet?.balance ?? 0);
  },

  async isUsernameAvailable(username: string, userId: string) {
    const owner = await UserModel.findOne({ username }).select('_id');
    return !owner || owner._id.toString() === userId;
  },

  async update(userId: string, changes: UpdateProfileInput) {
    const user = await UserModel.findById(userId).select('+pinHash');
    if (!user) throw notFound('Account not found');
    if (changes.fullName && user.bvnStatus === 'verified') {
      throw unprocessable('Your name comes from your BVN and cannot be changed', 'NAME_LOCKED');
    }
    const { notificationPrefs, ...rest } = changes;
    Object.assign(user, rest);
    if (notificationPrefs) user.notificationPrefs = { ...user.notificationPrefs, ...notificationPrefs };
    try {
      await user.save();
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('That username is taken', 'USERNAME_TAKEN');
      throw err;
    }
    return toProfile(user);
  },

  /**
   * Stores the BVN encrypted; only the last 4 digits are readable. Verification against
   * NIBSS (which also fills fullName) is not wired yet — there's no BVN provider chosen.
   */
  async setBvn(userId: string, bvn: string) {
    const user = await UserModel.findById(userId).select('+pinHash');
    if (!user) throw notFound('Account not found');
    // Pending or verified. A rejected BVN is erased, so the user can send a corrected one.
    if (user.bvnLast4) throw conflict('Your BVN is already on file', 'BVN_LOCKED');
    user.bvnCipher = encrypt(bvn);
    user.bvnLast4 = bvn.slice(-4);
    user.bvnStatus = 'pending';
    user.bvnRejectionReason = undefined;
    await user.save();
    return toProfile(user);
  },

  /** Like the BVN: encrypted, and only the last 4 digits are readable. */
  async setNin(userId: string, nin: string) {
    const user = await UserModel.findById(userId).select('+ninCipher');
    if (!user) throw notFound('User not found');
    if (user.ninLast4) throw conflict('Your NIN is already on file', 'NIN_LOCKED');
    user.ninCipher = encrypt(nin);
    user.ninLast4 = nin.slice(-4);
    await user.save();
    return toProfile(user);
  },

  /**
   * The one place a full BVN leaves the server. Pending only, so nobody can browse decided
   * BVNs, and it refuses unless the access is on record first: a BVN seen but not logged is
   * worse than a review that has to be retried.
   */
  async revealBvn(userId: string, audit: { admin: string; role?: string | undefined; ip: string; reason: string }) {
    const user = await UserModel.findOne({ _id: userId, bvnStatus: 'pending' }).select('+bvnCipher');
    if (!user?.bvnCipher) throw conflict('This BVN is not waiting for review', 'BVN_NOT_PENDING');
    await AdminAuditModel.create({
      admin: audit.admin,
      role: audit.role,
      method: 'POST',
      route: REVEAL_ROUTE,
      params: { id: userId },
      details: { reason: audit.reason },
      statusCode: 200,
      ip: audit.ip,
    });
    return { bvn: decrypt(user.bvnCipher) };
  },

  /** An admin's decision on a pending BVN. Compare-and-set, so two reviewers can't both decide. */
  async reviewBvn(userId: string, review: { status: 'verified' | 'rejected'; fullName?: string | undefined; reason?: string | undefined }) {
    const change =
      review.status === 'verified'
        ? { $set: { bvnStatus: 'verified', ...(review.fullName && { fullName: review.fullName }) } }
        : { $set: { bvnStatus: 'rejected', bvnRejectionReason: review.reason }, $unset: { bvnCipher: 1, bvnLast4: 1 } };
    const user = await UserModel.findOneAndUpdate({ _id: userId, bvnStatus: 'pending' }, change, { new: true });
    if (!user) throw conflict('This BVN is not waiting for review', 'BVN_NOT_PENDING');
    bus.emit('bvn.reviewed', { userId, status: review.status, reason: review.reason });
    return { ...toProfile(user), status: user.status };
  },

  /** Suspending ends every session now, rather than when the access token runs out. */
  async setStatus(userId: string, status: 'active' | 'suspended') {
    const user = await UserModel.findById(userId);
    if (!user) throw notFound('User not found');
    if (user.status === 'closed') throw conflict('This account is closed', 'ACCOUNT_CLOSED');
    user.status = status;
    await user.save();
    if (status === 'suspended') await revokeUserSessions(userId);
    return { id: userId, status };
  },

  /**
   * Closes the account for good: personal details go, financial records stay for the
   * regulator. Money must be moved out first, except a balance too small to transfer, which
   * the user can give up by confirming the exact amount.
   */
  async close(userId: string, pin: string, forfeitAmount?: number) {
    await PinService.verify(userId, pin);
    const [wallet, pending, coupons, ticketSales, events] = await Promise.all([
      WalletModel.findOne({ user: userId }),
      TransactionModel.exists({ user: userId, status: 'pending' }),
      CouponModel.exists({ owner: userId, status: { $in: ['active', 'paused'] } }),
      LedgerService.balance(Accounts.ticketWallet(userId)),
      EventModel.exists({ owner: userId, startsAt: { $gt: new Date() } }),
    ]);
    const balance = wallet?.balance ?? 0;
    if (balance >= TRANSFER_MIN) throw unprocessable('Spend or transfer your wallet balance before closing your account', 'ACCOUNT_HAS_BALANCE');
    if (pending) throw unprocessable('Wait for your pending payments to finish before closing your account', 'ACCOUNT_HAS_PENDING');
    if (coupons) throw unprocessable('Cancel your active giveaways before closing your account', 'ACCOUNT_HAS_COUPONS');
    if (ticketSales !== 0) throw unprocessable('Withdraw your ticket sales before closing your account', 'ACCOUNT_HAS_TICKET_SALES');
    if (events) throw unprocessable('You have an upcoming event, so this account has to stay open until it ends', 'ACCOUNT_HAS_EVENTS');
    if (balance !== (forfeitAmount ?? 0)) {
      throw new AppError(422, 'Your wallet balance has changed. Check it and try again', 'ACCOUNT_BALANCE_CHANGED', { balance: String(balance) });
    }
    if (balance > 0) await forfeitBalance(userId, balance);
    await PointsService.forfeitAll(userId);

    const { avatarKey } = (await UserModel.findById(userId).select('avatarKey')) ?? {};
    if (avatarKey) await AvatarsService.purge(avatarKey);
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: { status: 'closed', closedAt: new Date(), pushTokens: [] },
        $unset: { phone: 1, email: 1, username: 1, fullName: 1, bvnCipher: 1, bvnLast4: 1, bvnStatus: 1, bvnRejectionReason: 1, ninCipher: 1, ninLast4: 1, pinHash: 1, avatarKey: 1 },
      },
    );
    await Promise.all([
      RecurringBillModel.updateMany({ user: userId, active: true }, { active: false }),
      BeneficiaryModel.updateMany({ user: userId, archivedAt: null }, { autoPay: false, archivedAt: new Date() }),
      revokeUserSessions(userId),
    ]);
    return { closed: true };
  },

  async addPushToken(userId: string, token: string) {
    // A device belongs to one account at a time.
    await UserModel.updateMany({ pushTokens: token, _id: { $ne: userId } }, { $pull: { pushTokens: token } });
    await UserModel.updateOne({ _id: userId }, { $addToSet: { pushTokens: token } });
  },

  async removePushToken(userId: string, token: string) {
    await UserModel.updateOne({ _id: userId }, { $pull: { pushTokens: token } });
  },
};
