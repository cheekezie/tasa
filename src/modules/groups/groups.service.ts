import { randomInt } from 'node:crypto';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { inTransaction, isDuplicateKey } from '../../lib/db';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { r2 } from '../../lib/r2';
import { bus } from '../../lib/events';
import { formatNaira } from '../../lib/money';
import { getQueue } from '../../lib/queue';
import { newReference } from '../../lib/references';
import { paginate } from '../../lib/response';
import { ChargesService } from '../charges/charges.service';
import { ConfigService } from '../config/config.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { QuotesService, toQuoteDto } from '../quotes/quotes.service';
import { TicketsService } from '../tickets/tickets.service';
import { TransactionModel } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { UserModel } from '../users/models/user.model';
import { AvatarsService, sniffImage } from '../users/avatars.service';
import { PinService } from '../users/pin.service';
import { lagosParts } from '../recurring/schedule';
import { bucket, duePeriods, periodIn, summarise, yearColumns, type DueMember, type DuePeriod } from './groups.dues';
import { lagosMidnight } from './groups.periods';
import { MAX_EXECUTIVES, MAX_OPEN_DUES, type CreateGroupInput, type DueInput, type GroupDuesQuoteInput, type GroupPayoutQuoteInput } from './groups.schema';
import {
  GroupMemberModel,
  GroupModel,
  GroupPayoutChangeModel,
  type GroupMemberDoc,
  type IGroup,
  type IGroupDue,
  type IGroupMember,
  type IGroupPayoutChange,
  type PayoutAccount,
} from './models/group.model';

export const GROUPS_QUEUE = 'groups';
/** How long co-signers have to approve a new payout account. */
export const PAYOUT_CHANGE_APPROVAL_MS = 72 * 60 * 60_000;
/** After everyone approves, how long any executive can still object before it takes effect. */
export const PAYOUT_CHANGE_COOLING_OFF_MS = 48 * 60 * 60_000;

// No 0/O, 1/I/L: codes are read out loud and typed from posters.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newInviteCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const fieldKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30) || 'field';

const withKeys = (fields: { label: string; required: boolean }[]) => {
  const seen = new Set<string>();
  return fields.map((f) => {
    let key = fieldKey(f.label);
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    return { key, label: f.label, required: f.required };
  });
};

const masked = (p: PayoutAccount) => ({ bankName: p.bankName, accountName: p.accountName, last4: p.accountNumber.slice(-4) });

const logoUrl = (g: Pick<IGroup, 'logoKey'>) => (g.logoKey ? r2.publicUrl(g.logoKey) : null);

const roleOf = (group: Pick<IGroup, 'executives'>, userId: string) => group.executives.find((e) => e.user.toString() === userId)?.role ?? null;

async function groupOr404(id: string) {
  const group = await GroupModel.findById(id);
  if (!group || group.status === 'closed') throw notFound('Group not found');
  return group;
}

function assertOpen(group: Pick<IGroup, 'suspended'>) {
  if (group.suspended?.at) throw forbidden('This group is suspended. Contact Tela support.');
}

async function asExecutive(groupId: string, userId: string, role?: 'owner') {
  const group = await groupOr404(groupId);
  const mine = roleOf(group, userId);
  if (!mine || (role === 'owner' && mine !== 'owner')) throw forbidden(role === 'owner' ? 'Only the group owner can do this' : 'Only executives can do this');
  return group;
}

/** Executives run the money, so each must have a BVN or NIN on file. */
async function assertIdOnFile(userId: string | Types.ObjectId, who: 'you' | 'they') {
  const user = await UserModel.findById(userId).select('bvnLast4 ninLast4');
  if (!user?.bvnLast4 && !user?.ninLast4) {
    throw unprocessable(who === 'you' ? 'Add your BVN or NIN to run a group' : 'They need a BVN or NIN on Tela to be an executive', 'ID_REQUIRED');
  }
}

const dueOf = (group: Pick<IGroup, 'dues'>, dueId: Types.ObjectId | string) => group.dues.find((d) => d._id.toString() === String(dueId));
const isOpen = (d: Pick<IGroupDue, 'endedAt'>) => !d.endedAt;

const dueDto = (d: IGroupDue) => ({
  id: d._id.toString(),
  name: d.name,
  kind: d.kind,
  period: d.period ?? null,
  /** Kobo, per period. */
  amount: d.amount,
  compulsory: d.compulsory,
  dueAt: d.dueAt?.toISOString() ?? null,
  endedAt: d.endedAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
});

const periodDto = (p: DuePeriod) => ({ index: p.index, start: p.start.toISOString(), end: p.end?.toISOString() ?? null, status: p.status });

/** How far ahead "coming up" looks: the next period of each repeating due. */
const UPCOMING_AHEAD = 1;

/**
 * What's coming up for a member, for Home: per compulsory due, what's owed now (one line,
 * however many periods), then the next period ahead. Optional dues are never "coming up".
 */
const upcomingOf = (m: DueMember, dues: IGroupDue[], now: Date) =>
  dues
    .filter((d) => d.compulsory)
    .flatMap((due) => {
      const periods = duePeriods(m, due, now);
      const owed = periods.filter((p) => p.status === 'due' || p.status === 'overdue');
      const ahead = periods.filter((p) => p.status === 'upcoming').slice(0, due.kind === 'recurring' ? UPCOMING_AHEAD : 0);
      const base = { dueId: due._id.toString(), name: due.name, kind: due.kind, period: due.period ?? null };
      return [
        ...(owed.length
          ? [
              {
                ...base,
                status: owed.some((p) => p.status === 'overdue') ? ('overdue' as const) : ('due' as const),
                periods: owed.length,
                amount: owed.length * due.amount,
                /** When the earliest owed one fell due (a one-off's deadline, if it has one). */
                date: (due.kind === 'one_off' && due.dueAt ? due.dueAt : owed[0]!.start).toISOString(),
              },
            ]
          : []),
        ...ahead.map((p) => ({ ...base, status: 'upcoming' as const, periods: 1, amount: due.amount, date: p.start.toISOString() })),
      ];
    });

