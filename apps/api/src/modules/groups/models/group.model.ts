import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const GROUP_PERIODS = ['weekly', 'monthly', 'yearly'] as const;
export type GroupPeriod = (typeof GROUP_PERIODS)[number];

export const GROUP_ROLES = ['owner', 'executive'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const DUE_KINDS = ['recurring', 'one_off'] as const;
export type DueKind = (typeof DUE_KINDS)[number];

/**
 * Something a group collects. Recurring dues repeat on each member's own periods (from the day
 * they joined); a one-off (a levy, a condolence fee) is owed once by everyone who was a member when
 * it was created. Compulsory ones fall overdue when unpaid; optional ones never do. The price never
 * changes (owed periods would reprice): end it and add another.
 */
export interface IGroupDue {
  _id: Types.ObjectId;
  name: string;
  kind: DueKind;
  /** Recurring only. */
  period?: GroupPeriod;
  amount: number;
  compulsory: boolean;
  /** One-off only: unpaid after this, a compulsory one is overdue. */
  dueAt?: Date;
  /** No periods start after this; an optional one can't be paid any more. What's owed stays owed. */
  endedAt?: Date;
  createdAt: Date;
}

export type PayoutAccount = { bankCode: string; bankName: string; accountNumber: string; accountName: string };

/**
 * A group people pay dues to: a school association, a club, a set. Members join with its invite
 * code and accept its terms, which name the account the money is paid out to. Tasa holds the
 * dues (`group:<id>`) until executives withdraw them, only to that account.
 */
export interface IGroup {
  _id: Types.ObjectId;
  name: string;
  about?: string;
  logoKey?: string;
  /** Joining needs this; rotating it stops old links working. */
  inviteCode: string;
  /** Executives approve each join before the member can pay. */
  requireApproval: boolean;
  /** What they ask of each member, e.g. matric number. */
  fields: { key: string; label: string; required: boolean }[];
  dues: IGroupDue[];
  /** The only place withdrawals can go. Changing it takes co-signers (see `GroupPayoutChange`). */
  payout: PayoutAccount;
  /** Bumped whenever members must accept again (a new payout account). */
  termsVersion: number;
  /** ID-checked people who run it. The owner is one of them. */
  executives: { user: Types.ObjectId; role: GroupRole; addedAt: Date }[];
  /** Bumped by every withdrawal first, so two can't spend the same balance. */
  withdrawals: number;
  status: 'active' | 'closed';
  /** Tasa stopped it: no joining, paying or withdrawing until lifted. Set when `at` is. */
  suspended?: { at: Date; reason?: string; by?: Types.ObjectId };
  /** Every suspension and lift by Tasa staff, oldest first. */
  suspensionHistory: { action: 'suspended' | 'lifted'; reason?: string; by: Types.ObjectId; at: Date }[];
  createdAt: Date;
}

const payoutFields = { bankCode: String, bankName: String, accountNumber: String, accountName: String };

const groupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true },
    about: { type: String, trim: true },
    logoKey: String,
    inviteCode: { type: String, required: true, unique: true },
    requireApproval: { type: Boolean, default: false },
    fields: [{ _id: false, key: { type: String, required: true }, label: { type: String, required: true }, required: { type: Boolean, default: false } }],
    dues: [
      {
        name: { type: String, required: true, trim: true },
        kind: { type: String, enum: DUE_KINDS, required: true },
        period: { type: String, enum: GROUP_PERIODS },
        amount: { type: Number, required: true },
        compulsory: { type: Boolean, required: true },
        dueAt: Date,
        endedAt: Date,
        createdAt: { type: Date, required: true },
      },
    ],
    payout: { type: payoutFields, required: true, _id: false },
    termsVersion: { type: Number, default: 1 },
    executives: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: GROUP_ROLES, required: true },
        addedAt: { type: Date, required: true },
      },
    ],
    withdrawals: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
    suspended: { at: Date, reason: String, by: { type: Schema.Types.ObjectId, ref: 'Admin' } },
    suspensionHistory: [
      {
        _id: false,
        action: { type: String, enum: ['suspended', 'lifted'], required: true },
        reason: String,
        by: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
        at: { type: Date, required: true },
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
groupSchema.index({ 'executives.user': 1 });

export const GroupModel = model<IGroup>('Group', groupSchema);
export type GroupDoc = HydratedDocument<IGroup>;

/**
 * One person in one group. Their periods start the day they were let in (`startsAt`) and repeat
 * on each recurring due's period. Period `k` of a due is paid when `paid` has it; negative `k` are
 * arrears from before Tasa, added by executives as backfills.
 */
export interface IGroupMember {
  _id: Types.ObjectId;
  group: Types.ObjectId;
  user: Types.ObjectId;
  status: 'pending' | 'active' | 'removed';
  /** What they told the group, keyed by `IGroup.fields[].key`. */
  fields: Map<string, string>;
  /** When their period 0 starts: the day they were let in. */
  startsAt: Date;
  /** Day of the month periods fall on (the join day), so short months don't drift it. */
  anchorDay: number;
  /** Every period paid, of every due. A one-off's only period is 0. */
  paid: { due: Types.ObjectId; period: number; at: Date; transaction?: Types.ObjectId }[];
  /** Periods of a recurring due added as arrears by executives, with who and when. */
  backfills: { due: Types.ObjectId; periods: number; by: Types.ObjectId; at: Date; note?: string }[];
  /** The terms they accepted, with the payout account they were shown. */
  accepted: { version: number; at: Date; payout: PayoutAccount };
  joinedAt: Date;
}

const memberSchema = new Schema<IGroupMember>({
  group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'active', 'removed'], required: true },
  fields: { type: Map, of: String, default: {} },
  startsAt: { type: Date, required: true },
  anchorDay: { type: Number, required: true },
  paid: [
    {
      _id: false,
      due: { type: Schema.Types.ObjectId, required: true },
      period: { type: Number, required: true },
      at: Date,
      transaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    },
  ],
  backfills: [{ _id: false, due: Schema.Types.ObjectId, periods: Number, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, note: String }],
  accepted: { version: Number, at: Date, payout: { type: payoutFields, _id: false } },
  joinedAt: { type: Date, required: true },
});
memberSchema.index({ group: 1, user: 1 }, { unique: true });
memberSchema.index({ user: 1 });

