import type { FilterQuery, Types } from 'mongoose';
import { decryptBytes, encryptBytes } from '../../lib/crypto';
import { inTransaction } from '../../lib/db';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { r2 } from '../../lib/r2';
import { paginate } from '../../lib/response';
import { adminNames } from '../admins/admins.service';
import { AdminAuditModel } from '../admins/models/admin-audit.model';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { UserModel } from '../users/models/user.model';
import { AvatarsService, AVATAR_MAX_BYTES, sniffImage } from '../users/avatars.service';
import { staffUserLabels } from '../users/users.service';
import { EventModel } from './models/event.model';
import { SellerModel, type ISeller, type SellerIdType, type SellerVerificationStatus } from './models/ticket.model';

/** The route a document view is logged under, so the audit trail reads like any other admin action. */
export const DOCUMENT_ROUTE = '/api/admin/sellers/:id/documents/:kind';

export type SellerDocument = 'photo' | 'id';

/** How a seller's verification reads to them and to staff. No files, no keys: those never leave the server. */
export function verificationDto(s: Pick<ISeller, 'verification'> | null | undefined) {
  const v = s?.verification;
  return {
    status: (v?.status ?? 'unsubmitted') as SellerVerificationStatus | 'unsubmitted',
    idType: v?.idType ?? null,
    submittedAt: v?.submittedAt?.toISOString() ?? null,
    reviewedAt: v?.reviewedAt?.toISOString() ?? null,
    reason: v?.status === 'rejected' ? (v.reason ?? null) : null,
  };
}

export function suspensionDto(s: Pick<ISeller, 'suspension'> | null | undefined) {
  const x = s?.suspension;
  return { active: x?.active ?? false, reason: x?.active ? (x.reason ?? null) : null, at: x?.active ? (x.at?.toISOString() ?? null) : null };
}

/** For gates elsewhere: why this seller can't run events right now, or null if they can. */
export function sellingBlock(s: Pick<ISeller, 'verification' | 'suspension'>) {
  if (s.suspension?.active) return forbidden('Your selling account is suspended. Contact Tasa support.');
  const status = s.verification?.status;
  if (status === 'approved') return null;
  if (status === 'pending') return unprocessable("We're still checking your details. You can create events once you're approved.", 'SELLER_NOT_VERIFIED');
  if (status === 'rejected') return unprocessable('Your details were not approved. Send them again to create events.', 'SELLER_NOT_VERIFIED');
  return unprocessable('Send a photo of yourself and your ID to create events.', 'SELLER_NOT_VERIFIED');
}

/** The bytes decide, as with every upload; a document is a photo, not a PDF, so staff can see it in place. */
function checkImage(buffer: Buffer, what: string) {
  if (buffer.length > AVATAR_MAX_BYTES) throw unprocessable(`Use a ${what} under 5MB`, 'PHOTO_TOO_LARGE');
  const image = sniffImage(buffer);
  if (!image) throw unprocessable(`Use a JPEG, PNG or WebP image for your ${what}`, 'PHOTO_INVALID');
  return image;
}

async function storePrivately(userId: string, buffer: Buffer) {
  const { key } = await r2.uploadFile(encryptBytes(buffer), 'bin', 'application/octet-stream', `kyc/${userId}`);
  return key;
}

