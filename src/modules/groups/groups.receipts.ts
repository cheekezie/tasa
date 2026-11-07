import { env } from '../../config/env';
import { hmac512, safeEqual } from '../../lib/crypto';
import { notFound } from '../../lib/errors';
import { r2 } from '../../lib/r2';
import { TransactionModel, type ITransaction } from '../transactions/models/transaction.model';
import { UserModel } from '../users/models/user.model';
import { periodStart } from './groups.periods';
import { GroupMemberModel, GroupModel, type IGroup, type IGroupMember } from './models/group.model';

/**
 * Dues receipts anyone can check: a department's clearance desk scans the QR on a student's
 * receipt and the website shows what Tasa holds for it, no sign-in. The code is the reference
 * plus a signature, so nobody can guess another student's receipt from theirs.
 */
const signature = (reference: string) => hmac512(env.ENCRYPTION_KEY, `receipt:${reference}`).slice(0, 16);

export const receiptCode = (reference: string) => `${reference}-${signature(reference)}`;
export const receiptUrl = (reference: string) => `${env.SITE_URL.replace(/\/$/, '')}/r/${receiptCode(reference)}`;

/** The reference, if the code is one we signed. */
function referenceOf(code: string) {
  const at = code.lastIndexOf('-');
  if (at < 1) return null;
  const reference = code.slice(0, at);
  return safeEqual(code.slice(at + 1).toLowerCase(), signature(reference)) ? reference : null;
}

type Member = Pick<IGroupMember, 'startsAt' | 'anchorDay'>;

/** Each due paid, with the dates of every period: what "paid" covered. A one-off has no dates. */
function duesPaid(tx: Pick<ITransaction, 'group'>, group: Pick<IGroup, 'dues'> | null, member: Member | null) {
  return (tx.group?.dues ?? []).map((d) => {
    const due = group?.dues.find((x) => x._id.equals(d.id));
    const recurring = due?.kind === 'recurring' && member;
    return {
      name: d.name,
      kind: due?.kind ?? null,
      period: due?.period ?? null,
      periods: d.periods.map((k) =>
        recurring
          ? {
              index: k,
              start: periodStart(member.startsAt, due.period!, member.anchorDay, k).toISOString(),
              end: periodStart(member.startsAt, due.period!, member.anchorDay, k + 1).toISOString(),
            }
          : { index: k, start: null, end: null },
      ),
    };
  });
}

export const ReceiptsService = {
  /** Their dues payments to one group, newest first, each with the link its QR code opens. */
  async mine(groupId: string, userId: string) {
    const [group, member] = await Promise.all([
      GroupModel.findById(groupId).select('dues').lean(),
      GroupMemberModel.findOne({ group: groupId, user: userId }).select('startsAt anchorDay').lean(),
    ]);
    if (!group || !member) throw notFound('You’re not in this group');
    const txs = await TransactionModel.find({
      user: userId,
      kind: 'group_dues',
      'group.id': group._id,
      status: 'success',
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return txs.map((tx) => ({
      id: tx._id.toString(),
      reference: tx.reference,
      /** Kobo that went to the group's dues (charges not included). */
      amount: tx.amount,
      paidAt: (tx.completedAt ?? tx.createdAt).toISOString(),
      dues: duesPaid(tx, group, member),
      code: receiptCode(tx.reference),
      url: receiptUrl(tx.reference),
    }));
  },

  /**
   * What the QR code proves, for anyone holding it: who paid which dues to which group.
   * Nothing else about them or the group.
   */
  async verify(code: string) {
    const reference = referenceOf(code.trim());
    const tx = reference
      ? await TransactionModel.findOne({
          reference,
          kind: 'group_dues',
          status: 'success',
        }).lean()
      : null;
    if (!tx?.group?.id) throw notFound('This receipt isn’t one of ours. Ask the student to show it in the Tasa app.');
    const [group, member, user] = await Promise.all([
      GroupModel.findById(tx.group.id).select('name logoKey dues').lean(),
      GroupMemberModel.findOne({ group: tx.group.id, user: tx.user }).select('startsAt anchorDay fields status').lean(),
      UserModel.findById(tx.user).select('fullName username').lean(),
    ]);
    const fields = (member?.fields ?? {}) as Record<string, string>;
    return {
      reference: tx.reference,
      paidAt: (tx.completedAt ?? tx.createdAt).toISOString(),
      /** Kobo. */
      amount: tx.amount,
      payer: {
        name: user?.fullName ?? (user?.username ? `@${user.username}` : null),
        matricNumber: fields.matric_number ?? null,
        department: fields.department ?? null,
      },
      group: {
        name: group?.name ?? tx.group.name ?? 'A Tasa group',
        logoUrl: group?.logoKey ? r2.publicUrl(group.logoKey) : null,
      },
      dues: duesPaid(tx, group, member),
    };
  },
};
