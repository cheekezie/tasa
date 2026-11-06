import type { FilterQuery, Types } from 'mongoose';
import { conflict, notFound } from '../../lib/errors';
import { bus } from '../../lib/events';
import { paginate } from '../../lib/response';
import { adminNames } from '../admins/admins.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { TransactionModel } from '../transactions/models/transaction.model';
import { UserModel } from '../users/models/user.model';
import { staffUserLabels } from '../users/users.service';
import { GroupMemberModel, GroupModel, GroupPayoutChangeModel, type IGroup } from './models/group.model';

const balanceOf = async (id: Types.ObjectId | string) => {
  const raw = await LedgerService.balance(Accounts.group(id));
  return raw === 0 ? 0 : -raw;
};

const ownerOf = (g: Pick<IGroup, 'executives'>) => g.executives.find((e) => e.role === 'owner')!.user;

/** Groups for the back office: who runs them, what they hold, and Tela's power to stop them. */
export const GroupsAdminService = {
  async list(q: { suspended?: boolean | undefined; search?: string | undefined; page: number; limit: number }) {
    const filter: FilterQuery<IGroup> = {};
    if (q.suspended !== undefined) filter['suspended.at'] = q.suspended ? { $exists: true } : { $exists: false };
    if (q.search) {
      const pattern = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await UserModel.find({ $or: [{ fullName: pattern }, { username: pattern }, { phone: pattern }] }).select('_id').limit(200).lean();
      filter.$or = [{ name: pattern }, { inviteCode: q.search.toUpperCase() }, { 'executives.user': { $in: users.map((u) => u._id) } }];
    }
    const [items, total] = await Promise.all([
      GroupModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      GroupModel.countDocuments(filter),
    ]);
    const [owners, counts, balances] = await Promise.all([
      staffUserLabels(items.map(ownerOf)),
      GroupMemberModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { group: { $in: items.map((g) => g._id) }, status: 'active' } },
        { $group: { _id: '$group', n: { $sum: 1 } } },
      ]),
      Promise.all(items.map((g) => balanceOf(g._id))),
    ]);
    return paginate(
      items.map((g, i) => ({
        id: g._id.toString(),
        name: g.name,
        owner: owners.get(ownerOf(g).toString()) ?? null,
        members: counts.find((c) => c._id.equals(g._id))?.n ?? 0,
        /** Kobo held. */
        balance: balances[i]!,
        status: g.status,
        suspended: Boolean(g.suspended?.at),
        createdAt: g.createdAt.toISOString(),
      })),
      total,
      q.page,
      q.limit,
    );
  },

  async detail(id: string) {
    const group = await GroupModel.findById(id).lean();
    if (!group) throw notFound('Group not found');
    const [people, members, balance, collected, withdrawals, changes] = await Promise.all([
      staffUserLabels(group.executives.map((e) => e.user)),
      GroupMemberModel.aggregate<{ _id: string; n: number }>([{ $match: { group: group._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      balanceOf(group._id),
      TransactionModel.aggregate<{ amount: number; n: number }>([
        { $match: { kind: 'group_dues', 'group.id': group._id, status: 'success' } },
        { $group: { _id: null, amount: { $sum: '$amount' }, n: { $sum: 1 } } },
      ]),
      TransactionModel.find({ kind: 'group_payout', 'group.id': group._id }).sort({ createdAt: -1 }).limit(20).lean(),
      GroupPayoutChangeModel.find({ group: group._id }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    const changePeople = await staffUserLabels(changes.flatMap((c) => [c.proposedBy, ...c.cosigners.map((x) => x.user), c.closedBy]));
    const withdrawers = await staffUserLabels(withdrawals.map((w) => w.user));
    const staff = await adminNames([group.suspended?.by, ...(group.suspensionHistory ?? []).map((h) => h.by)]);
    const count = (status: string) => members.find((m) => m._id === status)?.n ?? 0;
    const name = (map: Map<string, { name: string | null; username: string | null }>, uid?: Types.ObjectId | null) =>
      uid ? (map.get(uid.toString())?.name ?? map.get(uid.toString())?.username ?? null) : null;

    return {
      id: group._id.toString(),
      name: group.name,
      about: group.about ?? null,
      inviteCode: group.inviteCode,
      requireApproval: group.requireApproval,
      dues: group.dues.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        kind: d.kind,
        period: d.period ?? null,
        amount: d.amount,
        compulsory: d.compulsory,
        dueAt: d.dueAt?.toISOString() ?? null,
        endedAt: d.endedAt?.toISOString() ?? null,
      })),
      fields: group.fields,
      payout: group.payout,
      termsVersion: group.termsVersion,
      executives: group.executives.map((e) => ({ id: e.user.toString(), role: e.role, ...people.get(e.user.toString()), addedAt: e.addedAt.toISOString() })),
      members: { active: count('active'), pending: count('pending'), removed: count('removed') },
      /** Kobo. */
      balance,
      collected: { amount: collected[0]?.amount ?? 0, payments: collected[0]?.n ?? 0 },
      withdrawals: withdrawals.map((w) => ({
        id: w._id.toString(),
        reference: w.reference,
        status: w.status,
        amount: w.amount,
        fee: w.fee,
        to: w.payout ?? null,
        by: name(withdrawers, w.user),
        at: w.createdAt.toISOString(),
      })),
      payoutChanges: changes.map((c) => ({
        id: c._id.toString(),
        status: c.status,
        from: c.from,
        to: c.to,
        proposedBy: name(changePeople, c.proposedBy),
        cosigners: c.cosigners.map((x) => ({ name: name(changePeople, x.user), approvedAt: x.approvedAt?.toISOString() ?? null })),
        effectiveAt: c.effectiveAt?.toISOString() ?? null,
        closedBy: name(changePeople, c.closedBy),
        closedReason: c.closedReason ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      status: group.status,
      suspension: {
        active: Boolean(group.suspended?.at),
        reason: group.suspended?.at ? (group.suspended.reason ?? null) : null,
        at: group.suspended?.at?.toISOString() ?? null,
        by: group.suspended?.by ? (staff.get(group.suspended.by.toString()) ?? null) : null,
        /** Newest first. */
        history: [...(group.suspensionHistory ?? [])].reverse().map((h) => ({
          action: h.action,
          reason: h.reason ?? null,
          by: staff.get(h.by.toString()) ?? null,
          at: h.at.toISOString(),
        })),
      },
      createdAt: group.createdAt.toISOString(),
    };
  },

  /**
   * Stops a group joining, paying dues, withdrawing and changing its payout account; lifting it
   * lets them again. Money already held stays the group's. Compare-and-set, so two staff can't both act.
   */
  async setSuspension(id: string, change: { suspended: boolean; reason?: string | undefined }, adminId: string) {
    const at = new Date();
    const updated = await GroupModel.findOneAndUpdate(
      { _id: id, 'suspended.at': change.suspended ? { $exists: false } : { $exists: true } },
      change.suspended
        ? { suspended: { at, reason: change.reason, by: adminId }, $push: { suspensionHistory: { action: 'suspended', reason: change.reason, by: adminId, at } } }
        : { $unset: { suspended: 1 }, $push: { suspensionHistory: { action: 'lifted', reason: change.reason, by: adminId, at } } },
    );
    if (!updated) {
      if (!(await GroupModel.exists({ _id: id }))) throw notFound('Group not found');
      throw conflict(change.suspended ? 'This group is already suspended' : "This group isn't suspended", 'SUSPENSION_UNCHANGED');
    }
    bus.emit('group.suspension', { groupId: id, suspended: change.suspended, reason: change.reason });
    return this.detail(id);
  },
};