export const SellerReviewService = {
  /**
   * A seller sends who they are. Replaces anything pending or rejected; once approved it's
   * settled, so nobody swaps their ID after the fact. What it replaces goes to the history,
   * files and all, so compliance can set the new documents beside the rejected ones.
   */
  async submit(userId: string, { idType, photo, id }: { idType: SellerIdType; photo: Buffer; id: Buffer }) {
    const seller = await SellerModel.findOne({ user: userId });
    if (!seller) throw forbidden('Opt in to selling tickets first');
    if (seller.suspension?.active) throw forbidden('Your selling account is suspended. Contact Tasa support.');
    if (seller.verification?.status === 'approved') throw conflict("You're already verified", 'SELLER_ALREADY_VERIFIED');
    const photoImage = checkImage(photo, 'photo');
    const idImage = checkImage(id, 'ID');

    const [photoKey, idKey] = await Promise.all([storePrivately(userId, photo), storePrivately(userId, id)]);
    const previous = seller.verification?.status ? seller.toObject().verification : undefined;
    // Compare-and-set on what we read, so a review landing meanwhile isn't overwritten.
    const updated = await SellerModel.findOneAndUpdate(
      { _id: seller._id, 'verification.status': previous?.status ?? { $exists: false } },
      {
        verification: {
          status: 'pending',
          idType,
          photoKey,
          photoType: photoImage.mimeType,
          idKey,
          idMimeType: idImage.mimeType,
          submittedAt: new Date(),
        },
        ...(previous && { $push: { verificationHistory: previous } }),
      },
      { new: true },
    );
    if (!updated) {
      await Promise.all([AvatarsService.purge(photoKey), AvatarsService.purge(idKey)]);
      throw conflict('Your details were just reviewed. Check your selling page.', 'SELLER_REVIEW_CHANGED');
    }
    return verificationDto(updated);
  },

  // ── Back office ────────────────────────────────────────────────────────
  async list(q: { verification?: SellerVerificationStatus | 'unsubmitted'; suspended?: boolean; search?: string; page: number; limit: number }) {
    const filter: FilterQuery<ISeller> = {};
    if (q.verification === 'unsubmitted') filter['verification.status'] = { $exists: false };
    else if (q.verification) filter['verification.status'] = q.verification;
    if (q.suspended !== undefined) filter['suspension.active'] = q.suspended ? true : { $ne: true };
    if (q.search) {
      const pattern = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await UserModel.find({ $or: [{ fullName: pattern }, { username: pattern }, { phone: pattern }, { email: pattern }] })
        .select('_id')
        .limit(200)
        .lean();
      filter.$or = [{ organisation: pattern }, { user: { $in: users.map((u) => u._id) } }];
    }
    // The review queue reads oldest first; everything else newest first.
    const sort: Record<string, 1 | -1> = q.verification === 'pending' ? { 'verification.submittedAt': 1 } : { createdAt: -1 };
    const [items, total] = await Promise.all([
      SellerModel.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      SellerModel.countDocuments(filter),
    ]);
    const names = await staffUserLabels(items.map((s) => s.user));
    const events = await EventModel.aggregate<{ _id: Types.ObjectId; events: number }>([
      { $match: { owner: { $in: items.map((s) => s.user) } } },
      { $group: { _id: '$owner', events: { $sum: 1 } } },
    ]);
    const eventCounts = new Map(events.map((e) => [e._id.toString(), e.events]));
    return paginate(
      items.map((s) => ({
        id: s.user.toString(),
        name: names.get(s.user.toString())?.name ?? null,
        username: names.get(s.user.toString())?.username ?? null,
        organisation: s.organisation ?? null,
        logoUrl: s.logoKey ? r2.publicUrl(s.logoKey) : null,
        verification: verificationDto(s),
        suspension: suspensionDto(s),
        events: eventCounts.get(s.user.toString()) ?? 0,
        since: s.createdAt.toISOString(),
      })),
      total,
      q.page,
      q.limit,
    );
  },

  /** Everything compliance needs to decide, except the documents themselves (see `document`). */
  async detail(userId: string) {
    const seller = await SellerModel.findOne({ user: userId }).lean();
    if (!seller) throw notFound('Organiser not found');
    const [user, balance, staff] = await Promise.all([
      UserModel.findById(userId).select('fullName username phone email avatarKey bvnLast4 ninLast4 bvnStatus status createdAt').lean(),
      LedgerService.balance(Accounts.ticketWallet(userId)),
      adminNames([
        seller.verification?.reviewedBy,
        ...(seller.verificationHistory ?? []).map((h) => h.reviewedBy),
        seller.suspension?.by, ...(seller.suspensionHistory ?? []).map((h) => h.by)]),
    ]);
    return {
      id: userId,
      organisation: seller.organisation ?? null,
      logoUrl: seller.logoKey ? r2.publicUrl(seller.logoKey) : null,
      about: seller.about ?? null,
      contact: seller.contact ?? {},
      user: user && {
        name: user.fullName ?? null,
        username: user.username ?? null,
        phone: user.phone ?? null,
        email: user.email ?? null,
        /** Their own profile photo; the organisation's logo is `logoUrl`. */
        avatarUrl: user.avatarKey ? r2.publicUrl(user.avatarKey) : null,
        /** Last four only, as everywhere outside the BVN reveal. */
        bvnLast4: user.bvnLast4 ?? null,
        bvnStatus: user.bvnStatus ?? null,
        ninLast4: user.ninLast4 ?? null,
        status: user.status,
        joinedAt: user.createdAt.toISOString(),
      },
      verification: {
        ...verificationDto(seller),
        reviewedBy: seller.verification?.reviewedBy ? (staff.get(seller.verification.reviewedBy.toString()) ?? null) : null,
        hasDocuments: Boolean(seller.verification?.photoKey && seller.verification.idKey),
        /** What they sent before, newest first. Open one with `document(…, submission)`. */
        history: [...(seller.verificationHistory ?? [])].reverse().map((h) => ({
          id: h._id.toString(),
          /** `pending`: they replaced it before anyone reviewed it. */
          status: h.status,
          idType: h.idType,
          submittedAt: h.submittedAt.toISOString(),
          reviewedAt: h.reviewedAt?.toISOString() ?? null,
          reviewedBy: h.reviewedBy ? (staff.get(h.reviewedBy.toString()) ?? null) : null,
          reason: h.reason ?? null,
          hasDocuments: Boolean(h.photoKey && h.idKey),
        })),
      },
      suspension: {
        ...suspensionDto(seller),
        by: seller.suspension?.active && seller.suspension.by ? (staff.get(seller.suspension.by.toString()) ?? null) : null,
        liftedAt: seller.suspension?.liftedAt?.toISOString() ?? null,
        /** Newest first. Suspensions from before history was kept aren't in it. */
        history: [...(seller.suspensionHistory ?? [])].reverse().map((h) => ({
          action: h.action,
          reason: h.reason ?? null,
          by: staff.get(h.by.toString()) ?? null,
          at: h.at.toISOString(),
        })),
      },
      bankAccount: seller.bankAccount?.accountNumber ? seller.bankAccount : null,
      /** Kobo in their ticket wallet. */
      ticketBalance: balance === 0 ? 0 : -balance,
      termsAccepted: seller.termsVersion ?? null,
      since: seller.createdAt.toISOString(),
    };
  },

  /**
   * One document, decrypted for a compliance officer: from the current submission, or from an
   * earlier one when `submission` names it. Logged before decrypting, like the BVN reveal: if
   * the log can't be written, nobody sees the file.
   */
  async document(
    userId: string,
    kind: SellerDocument,
    audit: { admin: string; role?: string | undefined; ip: string },
    submission?: string,
  ) {
    const seller = await SellerModel.findOne({ user: userId }).select('verification verificationHistory').lean();
    const v = submission ? seller?.verificationHistory?.find((h) => h._id.toString() === submission) : seller?.verification;
    const key = kind === 'photo' ? v?.photoKey : v?.idKey;
    if (!v || !key) throw notFound('No document to show');
    await AdminAuditModel.create({
      admin: audit.admin,
      role: audit.role,
      method: 'POST',
      route: DOCUMENT_ROUTE,
      params: { id: userId, kind, ...(submission && { submission }) },
      details: { status: v.status },
      statusCode: 200,
      ip: audit.ip,
    });
    return { bytes: decryptBytes(await r2.getFile(key)), mimeType: kind === 'photo' ? v.photoType : v.idMimeType };
  },

  /** Compliance's decision on what's pending. Compare-and-set, so two reviewers can't both decide. */
  async review(userId: string, decision: { status: 'approved' | 'rejected'; reason?: string | undefined }, adminId: string) {
    const updated = await SellerModel.findOneAndUpdate(
      { user: userId, 'verification.status': 'pending' },
      {
        'verification.status': decision.status,
        'verification.reviewedAt': new Date(),
        'verification.reviewedBy': adminId,
        ...(decision.status === 'rejected' ? { 'verification.reason': decision.reason } : { $unset: { 'verification.reason': 1 } }),
      },
      { new: true },
    );
    if (!updated) {
      if (!(await SellerModel.exists({ user: userId }))) throw notFound('Organiser not found');
      throw conflict('This organiser has nothing waiting for review', 'SELLER_NOT_PENDING');
    }
    bus.emit('seller.reviewed', { userId, status: decision.status, reason: decision.reason });
    return this.detail(userId);
  },

  /**
   * Stops (or lets again) someone organising. Suspending pauses every event still selling, as
   * Tasa, and remembers which; lifting it resumes exactly those. Tickets already sold stay
   * valid, buyers can still refund, and the door can still scan.
   */
  async setSuspension(userId: string, change: { suspended: boolean; reason?: string | undefined }, adminId: string) {
    const seller = await SellerModel.findOne({ user: userId });
    if (!seller) throw notFound('Organiser not found');
    if (Boolean(seller.suspension?.active) === change.suspended) {
      throw conflict(change.suspended ? 'This organiser is already suspended' : "This organiser isn't suspended", 'SUSPENSION_UNCHANGED');
    }
    await inTransaction(async (session) => {
      const at = new Date();
      if (change.suspended) {
        await SellerModel.updateOne(
          { _id: seller._id },
          {
            suspension: { active: true, reason: change.reason, at, by: adminId },
            $push: { suspensionHistory: { action: 'suspended', reason: change.reason, by: adminId, at } },
          },
          { session },
        );
        await EventModel.updateMany({ owner: userId, adminPaused: false }, { adminPaused: true, pausedBySuspension: true }, { session });
      } else {
        await SellerModel.updateOne(
          { _id: seller._id },
          {
            'suspension.active': false,
            'suspension.liftedAt': at,
            $push: { suspensionHistory: { action: 'lifted', reason: change.reason, by: adminId, at } },
          },
          { session },
        );
        await EventModel.updateMany({ owner: userId, pausedBySuspension: true }, { adminPaused: false, $unset: { pausedBySuspension: 1 } }, { session });
      }
    });
    bus.emit('seller.suspension', { userId, suspended: change.suspended, reason: change.reason });
    return this.detail(userId);
  },
};