/** Their period-by-period statement on every due that's theirs. */
const statementOf = (m: DueMember, dues: IGroupDue[], now: Date) =>
  dues
    .map((d) => ({ due: d, periods: duePeriods(m, d, now) }))
    .filter((x) => x.periods.length > 0)
    .map(({ due, periods }) => ({
      ...dueDto(due),
      periods: periods.map(periodDto),
      /** Kobo owed on this due (due + overdue). */
      owed: periods.filter((p) => p.status === 'due' || p.status === 'overdue').length * due.amount,
      paidCount: periods.filter((p) => p.status === 'paid').length,
    }));

async function balanceOf(groupId: Types.ObjectId | string, session?: ClientSession) {
  const raw = await LedgerService.balance(Accounts.group(groupId), session);
  return raw === 0 ? 0 : -raw;
}

const openChange = (groupId: Types.ObjectId | string, session?: ClientSession) =>
  GroupPayoutChangeModel.findOne({ group: groupId, status: { $in: ['awaiting_approval', 'cooling_off'] } }).session(session ?? null);

type MemberLike = Omit<IGroupMember, 'fields'> & { fields?: Map<string, string> | Record<string, string> };

/** A member's standing. With `statement`, every period of every due that's theirs, for choosing what to pay. */
function memberDto(m: MemberLike, group: Pick<IGroup, 'dues' | 'termsVersion'>, opts: { now?: Date; statement?: boolean; upcoming?: boolean } = {}) {
  const now = opts.now ?? new Date();
  // Pending members owe nothing yet: their periods start when they're let in.
  const owed = m.status === 'active' ? summarise(m, group.dues, now) : { amount: 0, overdue: 0, periods: 0 };
  return {
    id: m._id.toString(),
    status: m.status,
    fields: m.fields instanceof Map ? Object.fromEntries(m.fields) : (m.fields ?? {}),
    startsAt: m.startsAt.toISOString(),
    joinedAt: m.joinedAt.toISOString(),
    /** Kobo owed now (current and overdue, compulsory dues only). */
    amountOwed: owed.amount,
    /** Kobo of that already overdue. */
    overdue: owed.overdue,
    periodsOwed: owed.periods,
    /** They must accept the current terms (a new payout account) before paying again. */
    mustAcceptTerms: m.accepted.version !== group.termsVersion,
    ...(opts.statement && { dues: m.status === 'active' ? statementOf(m, group.dues, now) : [] }),
    ...(opts.upcoming && { upcoming: m.status === 'active' && m.accepted.version === group.termsVersion ? upcomingOf(m, group.dues, now) : [] }),
  };
}