export const GroupMemberModel = model<IGroupMember>('GroupMember', memberSchema);
export type GroupMemberDoc = HydratedDocument<IGroupMember>;

/**
 * A proposed new payout account. The owner names it and at least two co-signers; when every
 * co-signer has approved it waits out a cooling-off period, during which any executive can
 * object. Withdrawals stop while one is open.
 */
export interface IGroupPayoutChange {
  _id: Types.ObjectId;
  group: Types.ObjectId;
  proposedBy: Types.ObjectId;
  from: PayoutAccount;
  to: PayoutAccount;
  cosigners: { user: Types.ObjectId; approvedAt?: Date }[];
  status: 'awaiting_approval' | 'cooling_off' | 'applied' | 'rejected' | 'expired';
  /** Until then co-signers can approve; after it, an unapproved proposal lapses. */
  expiresAt: Date;
  /** Set once everyone approved: it takes effect then unless someone objects. */
  effectiveAt?: Date;
  closedBy?: Types.ObjectId;
  closedReason?: string;
  closedAt?: Date;
  createdAt: Date;
}

const payoutChangeSchema = new Schema<IGroupPayoutChange>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    proposedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    from: { type: payoutFields, _id: false },
    to: { type: payoutFields, _id: false },
    cosigners: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, approvedAt: Date }],
    status: { type: String, enum: ['awaiting_approval', 'cooling_off', 'applied', 'rejected', 'expired'], required: true },
    expiresAt: { type: Date, required: true },
    effectiveAt: Date,
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    closedReason: String,
    closedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// One open proposal per group: a second waits for the first to settle.
payoutChangeSchema.index({ group: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['awaiting_approval', 'cooling_off'] } } });

export const GroupPayoutChangeModel = model<IGroupPayoutChange>('GroupPayoutChange', payoutChangeSchema);
export type GroupPayoutChangeDoc = HydratedDocument<IGroupPayoutChange>;