async function changeDto(c: IGroupPayoutChange | null, viewerId: string) {
  if (!c) return null;
  const names = await UserModel.find({ _id: { $in: [c.proposedBy, ...c.cosigners.map((x) => x.user)] } }).select('fullName username').lean();
  const name = (id: Types.ObjectId) => {
    const u = names.find((n) => n._id.toString() === id.toString());
    return u?.fullName || (u?.username ? `@${u.username}` : 'An executive');
  };
  return {
    id: c._id.toString(),
    status: c.status,
    from: masked(c.from),
    to: { ...masked(c.to), bankCode: c.to.bankCode },
    proposedBy: name(c.proposedBy),
    cosigners: c.cosigners.map((x) => ({ id: x.user.toString(), name: name(x.user), approvedAt: x.approvedAt?.toISOString() ?? null })),
    /** This viewer is a co-signer who hasn't approved yet. */
    awaitingYou: c.status === 'awaiting_approval' && c.cosigners.some((x) => x.user.toString() === viewerId && !x.approvedAt),
    expiresAt: c.expiresAt.toISOString(),
    effectiveAt: c.effectiveAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** The terms a joiner accepts: who runs it, what it costs, and exactly where the money is paid out to. */
async function termsOf(group: IGroup) {
  const owner = group.executives.find((e) => e.role === 'owner')!;
  const [ownerUser, fees] = await Promise.all([
    UserModel.findById(owner.user).select('fullName username').lean(),
    Promise.all(group.dues.filter(isOpen).map(async (d) => ({ due: d, charge: (await ChargesService.compute({ scope: 'group_dues' }, d.amount)).fee }))),
  ]);
  return {
    version: group.termsVersion,
    runBy: ownerUser?.fullName || (ownerUser?.username ? `@${ownerUser.username}` : 'The group owner'),
    payout: masked(group.payout),
    dues: fees.map(({ due, charge }) => ({ ...dueDto(due), charge })),
    points: [
      `Dues are held by Tela for ${group.name} and paid out only to ${group.payout.accountName}, ${group.payout.bankName} •••• ${group.payout.accountNumber.slice(-4)}.`,
      'Recurring dues start the day you’re let in and repeat from that day. Executives can add dues later, such as a one-off levy. Dues already paid are not refunded.',
      'If the group changes where its money goes, you will be asked to accept again before paying.',
    ],
  };
}

/**
 * The group's dues for executives, each with how it's going: this period's (or the one-off's)
 * paid count among the members it applies to, what's owed now, and what it has collected.
 */
async function duesWithStats(group: IGroup) {
  const now = new Date();
  const members = await GroupMemberModel.find({ group: group._id, status: { $ne: 'pending' } }).select('status startsAt anchorDay joinedAt paid backfills').lean();
  const active = members.filter((m) => m.status === 'active');
  return group.dues.map((due) => {
    const column = due.kind === 'recurring' ? bucket(due.period!, now, 0) : null;
    let applies = 0;
    let paid = 0;
    let outstanding = 0;
    for (const m of active) {
      const periods = duePeriods(m, due, now);
      const cell = column ? periodIn(m, due, column, periods) : (periods[0] ?? null);
      if (cell) applies += 1;
      if (cell?.status === 'paid') paid += 1;
      outstanding += periods.filter((p) => p.status === 'due' || p.status === 'overdue').length * due.amount;
    }
    const collected = members.reduce((n, m) => n + m.paid.filter((p) => p.due.equals(due._id)).length, 0) * due.amount;
    return { ...dueDto(due), stats: { current: { start: (column?.start ?? due.createdAt).toISOString(), members: applies, paid }, outstanding, collected } };
  });
}

export const GroupsService = {
  async create(userId: string, input: CreateGroupInput) {
    await assertIdOnFile(userId, 'you');
    const payout = await TicketsService.verifyBankAccount(input.bankCode, input.accountNumber);
    for (let attempt = 0; ; attempt++) {
      try {
        // The owner is its first member, having accepted the terms they wrote.
        const groupId = await inTransaction(async (session) => {
          const now = new Date();
          const { y, m, d } = lagosParts(now);
          const [group] = await GroupModel.create(
            [
              {
                name: input.name,
                about: input.about,
                requireApproval: input.requireApproval,
                fields: withKeys(input.fields),
                dues: input.dues.map((d) => ({ ...d, createdAt: now })),
                payout,
                inviteCode: newInviteCode(),
                executives: [{ user: userId, role: 'owner', addedAt: now }],
              },
            ],
            { session },
          );
          await GroupMemberModel.create(
            [
              {
                group: group!._id,
                user: userId,
                status: 'active',
                fields: {},
                startsAt: lagosMidnight(y, m, d),
                anchorDay: d,
                paid: [],
                backfills: [],
                accepted: { version: group!.termsVersion, at: now, payout: group!.payout },
                joinedAt: now,
              },
            ],
            { session },
          );
          return group!.id as string;
        });
        return this.detail(groupId, userId);
      } catch (err) {
        if (!isDuplicateKey(err) || attempt >= 4) throw err;
      }
    }
  },

  /** Their groups: the ones they run and the ones they're in. */
  async mine(userId: string) {
    const [members, running] = await Promise.all([
      GroupMemberModel.find({ user: userId, status: { $ne: 'removed' } }).lean(),
      GroupModel.find({ 'executives.user': userId, status: 'active' }).lean(),
    ]);
    const ids = [...new Set([...members.map((m) => m.group.toString()), ...running.map((g) => g._id.toString())])];
    const groups = await GroupModel.find({ _id: { $in: ids }, status: 'active' }).lean();
    return groups.map((g) => {
      const member = members.find((m) => m.group.toString() === g._id.toString());
      return {
        id: g._id.toString(),
        name: g.name,
        logoUrl: logoUrl(g),
        role: roleOf(g, userId),
        suspended: Boolean(g.suspended?.at),
        membership: member ? memberDto(member, g, { upcoming: true }) : null,
      };
    });
  },

  /** What a member sees, and for executives, the money and anything waiting on them. */
  async detail(groupId: string, userId: string) {
    const group = await groupOr404(groupId);
    const role = roleOf(group, userId);
    const member = await GroupMemberModel.findOne({ group: group._id, user: userId, status: { $ne: 'removed' } });
    if (!role && !member) throw notFound('Group not found');
    const [change, counts, execUsers] = await Promise.all([
      openChange(group._id),
      GroupMemberModel.aggregate<{ _id: string; n: number }>([{ $match: { group: group._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      UserModel.find({ _id: { $in: group.executives.map((e) => e.user) } }).select('fullName username').lean(),
    ]);
    const count = (status: string) => counts.find((c) => c._id === status)?.n ?? 0;
    return {
      id: group.id as string,
      name: group.name,
      logoUrl: logoUrl(group),
      about: group.about ?? null,
      requireApproval: group.requireApproval,
      fields: group.fields,
      dues: role ? await duesWithStats(group) : group.dues.filter(isOpen).map(dueDto),
      terms: await termsOf(group),
      executives: group.executives.map((e) => {
        const u = execUsers.find((x) => x._id.toString() === e.user.toString());
        return { id: e.user.toString(), name: u?.fullName ?? null, username: u?.username ?? null, role: e.role };
      }),
      role,
      membership: member ? memberDto(member, group, { statement: true }) : null,
      members: { active: count('active'), pending: count('pending') },
      suspended: group.suspended?.at ? { at: group.suspended.at.toISOString(), reason: group.suspended.reason ?? null } : null,
      // Members are told a change is coming once it's approved; executives see it from the start.
      payoutChange: change && (role || change.status === 'cooling_off') ? await changeDto(change, userId) : null,
      ...(role && {
        inviteCode: group.inviteCode,
        payout: group.payout,
        /** Kobo held for the group. */
        balance: await balanceOf(group._id),
      }),
    };
  },

  async update(groupId: string, userId: string, input: { name?: string | undefined; about?: string | undefined; requireApproval?: boolean | undefined; fields?: { label: string; required: boolean }[] | undefined }) {
    const group = await asExecutive(groupId, userId);
    if (input.name !== undefined) group.name = input.name;
    if (input.about !== undefined) group.about = input.about || undefined;
    if (input.requireApproval !== undefined) group.requireApproval = input.requireApproval;
    if (input.fields) group.fields = withKeys(input.fields);
    await group.save();
    return this.detail(groupId, userId);
  },

  /** The group's picture, shown to members and on invites. Replacing it removes the old file. */
  async setLogo(groupId: string, userId: string, buffer: Buffer) {
    const group = await asExecutive(groupId, userId);
    const image = sniffImage(buffer);
    if (!image) throw unprocessable('Use a JPEG, PNG or WebP image', 'PHOTO_INVALID');
    const { key } = await r2.uploadFile(buffer, image.extension, image.mimeType, `groups/${group.id as string}`);
    const previous = await GroupModel.findOneAndUpdate({ _id: group._id }, { logoKey: key });
    if (previous?.logoKey) await AvatarsService.purge(previous.logoKey);
    return this.detail(groupId, userId);
  },

  /** A new due for the group: recurring (from the period it's added in) or a one-off for today's members. */
  async addDue(groupId: string, userId: string, input: DueInput) {
    const group = await asExecutive(groupId, userId);
    assertOpen(group);
    if (group.dues.filter(isOpen).length >= MAX_OPEN_DUES) throw unprocessable(`A group can collect up to ${MAX_OPEN_DUES} dues at once. End one first.`, 'TOO_MANY_DUES');
    group.dues.push({ ...input, createdAt: new Date() } as IGroupDue);
    await group.save();
    bus.emit('group.due', { groupId, dueId: group.dues.at(-1)!._id.toString() });
    return this.detail(groupId, userId);
  },

  /** Stops new periods (and an optional one being paid). What members already owe stays owed. */
  async endDue(groupId: string, userId: string, dueId: string) {
    const group = await asExecutive(groupId, userId);
    const due = dueOf(group, dueId);
    if (!due) throw notFound('Due not found');
    if (due.endedAt) throw conflict('This due has already ended', 'DUE_ENDED');
    await GroupModel.updateOne({ _id: group._id, dues: { $elemMatch: { _id: due._id, endedAt: { $exists: false } } } }, { $set: { 'dues.$.endedAt': new Date() } });
    return this.detail(groupId, userId);
  },

  async rotateInviteCode(groupId: string, userId: string) {
    await asExecutive(groupId, userId);
    for (let attempt = 0; ; attempt++) {
      try {
        await GroupModel.updateOne({ _id: groupId }, { inviteCode: newInviteCode() });
        return this.detail(groupId, userId);
      } catch (err) {
        if (!isDuplicateKey(err) || attempt >= 4) throw err;
      }
    }
  },

  // ── Joining ─────────────────────────────────────────────────────────────
  /**
   * What the web invite page shows to anyone with the link, signed in or not: only the group's
   * name and picture. The terms, dues and payout account wait for the app, behind sign-in.
   */
  async publicPreview(code: string) {
    const group = await GroupModel.findOne({ inviteCode: code, status: 'active', 'suspended.at': { $exists: false } }).select('name logoKey requireApproval').lean();
    if (!group) throw notFound('No group has that code. Check it with the person who invited you.');
    return { name: group.name, logoUrl: logoUrl(group), requireApproval: group.requireApproval };
  },

  /** What the invite shows before they join: the group and the terms to accept. */
  async preview(code: string) {
    const group = await GroupModel.findOne({ inviteCode: code, status: 'active' });
    if (!group) throw notFound('No group has that code. Check it with the person who invited you.');
    assertOpen(group);
    return { id: group.id as string, name: group.name, logoUrl: logoUrl(group), about: group.about ?? null, requireApproval: group.requireApproval, fields: group.fields, terms: await termsOf(group) };
  },

  async join(userId: string, input: { code: string; fields: Record<string, string>; acceptTerms: number }) {
    const group = await GroupModel.findOne({ inviteCode: input.code, status: 'active' });
    if (!group) throw notFound('No group has that code. Check it with the person who invited you.');
    assertOpen(group);
    if (input.acceptTerms !== group.termsVersion) throw conflict('These terms have changed. Read them again before joining.', 'GROUP_TERMS_CHANGED');
    const missing = group.fields.find((f) => f.required && !input.fields[f.key]?.trim());
    if (missing) throw unprocessable(`Enter your ${missing.label.toLowerCase()}`, 'FIELD_REQUIRED');
    const fields = Object.fromEntries(group.fields.filter((f) => input.fields[f.key]?.trim()).map((f) => [f.key, input.fields[f.key]!.trim()]));

    const now = new Date();
    const { y, m, d } = lagosParts(now);
    const existing = await GroupMemberModel.findOne({ group: group._id, user: userId });
    if (existing && existing.status !== 'removed') throw conflict('You’re already in this group', 'ALREADY_MEMBER');
    const fresh = {
      status: group.requireApproval ? 'pending' : 'active',
      fields,
      startsAt: lagosMidnight(y, m, d),
      anchorDay: d,
      paid: [],
      backfills: [],
      accepted: { version: group.termsVersion, at: now, payout: group.payout },
      joinedAt: now,
    } as const;
    let member: GroupMemberDoc;
    try {
      // Someone removed who comes back starts again: what they owed before stays with the group's records.
      member = existing ? (await GroupMemberModel.findByIdAndUpdate(existing._id, fresh, { new: true }))! : await GroupMemberModel.create({ group: group._id, user: userId, ...fresh });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('You’re already in this group', 'ALREADY_MEMBER');
      throw err;
    }
    bus.emit('group.member', { memberId: member.id as string, stage: member.status === 'pending' ? 'requested' : 'joined' });
    return this.detail(group.id as string, userId);
  },

  /** After the group changes where its money goes: they read the new terms and accept them. */
  async acceptTerms(groupId: string, userId: string, version: number) {
    const group = await groupOr404(groupId);
    if (version !== group.termsVersion) throw conflict('These terms have changed again. Read them before accepting.', 'GROUP_TERMS_CHANGED');
    const updated = await GroupMemberModel.findOneAndUpdate(
      { group: group._id, user: userId, status: { $ne: 'removed' } },
      { accepted: { version: group.termsVersion, at: new Date(), payout: group.payout } },
    );
    if (!updated) throw notFound('You’re not in this group');
    return this.detail(groupId, userId);
  },

  // ── Members (executives) ────────────────────────────────────────────────
  async members(groupId: string, userId: string, q: { status?: 'pending' | 'active' | undefined; owing?: boolean | undefined; search?: string | undefined; page: number; limit: number }) {
    const group = await asExecutive(groupId, userId);
    const filter: FilterQuery<IGroupMember> = { group: group._id, status: q.status ?? { $in: ['pending', 'active'] } };
    if (q.search) {
      const pattern = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await UserModel.find({ $or: [{ fullName: pattern }, { username: pattern }] }).select('_id').limit(500).lean();
      filter.user = { $in: users.map((u) => u._id) };
    }
    const all = await GroupMemberModel.find(filter).sort({ joinedAt: 1 }).lean();
    const now = new Date();
    // Owing depends on today's date, so it's worked out here rather than queried.
    const rows = all.map((m) => ({ m, dto: memberDto(m, group, { now }) })).filter(({ dto }) => q.owing === undefined || (dto.periodsOwed > 0) === q.owing);
    const page = rows.slice((q.page - 1) * q.limit, q.page * q.limit);
    const users = await UserModel.find({ _id: { $in: page.map(({ m }) => m.user) } }).select('fullName username phone').lean();
    return paginate(
      page.map(({ m, dto }) => {
        const u = users.find((x) => x._id.toString() === m.user.toString());
        return { ...dto, user: { id: m.user.toString(), name: u?.fullName ?? null, username: u?.username ?? null } };
      }),
      rows.length,
      q.page,
      q.limit,
    );
  },

  async decide(groupId: string, userId: string, memberId: string, approve: boolean) {
    const group = await asExecutive(groupId, userId);
    const now = new Date();
    const { y, m, d } = lagosParts(now);
    // Their periods start when they're let in, not when they asked.
    const updated = await GroupMemberModel.findOneAndUpdate(
      { _id: memberId, group: group._id, status: 'pending' },
      approve ? { status: 'active', startsAt: lagosMidnight(y, m, d), anchorDay: d } : { status: 'removed' },
      { new: true },
    );
    if (!updated) throw conflict('This person isn’t waiting for approval', 'MEMBER_NOT_PENDING');
    bus.emit('group.member', { memberId, stage: approve ? 'approved' : 'rejected' });
    return memberDto(updated, group);
  },

  async remove(groupId: string, userId: string, memberId: string) {
    const group = await asExecutive(groupId, userId);
    const updated = await GroupMemberModel.findOneAndUpdate({ _id: memberId, group: group._id, status: { $ne: 'removed' } }, { status: 'removed' });
    if (!updated) throw notFound('Member not found');
    return { removed: true };
  },

  /** One member's statement, for executives: every period of every due, and their details. */
  async member(groupId: string, userId: string, memberId: string) {
    const group = await asExecutive(groupId, userId);
    const member = await GroupMemberModel.findOne({ _id: memberId, group: group._id });
    if (!member) throw notFound('Member not found');
    const user = await UserModel.findById(member.user).select('fullName username').lean();
    return {
      ...memberDto(member, group, { statement: true }),
      user: { id: member.user.toString(), name: user?.fullName ?? null, username: user?.username ?? null },
      backfills: member.backfills.map((b) => ({ dueId: b.due?.toString() ?? null, periods: b.periods, note: b.note ?? null, at: b.at.toISOString() })),
    };
  },

  /** Arrears from before Tela on a recurring due: earlier periods, owed like any other. */
  async backfill(groupId: string, userId: string, memberId: string, input: { dueId: string; periods: number; note?: string | undefined }) {
    const group = await asExecutive(groupId, userId);
    const due = dueOf(group, input.dueId);
    if (!due || due.kind !== 'recurring' || !due.compulsory) throw unprocessable('Arrears can only be added to a compulsory recurring due', 'DUE_NOT_BACKFILLABLE');
    const updated = await GroupMemberModel.findOneAndUpdate(
      { _id: memberId, group: group._id, status: 'active' },
      { $push: { backfills: { due: due._id, periods: input.periods, by: userId, at: new Date(), ...(input.note && { note: input.note }) } } },
      { new: true },
    );
    if (!updated) throw notFound('Member not found');
    return memberDto(updated, group, { statement: true });
  },

  /**
   * Who paid what of one due, for executives: members down the side, every month (week) of one
   * calendar year across; a yearly due shows every year. Each member's period is placed in the
   * column it starts in. `years` lists the ones with any period in them, for filtering.
   */
  async dueReport(groupId: string, userId: string, dueId: string, q: { year?: number | undefined; search?: string | undefined; page: number; limit: number }) {
    const group = await asExecutive(groupId, userId);
    const due = dueOf(group, dueId);
    if (!due) throw notFound('Due not found');
    const now = new Date();
    const filter: FilterQuery<IGroupMember> = { group: group._id, status: 'active' };
    if (q.search) {
      const pattern = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await UserModel.find({ $or: [{ fullName: pattern }, { username: pattern }] }).select('_id').limit(500).lean();
      filter.user = { $in: users.map((u) => u._id) };
    }
    const all = await GroupMemberModel.find(filter).lean();
    const users = await UserModel.find({ _id: { $in: all.map((m) => m.user) } }).select('fullName username').lean();
    const nameOf = (uid: Types.ObjectId) => {
      const u = users.find((x) => x._id.toString() === uid.toString());
      return { id: uid.toString(), name: u?.fullName ?? null, username: u?.username ?? null };
    };

    const statements = all.map((m) => ({ m, periods: duePeriods(m, due, now) }));
    // The years anything falls in: from the earliest period (arrears included) to the latest paid ahead.
    const thisYear = lagosParts(now).y;
    const starts = statements.flatMap((s) => s.periods.filter((p) => p.index <= 0 || p.status === 'paid').map((p) => lagosParts(p.start).y));
    const firstYear = Math.min(thisYear, lagosParts(due.createdAt).y, ...starts);
    const lastYear = Math.max(thisYear, ...starts);
    const years = due.kind === 'one_off' ? [] : Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
    const year = q.year ?? thisYear;
    const columns =
      due.kind === 'one_off'
        ? [{ start: due.createdAt, end: due.dueAt ?? null }]
        : due.period === 'yearly'
          ? years.map((y) => bucket('yearly', lagosMidnight(y, 6, 1), 0))
          : yearColumns(due.period!, year);
    const rows = statements
      .map(({ m, periods }) => {
        const cells =
          due.kind === 'one_off'
            ? [periods[0]?.status ?? null]
            : columns.map((c) => periodIn(m, due, c as { start: Date; end: Date }, periods)?.status ?? null);
        const owed = periods.filter((p) => p.status === 'due' || p.status === 'overdue').length * due.amount;
        return { member: m, user: nameOf(m.user), cells, owed, paid: periods.filter((p) => p.status === 'paid').length };
      })
      // One-offs only list the members they apply to.
      .filter((r) => due.kind === 'recurring' || r.cells[0] !== null)
      .sort((a, b) => b.owed - a.owed || (a.user.name ?? a.user.username ?? '').localeCompare(b.user.name ?? b.user.username ?? ''));

    const page = rows.slice((q.page - 1) * q.limit, q.page * q.limit);
    const everyone = await GroupMemberModel.find({ group: group._id, 'paid.due': due._id }).select('paid').lean();
    return {
      due: dueDto(due),
      totals: {
        /** Kobo collected on this due, ever (removed members included). */
        collected: everyone.reduce((n, m) => n + m.paid.filter((p) => p.due.equals(due._id)).length, 0) * due.amount,
        /** Kobo owed now by today's members. */
        outstanding: rows.reduce((n, r) => n + r.owed, 0),
        members: rows.length,
        owing: rows.filter((r) => r.owed > 0).length,
      },
      columns: columns.map((c, i) => {
        const cells = rows.map((r) => r.cells[i]);
        const paid = cells.filter((x) => x === 'paid').length;
        return { start: c.start.toISOString(), end: c.end?.toISOString() ?? null, members: cells.filter((x) => x !== null).length, paid, collected: paid * due.amount };
      }),
      /** Years to filter by, oldest first (none for one-offs; every year is shown for yearly dues). */
      years,
      year: due.kind === 'recurring' && due.period !== 'yearly' ? year : null,
      items: page.map((r) => ({ id: r.member._id.toString(), user: r.user, cells: r.cells, owed: r.owed, paid: r.paid })),
      total: rows.length,
      page: q.page,
      limit: q.limit,
    };
  },

  // ── Executives ──────────────────────────────────────────────────────────
  async addExecutive(groupId: string, userId: string, username: string) {
    const group = await asExecutive(groupId, userId, 'owner');
    const user = await UserModel.findOne({ username, status: 'active' }).select('_id');
    if (!user) throw notFound('No Tela user has that username');
    if (roleOf(group, user.id as string)) throw conflict('They’re already an executive', 'ALREADY_EXECUTIVE');
    if (group.executives.length >= MAX_EXECUTIVES) throw unprocessable(`A group can have up to ${MAX_EXECUTIVES} executives`, 'TOO_MANY_EXECUTIVES');
    await assertIdOnFile(user._id, 'they');
    await GroupModel.updateOne({ _id: group._id, 'executives.user': { $ne: user._id } }, { $push: { executives: { user: user._id, role: 'executive', addedAt: new Date() } } });
    return this.detail(groupId, userId);
  },

  async removeExecutive(groupId: string, userId: string, executiveId: string) {
    const group = await asExecutive(groupId, userId, 'owner');
    if (executiveId === userId) throw unprocessable('The owner can’t step down here. Contact Tela support to hand over a group.', 'OWNER_STAYS');
    // A co-signer can't be removed mid-change: that would let the owner drop whoever objects.
    if ((await openChange(group._id))?.cosigners.some((c) => c.user.toString() === executiveId)) {
      throw conflict('They’re approving a payout account change. Wait for it to finish.', 'PAYOUT_CHANGE_OPEN');
    }
    await GroupModel.updateOne({ _id: group._id }, { $pull: { executives: { user: executiveId, role: 'executive' } } });
    return this.detail(groupId, userId);
  },

  // ── Paying dues ─────────────────────────────────────────────────────────
  /** The periods they picked, of any of the dues. Each must be theirs and unpaid. Priced like every debit. */
  async quoteDues(userId: string, { groupId, items }: GroupDuesQuoteInput) {
    const group = await groupOr404(groupId);
    assertOpen(group);
    const member = await GroupMemberModel.findOne({ group: group._id, user: userId, status: { $ne: 'removed' } });
    if (!member) throw notFound('You’re not in this group');
    if (member.status === 'pending') throw unprocessable('An executive has to approve you before you can pay', 'MEMBER_PENDING');
    if (member.accepted.version !== group.termsVersion) throw conflict('This group changed where its money goes. Accept the new terms first.', 'GROUP_TERMS_CHANGED');
    const now = new Date();
    const chosen = items.map((item) => {
      const due = dueOf(group, item.dueId);
      if (!due) throw notFound('Due not found');
      const payable = duePeriods(member, due, now).filter((p) => p.status !== 'paid');
      const periods = [...new Set(item.periods)].sort((a, b) => a - b);
      if (periods.some((k) => !payable.some((p) => p.index === k))) throw conflict(`Some of those ${due.name} periods are paid or can’t be paid. Check them again.`, 'DUES_CHANGED');
      return { due: due._id, name: due.name, amount: due.amount, periods };
    });
    if (new Set(chosen.map((c) => c.due.toString())).size !== chosen.length) throw unprocessable('List each due once', 'DUPLICATE_DUE');
    const amount = chosen.reduce((n, c) => n + c.amount * c.periods.length, 0);
    const [{ charges, fee }, { fee: rawGroupFee }] = await Promise.all([
      ChargesService.compute({ scope: 'group_dues' }, amount),
      ChargesService.compute({ scope: 'group_fee' }, amount),
    ]);
    const quote = await QuotesService.create(userId, {
      kind: 'group_dues',
      amount,
      charges,
      fee,
      groupDues: { group: group._id, member: member._id, items: chosen, groupFee: Math.min(rawGroupFee, amount), termsVersion: group.termsVersion },
    });
    return {
      ...toQuoteDto(quote),
      groupDues: { group: group.name, items: chosen.map((c) => ({ dueId: c.due.toString(), name: c.name, periods: c.periods, amount: c.amount * c.periods.length })) },
    };
  },

  /** Wallet → the group's balance, and the periods are marked paid, in one transaction. */
  async payDues(userId: string, quoteId: string, pin: string) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return toTransactionDto(existing);
    await PinService.verify(userId, pin);
    await ConfigService.assertEnabled('groups');
    const tx = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'group_dues', session);
      const q = quote.groupDues!;
      const group = await GroupModel.findById(q.group).session(session);
      if (!group || group.status !== 'active') throw notFound('Group not found');
      assertOpen(group);
      if (group.termsVersion !== q.termsVersion) throw conflict('This group changed where its money goes. Accept the new terms first.', 'GROUP_TERMS_CHANGED');
      const at = new Date();
      const txId = new Types.ObjectId();
      // Compare-and-set: none of these periods got paid since the quote (by another quote, say).
      const moved = await GroupMemberModel.updateOne(
        {
          _id: q.member,
          status: 'active',
          'accepted.version': q.termsVersion,
          paid: { $not: { $elemMatch: { $or: q.items.map((i) => ({ due: i.due, period: { $in: i.periods } })) } } },
        },
        { $push: { paid: { $each: q.items.flatMap((i) => i.periods.map((period) => ({ due: i.due, period, at, transaction: txId }))) } } },
        { session },
      );
      if (moved.modifiedCount === 0) throw conflict('Your dues just changed. Check them and pay again.', 'DUES_CHANGED');
      const [created] = await TransactionModel.create(
        [
          {
            _id: txId,
            reference: newReference('group_dues'),
            user: userId,
            kind: 'group_dues',
            direction: 'debit',
            status: 'success',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            group: {
              id: group._id,
              name: group.name,
              periods: q.items.reduce((n, i) => n + i.periods.length, 0),
              dues: q.items.map((i) => ({ id: i.due, name: i.name, periods: i.periods })),
            },
            narration: group.name,
            completedAt: new Date(),
            events: [{ type: 'created', at: new Date() }],
          },
        ],
        { session },
      );
      await LedgerService.post(
        {
          key: `group-dues:${created!.reference}`,
          memo: `${group.name} dues ${created!.reference}`,
          transactionId: created!._id,
          lines: [
            { account: Accounts.wallet(userId), amount: quote.total },
            { account: Accounts.group(group._id), amount: -(quote.amount - q.groupFee) },
            { account: Accounts.charges('group_dues'), amount: -quote.fee },
            { account: Accounts.charges('group_fee'), amount: -q.groupFee },
          ],
        },
        session,
      );
      return created!;
    });
    return toTransactionDto(tx);
  },

  // ── Withdrawing ─────────────────────────────────────────────────────────
  /** Only ever to the account in the group's terms, copied into the quote. */
  async quotePayout(userId: string, { groupId, amount }: GroupPayoutQuoteInput) {
    const group = await asExecutive(groupId, userId);
    assertOpen(group);
    if (await openChange(group._id)) throw conflict('Withdrawals wait while the payout account is being changed', 'PAYOUT_CHANGE_OPEN');
    const { charges, fee } = await ChargesService.compute({ scope: 'group_payout' }, amount);
    const balance = await balanceOf(group._id);
    if (amount + fee > balance) {
      throw new AppError(422, `The group can withdraw up to ${formatNaira(Math.max(0, balance - fee))}`, 'GROUP_FUNDS_LOW', { available: String(Math.max(0, balance - fee)) });
    }
    const quote = await QuotesService.create(userId, { kind: 'group_payout', amount, charges, fee, groupPayout: { group: group._id, ...group.payout } });
    return { ...toQuoteDto(quote), groupPayout: { group: group.name, ...masked(group.payout) } };
  },

  async payout(userId: string, quoteId: string, pin: string) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return toTransactionDto(existing);
    await PinService.verify(userId, pin);
    await ConfigService.assertEnabled('group_payouts');
    const tx = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'group_payout', session);
      const q = quote.groupPayout!;
      // Bumped first, so a second withdrawal racing this one waits for it.
      const group = await GroupModel.findOneAndUpdate({ _id: q.group, status: 'active', 'executives.user': userId }, { $inc: { withdrawals: 1 } }, { session, new: true });
      if (!group) throw forbidden('Only executives can withdraw');
      assertOpen(group);
      if (await openChange(group._id, session)) throw conflict('Withdrawals wait while the payout account is being changed', 'PAYOUT_CHANGE_OPEN');
      // The account it goes to must still be the group's: a change since the quote voids it.
      if (group.payout.accountNumber !== q.accountNumber || group.payout.bankCode !== q.bankCode) {
        throw conflict('The group’s payout account changed. Start the withdrawal again.', 'PAYOUT_ACCOUNT_CHANGED');
      }
      const balance = await balanceOf(group._id, session);
      if (quote.total > balance) throw new AppError(422, `The group can withdraw up to ${formatNaira(Math.max(0, balance - quote.fee))}`, 'GROUP_FUNDS_LOW');
      const reference = newReference('group_payout');
      const payout = { bankCode: q.bankCode, bankName: q.bankName, accountNumber: q.accountNumber, accountName: q.accountName };
      const [created] = await TransactionModel.create(
        [
          {
            reference,
            user: userId,
            kind: 'group_payout',
            direction: 'debit',
            status: 'pending',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            payout,
            fundedFrom: Accounts.group(group._id),
            group: { id: group._id, name: group.name },
            narration: `${payout.bankName} · ${payout.accountNumber}`,
            events: [{ type: 'created', at: new Date() }],
          },
        ],
        { session },
      );
      await LedgerService.post(
        {
          key: `group-payout:${reference}`,
          memo: `${group.name} withdrawal ${reference}`,
          transactionId: created!._id,
          lines: [
            { account: Accounts.group(group._id), amount: quote.total },
            { account: Accounts.payoutsInFlight, amount: -quote.amount },
            { account: Accounts.charges('group_payout'), amount: -quote.fee },
          ],
        },
        session,
      );
      return created!;
    });
    return toTransactionDto(await TicketsService.sendPayout(tx));
  },

  /** Every withdrawal, newest first: executives and members both see where the money went. */
  async withdrawals(groupId: string, userId: string) {
    const group = await groupOr404(groupId);
    const isMember = await GroupMemberModel.exists({ group: group._id, user: userId, status: 'active' });
    if (!roleOf(group, userId) && !isMember) throw notFound('Group not found');
    const rows = await TransactionModel.find({ kind: 'group_payout', 'group.id': group._id }).sort({ createdAt: -1 }).limit(100).lean();
    const people = await UserModel.find({ _id: { $in: rows.map((r) => r.user) } }).select('fullName username').lean();
    return rows.map((r) => {
      const u = people.find((p) => p._id.toString() === r.user.toString());
      return {
        id: r._id.toString(),
        status: r.status,
        amount: r.amount,
        to: r.payout ? masked(r.payout) : null,
        by: u?.fullName || (u?.username ? `@${u.username}` : null),
        at: r.createdAt.toISOString(),
      };
    });
  },

  // ── Changing the payout account ─────────────────────────────────────────
  /**
   * The owner names the new account and at least two executives to co-sign. Nothing changes
   * until every co-signer approves and the cooling-off passes with no objection.
   */
  async proposePayoutChange(groupId: string, userId: string, input: { bankCode: string; accountNumber: string; cosigners: string[]; pin: string }) {
    await PinService.verify(userId, input.pin);
    const group = await asExecutive(groupId, userId, 'owner');
    assertOpen(group);
    const cosigners = [...new Set(input.cosigners)];
    if (cosigners.includes(userId)) throw unprocessable('Choose other executives to approve: you’re proposing it', 'COSIGNER_IS_OWNER');
    if (cosigners.length < 2) throw unprocessable('Choose at least 2 executives to approve', 'COSIGNERS_REQUIRED');
    const notExec = cosigners.find((id) => roleOf(group, id) !== 'executive');
    if (notExec) throw unprocessable('Co-signers must be executives of this group', 'COSIGNER_NOT_EXECUTIVE');
    const to = await TicketsService.verifyBankAccount(input.bankCode, input.accountNumber);
    if (to.bankCode === group.payout.bankCode && to.accountNumber === group.payout.accountNumber) {
      throw unprocessable('That’s already the group’s payout account', 'SAME_PAYOUT_ACCOUNT');
    }
    let change;
    try {
      change = await GroupPayoutChangeModel.create({
        group: group._id,
        proposedBy: userId,
        from: group.payout,
        to,
        cosigners: cosigners.map((user) => ({ user })),
        status: 'awaiting_approval',
        expiresAt: new Date(Date.now() + PAYOUT_CHANGE_APPROVAL_MS),
      });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('A payout account change is already waiting', 'PAYOUT_CHANGE_OPEN');
      throw err;
    }
    await getQueue(GROUPS_QUEUE).add('payout-change.expire', { changeId: change.id }, { delay: PAYOUT_CHANGE_APPROVAL_MS, jobId: `payout-change-expire-${change.id}`, attempts: 1 });
    bus.emit('group.payoutChange', { changeId: change.id as string, stage: 'proposed' });
    return this.detail(groupId, userId);
  },

  async approvePayoutChange(groupId: string, userId: string, pin: string) {
    await PinService.verify(userId, pin);
    const group = await asExecutive(groupId, userId);
    assertOpen(group);
    const approved = await GroupPayoutChangeModel.findOneAndUpdate(
      { group: group._id, status: 'awaiting_approval', expiresAt: { $gt: new Date() }, cosigners: { $elemMatch: { user: userId, approvedAt: null } } },
      { $set: { 'cosigners.$.approvedAt': new Date() } },
      { new: true },
    );
    if (!approved) throw conflict('There’s nothing waiting for your approval', 'NOTHING_TO_APPROVE');
    if (approved.cosigners.every((c) => c.approvedAt)) {
      const effectiveAt = new Date(Date.now() + PAYOUT_CHANGE_COOLING_OFF_MS);
      const cooling = await GroupPayoutChangeModel.findOneAndUpdate({ _id: approved._id, status: 'awaiting_approval' }, { status: 'cooling_off', effectiveAt }, { new: true });
      if (cooling) {
        await getQueue(GROUPS_QUEUE).add('payout-change.apply', { changeId: cooling.id }, { delay: PAYOUT_CHANGE_COOLING_OFF_MS, jobId: `payout-change-apply-${cooling.id}`, attempts: 1 });
        bus.emit('group.payoutChange', { changeId: cooling.id as string, stage: 'cooling_off' });
      }
    }
    return this.detail(groupId, userId);
  },

  /** Any executive, co-signer or not, can stop it before it takes effect. So can the owner. */
  async objectToPayoutChange(groupId: string, userId: string, reason: string) {
    const group = await asExecutive(groupId, userId);
    const closed = await GroupPayoutChangeModel.findOneAndUpdate(
      { group: group._id, status: { $in: ['awaiting_approval', 'cooling_off'] } },
      { status: 'rejected', closedBy: userId, closedReason: reason, closedAt: new Date() },
      { new: true },
    );
    if (!closed) throw conflict('There’s no payout account change to stop', 'NO_PAYOUT_CHANGE');
    bus.emit('group.payoutChange', { changeId: closed.id as string, stage: 'rejected' });
    return this.detail(groupId, userId);
  },

  /** The delayed job, and the sweep's safety net: lapse what wasn't approved in time. */
  async expirePayoutChange(changeId: string) {
    const lapsed = await GroupPayoutChangeModel.findOneAndUpdate(
      { _id: changeId, status: 'awaiting_approval', expiresAt: { $lte: new Date() } },
      { status: 'expired', closedAt: new Date() },
      { new: true },
    );
    if (lapsed) bus.emit('group.payoutChange', { changeId, stage: 'expired' });
  },

  /** Cooling-off passed with no objection: the new account is the group's, and members accept it before paying again. */
  async applyPayoutChange(changeId: string) {
    // A suspended group's account doesn't move; the sweep applies it once Tela lifts the suspension.
    const pending = await GroupPayoutChangeModel.findById(changeId).select('group').lean();
    if (pending && (await GroupModel.exists({ _id: pending.group, 'suspended.at': { $exists: true } }))) return;
    const applied = await inTransaction(async (session) => {
      const change = await GroupPayoutChangeModel.findOneAndUpdate(
        { _id: changeId, status: 'cooling_off', effectiveAt: { $lte: new Date() } },
        { status: 'applied', closedAt: new Date() },
        { new: true, session },
      );
      if (!change) return null;
      const moved = await GroupModel.updateOne(
        // Compare-and-set on the account it replaces, so nothing else slipped in between.
        { _id: change.group, 'payout.accountNumber': change.from.accountNumber, 'payout.bankCode': change.from.bankCode },
        { payout: change.to, $inc: { termsVersion: 1 } },
        { session },
      );
      if (moved.modifiedCount === 0) throw conflict('The group’s payout account changed some other way', 'PAYOUT_ACCOUNT_CHANGED');
      return change;
    });
    if (applied) bus.emit('group.payoutChange', { changeId, stage: 'applied' });
  },

  async sweepPayoutChanges() {
    const now = new Date();
    const [lapsing, due] = await Promise.all([
      GroupPayoutChangeModel.find({ status: 'awaiting_approval', expiresAt: { $lte: now } }).select('_id').limit(100),
      GroupPayoutChangeModel.find({ status: 'cooling_off', effectiveAt: { $lte: now } }).select('_id').limit(100),
    ]);
    for (const c of lapsing) await this.expirePayoutChange(c.id as string).catch((err) => console.error(`[groups] expire ${c.id}`, err));
    for (const c of due) await this.applyPayoutChange(c.id as string).catch((err) => console.error(`[groups] apply ${c.id}`, err));
  },
};
