import type { FastifyInstance } from 'fastify';
import type { FilterQuery } from 'mongoose';
import { z } from 'zod';
import { inTransaction, searchRegex } from '../../lib/db';
import { notFound, unprocessable } from '../../lib/errors';
import { paginate, parse, send } from '../../lib/response';
import { IdParamsSchema, ObjectIdSchema, PaginationQuerySchema } from '../../lib/schemas';
import { requireActor, requireRole } from '../../plugins/auth';
import { BillsService } from '../bills/bills.service';
import { PAYOUT_KINDS, TicketsService } from '../tickets/tickets.service';
import { biller } from '../bills/providers';
import { ChargePreviewSchema, ChargeRuleInputSchema, ChargeRuleUpdateSchema } from '../charges/charges.schema';
import { ChargesService } from '../charges/charges.service';
import { LedgerService, Accounts } from '../ledger/ledger.service';
import { UpdatePointsSettingsSchema } from '../points/points.schema';
import { PointsService } from '../points/points.service';
import { LedgerEntryModel } from '../ledger/models/ledger-entry.model';
import { CollectionsService } from '../wallet/collections.service';
import { auditAdminAction, requireActiveAdmin } from './admins.guard';
import { AdminAuditModel } from './models/admin-audit.model';
import { AdminsService, adminNames } from './admins.service';
import { ADMIN_ROLES } from './models/admin.model';

const StrongPassword = z.string().min(12, 'Use at least 12 characters');
const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
import { TRANSACTION_KINDS, TRANSACTION_STATUSES, TransactionModel, type ITransaction } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { GuestOrderModel } from '../guest/models/guest-order.model';
import { UserModel, type IUser } from '../users/models/user.model';
import { toProfile, UsersService } from '../users/users.service';
import { WebhookEventModel } from '../webhooks/models/webhook-event.model';
import { WebhooksService } from '../webhooks/webhooks.service';
import { DAY_RE, lagosDay } from '../../lib/lagos';
import { staffUserLabels } from '../users/users.service';
import { formatNaira } from '../../lib/money';

/**
 * `/api/admin/*` — back office. Roles: `super_admin` (everything, incl. staff), `finance`
 * (money: charges, promos, giveaways, resolving bills, reports), `support` (users, requeries),
 * `compliance` (BVN review).
 */
export async function adminsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  // ── Staff ─────────────────────────────────────────────────────────────
  app.get('/me', async (req, reply) => send(reply, await AdminsService.me(req.user.sub)));

  app.post('/me/password', async (req, reply) => {
    const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1), newPassword: StrongPassword }), req.body);
    await AdminsService.changePassword(req.user.sub, currentPassword, newPassword);
    return send(reply, { changed: true }, 200, 'Password changed. Sign in again with your new password');
  });

  app.get('/staff', { preHandler: requireRole('super_admin') }, async (_req, reply) => send(reply, await AdminsService.list()));

  app.post('/staff', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(60), email: z.string().trim().toLowerCase().email(), role: z.enum(ADMIN_ROLES), password: StrongPassword }),
      req.body,
    );
    return send(reply, await AdminsService.create(body), 201);
  });

  app.patch('/staff/:id', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const changes = parse(
      z.object({ name: z.string().trim().min(2).max(60), role: z.enum(ADMIN_ROLES), isActive: z.boolean() }).partial(),
      req.body,
    );
    return send(reply, await AdminsService.update(req.user.sub, id, changes));
  });

  app.post('/staff/:id/password', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const { password } = parse(z.object({ password: StrongPassword }), req.body);
    await AdminsService.resetPassword(id, password);
    return send(reply, { reset: true });
  });

  /** Every back-office change, newest first. Finance and super admins review it. */
  app.get('/audit', { preHandler: requireRole('finance') }, async (req, reply) => {
    const q = parse(PaginationQuerySchema.extend({ admin: ObjectIdSchema.optional() }), req.query);
    const filter = q.admin ? { admin: q.admin } : {};
    const [items, total] = await Promise.all([
      AdminAuditModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      AdminAuditModel.countDocuments(filter),
    ]);
    const names = await adminNames(items.map((i) => i.admin));
    const rows = items.map(({ _id, admin, ...rest }) => ({ ...rest, id: _id.toString(), admin: admin.toString(), adminName: names.get(admin.toString()) ?? null }));
    return send(reply, paginate(rows, total, q.page, q.limit));
  });

  // ── Points ────────────────────────────────────────────────────────────
  app.get('/points', async (_req, reply) => send(reply, await PointsService.adminSummary()));

  /** Every user's points. Any admin, like the points summary. */
  app.get('/points/balances', async (req, reply) => {
    const q = parse(
      PaginationQuerySchema.extend({ search: z.string().trim().min(2).max(60).optional(), sort: z.enum(['balance', 'earned']).default('balance') }),
      req.query,
    );
    return send(reply, await PointsService.adminBalances(q));
  });

  /** One user's points and their history, newest first. */
  app.get('/users/:id/points', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const q = parse(PaginationQuerySchema, req.query);
    const [summary, history] = await Promise.all([PointsService.summary(id), PointsService.history(id, q.page, q.limit)]);
    return send(reply, { ...summary, history });
  });

  app.patch('/points', { preHandler: requireRole('finance') }, async (req, reply) =>
    send(reply, await PointsService.updateSettings(parse(UpdatePointsSettingsSchema, req.body))),
  );

  // ── Charges ───────────────────────────────────────────────────────────
  app.get('/charges', async (_req, reply) => send(reply, await ChargesService.list()));

  /** "What would a ₦10,000 electricity bill cost right now?" */
  app.get('/charges/preview', async (req, reply) => {
    const q = parse(ChargePreviewSchema, req.query);
    const { charges, fee } = await ChargesService.compute({ scope: q.scope, serviceId: q.serviceId, provider: q.provider }, q.amount);
    return send(reply, { amount: q.amount, charges, fee, total: q.amount + fee });
  });

  app.post('/charges', { preHandler: requireRole('finance') }, async (req, reply) =>
    send(reply, await ChargesService.create(parse(ChargeRuleInputSchema, req.body), req.user.sub), 201),
  );

  app.patch('/charges/:id', { preHandler: requireRole('finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await ChargesService.update(id, parse(ChargeRuleUpdateSchema, req.body), req.user.sub));
  });

  app.delete('/charges/:id', { preHandler: requireRole('finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    await ChargesService.remove(id);
    return send(reply, { deleted: true });
  });

  // ── Transactions ──────────────────────────────────────────────────────
  app.get('/transactions', async (req, reply) => {
    const q = parse(
      PaginationQuerySchema.extend({
        status: z.enum(TRANSACTION_STATUSES).optional(),
        kind: z.enum(TRANSACTION_KINDS).optional(),
        needsReview: z.enum(['true', 'false']).optional(),
        /** `app` (signed in) or `web` (paid on the website without the app). */
        channel: z.enum(['app', 'web']).optional(),
        user: ObjectIdSchema.optional(),
        reference: z.string().optional(),
        /** A Lagos day (YYYY-MM-DD, inclusive, like the reports) or an exact ISO time. */
        from: z.string().trim().optional(),
        to: z.string().trim().optional(),
      }),
      req.query,
    );
    const instant = (v: string) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw unprocessable(`"${v}" isn't a date`, 'INVALID_DATE');
      return d;
    };
    const from = q.from ? (DAY_RE.test(q.from) ? lagosDay(q.from) : instant(q.from)) : undefined;
    // A bare day means all of it: up to, not including, the next Lagos midnight.
    const to = q.to ? (DAY_RE.test(q.to) ? { $lt: new Date(lagosDay(q.to).getTime() + 86_400_000) } : { $lte: instant(q.to) }) : undefined;
    const filter: FilterQuery<ITransaction> = {};
    if (q.status) filter.status = q.status;
    if (q.kind) filter.kind = q.kind;
    if (q.needsReview) filter.needsReview = q.needsReview === 'true';
    if (q.user) filter.user = q.user;
    if (q.channel) filter.channel = q.channel === 'web' ? 'web' : { $exists: false };
    if (q.reference) {
      // A website order's reference (TSY…, or TLY… from before the rename) finds its transfer and its bill.
      const ref = q.reference.toUpperCase();
      const order = /^T[SL]Y/.test(ref) ? await GuestOrderModel.findOne({ reference: ref }).select('_id') : null;
      if (order) filter.guestOrder = order._id;
      else filter.reference = ref;
    }
    if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...to };
    const [items, total] = await Promise.all([
      TransactionModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      TransactionModel.countDocuments(filter),
    ]);
    const names = await staffUserLabels(items.map((t) => t.user));
    return send(
      reply,
      paginate(
        items.map((t) => ({
          ...toTransactionDto(t),
          user: t.user.toString(),
          userName: names.get(t.user.toString())?.name ?? null,
          needsReview: t.needsReview,
          channel: t.channel ?? 'app',
        })),
        total,
        q.page,
        q.limit,
      ),
    );
  });

  app.get('/transactions/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const tx = await TransactionModel.findById(id);
    if (!tx) throw notFound('Transaction not found');
    const [ledger, order] = await Promise.all([
      LedgerEntryModel.find({ transaction: tx._id }).sort({ createdAt: 1 }),
      tx.guestOrder ? GuestOrderModel.findById(tx.guestOrder).lean() : null,
    ]);
    return send(reply, {
      ...toTransactionDto(tx),
      channel: tx.channel ?? 'app',
      /** A website order: who it's for, what it bought, how it ended, and its other transaction. */
      guestOrder: order
        ? {
            reference: order.reference,
            status: order.status,
            phone: order.phone,
            email: order.email ?? null,
            bill: order.bill,
            amount: order.amount,
            fee: order.fee,
            total: order.total,
            failureReason: order.failureReason ?? null,
            payAttempts: order.payAttempts,
            fundingTransactionId: order.funding.toString(),
            billTransactionId: order.billTransaction?.toString() ?? null,
            createdAt: order.createdAt.toISOString(),
          }
        : null,
      user: tx.user.toString(),
      needsReview: tx.needsReview,
      vendAttempts: tx.vendAttempts,
      providerData: tx.providerData ?? null,
      events: tx.events,
      ledger: ledger.map((l) => ({ posting: l.posting, account: l.account, amount: l.amount, memo: l.memo, at: l.createdAt })),
    });
  });

  app.post('/transactions/:id/requery', { preHandler: requireRole('finance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const tx = await TransactionModel.findById(id);
    if (!tx || tx.kind !== 'bill') throw notFound('Bill not found');
    if (tx.status !== 'pending') throw unprocessable('Only pending bills can be requeried', 'NOT_PENDING');
    await BillsService.requery(id, 99); // past the retry schedule: no further automatic requeries
    return send(reply, toTransactionDto((await TransactionModel.findById(id))!));
  });

  /**
   * Final word on a stuck bill (after checking with VTpass) or ticket payout (with SaySwitch).
   * `delivered` settles it; `failed` refunds the user, or returns a payout to the ticket wallet.
   */
  app.post('/transactions/:id/resolve', { preHandler: requireRole('finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const body = parse(
      z.object({
        outcome: z.enum(['delivered', 'failed']),
        token: z.string().trim().optional(),
        /** Kobo VTpass actually kept (its `total_amount`), at most the face value. Without it, no commission is booked. */
        cost: z.number().int().positive().optional(),
        note: z.string().trim().min(5).max(300),
      }),
      req.body,
    );
    const tx = await TransactionModel.findById(id);
    if (tx && (PAYOUT_KINDS as readonly string[]).includes(tx.kind)) {
      if (tx.status !== 'pending') throw unprocessable('This payout is already settled', 'NOT_PENDING');
      // `delivered` = the bank received it; `failed` = it never left, so it goes back where it came from.
      const done = await TicketsService.applyPayoutResult(
        tx._id,
        {
          outcome: body.outcome === 'delivered' ? 'success' : 'failed',
          message: `Resolved by ${(await adminNames([req.user.sub])).get(req.user.sub) ?? 'admin'} (${req.user.sub}): ${body.note}`,
        },
        'admin',
      );
      return send(reply, toTransactionDto(done));
    }
    if (!tx || tx.kind !== 'bill') throw notFound('Bill not found');
    if (tx.status !== 'pending') throw unprocessable('This bill is already settled', 'NOT_PENDING');
    // VTpass keeps at most the face value; more would book a negative commission.
    if (body.cost !== undefined && body.cost > tx.amount) {
      throw unprocessable(`VTpass can't have kept more than the bill's ${formatNaira(tx.amount)}`, 'COST_TOO_HIGH');
    }
    const done = await BillsService.applyVendResult(
      tx._id,
      {
        outcome: body.outcome,
        token: body.token,
        ...(body.outcome === 'delivered' && body.cost !== undefined && { cost: body.cost }),
        message: `Resolved by ${(await adminNames([req.user.sub])).get(req.user.sub) ?? 'admin'} (${req.user.sub}): ${body.note}`,
      },
      'admin',
    );
    return send(reply, toTransactionDto(done));
  });

  /**
   * A transfer into a permanent account that never got credited (missed webhook): find it in
   * the SaySwitch dashboard from the user's receipt and enter its reference. SaySwitch is
   * asked again and says whose account it was; it can only ever be credited once.
   */
  app.post('/collections', { preHandler: requireRole('finance', 'support') }, async (req, reply) => {
    const { reference } = parse(z.object({ reference: z.string().trim().min(4).max(64) }), req.body);
    return send(reply, await CollectionsService.collect(reference));
  });

  // ── Users ─────────────────────────────────────────────────────────────
  app.get('/users', async (req, reply) => {
    const q = parse(
      PaginationQuerySchema.extend({
        search: z.string().trim().min(2).optional(),
        bvnStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
        status: z.enum(['active', 'suspended', 'closed']).optional(),
      }),
      req.query,
    );
    const filter: FilterQuery<IUser> = { ...(q.bvnStatus && { bvnStatus: q.bvnStatus }), ...(q.status && { status: q.status }) };
    if (q.search) {
      filter.$or = [{ phone: searchRegex(q.search) }, { username: searchRegex(q.search) }, { email: searchRegex(q.search) }, { fullName: searchRegex(q.search) }];
    }
    const [items, total] = await Promise.all([
      UserModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      UserModel.countDocuments(filter),
    ]);
    return send(reply, paginate(items.map((u) => ({ ...toProfile(u), status: u.status })), total, q.page, q.limit));
  });

  app.get('/users/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const user = await UserModel.findById(id).select('+pinHash');
    if (!user) throw notFound('User not found');
    return send(reply, {
      ...toProfile(user),
      status: user.status,
      wallet: await LedgerService.checkWallet(id),
    });
  });

  /** POST, so the number stays out of URLs and caches. Compliance and super admins only. */
  app.post(
    '/users/:id/bvn/reveal',
    { preHandler: requireRole('compliance'), config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const { id } = parse(IdParamsSchema, req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(200) }), req.body);
      const revealed = await UsersService.revealBvn(id, { admin: req.user.sub, role: req.user.role, ip: req.ip, reason });
      return send(reply.header('cache-control', 'no-store'), revealed);
    },
  );

  /** Manual BVN review: approving can also set the legal name, which then locks. */
  app.post('/users/:id/bvn', { preHandler: requireRole('compliance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const body = parse(
      z.discriminatedUnion('status', [
        z.object({ status: z.literal('verified'), fullName: z.string().trim().min(2).max(80).optional() }),
        z.object({ status: z.literal('rejected'), reason: z.string().trim().min(5).max(200) }),
      ]),
      req.body,
    );
    return send(reply, await UsersService.reviewBvn(id, body));
  });

  app.post('/users/:id/status', { preHandler: requireRole('support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const { status } = parse(z.object({ status: z.enum(['active', 'suspended']) }), req.body);
    return send(reply, await UsersService.setStatus(id, status));
  });

  // ── Books ─────────────────────────────────────────────────────────────
  /**
   * Balance sheet, raw ledger signs (assets +, owed −). `provider:*` should match each
   * provider's real balance; profit and loss lives in /api/admin/reports/pnl.
   */
  app.get('/ledger/summary', { preHandler: requireRole('finance') }, async (_req, reply) => {
    // Every root, so the groups sum to zero like the books do.
    const roots = [
      'provider:sayswitch',
      'provider:vtpass',
      'bills:in_flight',
      'payouts:in_flight',
      'wallet:',
      'tickets:',
      'coupon:',
      'revenue:',
      'expense:',
      'equity:',
      'liability:',
    ];
    const totals = await Promise.all(roots.map(async (r) => [r.endsWith(':') ? `${r}*` : r, sum(await LedgerService.sumsByAccount(r))] as const));
    return send(reply, Object.fromEntries(totals));
  });

  /**
   * Bills are paid from the prepaid VTpass wallet. Compare what VTpass says we have with
   * what our books say — a gap means a top-up wasn't recorded, or a vend we don't know about.
   */
  app.get('/ledger/vtpass', { preHandler: requireRole('finance') }, async (_req, reply) => {
    // If VTpass can't answer, our side still shows; the comparison waits for it.
    const [actual, books] = await Promise.all([
      biller.balance().then(
        (balance) => ({ balance, error: null as string | null }),
        (err: Error) => ({ balance: null, error: err.message || 'VTpass did not answer' }),
      ),
      LedgerService.balance(Accounts.biller),
    ]);
    return send(reply, {
      vtpass: actual.balance,
      books,
      difference: actual.balance === null ? null : actual.balance - books,
      vtpassError: actual.error,
    });
  });

  /**
   * Records a VTpass wallet top-up made from SaySwitch (or an opening balance, `from: 'external'`).
   * The transfer itself happens in the providers' dashboards; this keeps the books in step.
   */
  app.post('/ledger/vtpass-topups', { preHandler: requireRole('finance') }, async (req, reply) => {
    const body = parse(
      z.object({
        amount: z.number().int().positive(),
        from: z.enum(['sayswitch', 'external']).default('sayswitch'),
        /** Kobo SaySwitch charged to send it (from SaySwitch only). A cost, and out of our SaySwitch balance. */
        fee: z.number().int().min(0).max(1_000_000).default(0),
        note: z.string().trim().min(5).max(200),
        /** Generated once per top-up by the client, so resubmitting can't record it twice. */
        idempotencyKey: z.string().trim().min(8).max(64),
      }),
      req.body,
    );
    const key = `topup:vtpass:${body.idempotencyKey}`;
    const posted = await inTransaction((session) =>
      LedgerService.post(
        {
          key,
          memo: `VTpass top-up from ${body.from} by admin ${req.user.sub}: ${body.note}`,
          lines: [
            { account: Accounts.biller, amount: body.amount },
            ...(body.from === 'sayswitch'
              ? [
                  { account: Accounts.collections, amount: -(body.amount + body.fee) },
                  ...(body.fee > 0 ? [{ account: Accounts.providerFees('topup'), amount: body.fee }] : []),
                ]
              : [{ account: 'equity:opening', amount: -body.amount }]),
          ],
        },
        session,
      ),
    );
    return send(reply, { posting: key, duplicate: !posted, books: await LedgerService.balance(Accounts.biller) }, posted ? 201 : 200);
  });

  // ── Webhooks ──────────────────────────────────────────────────────────
  app.get('/webhooks', async (req, reply) => {
    const q = parse(
      PaginationQuerySchema.extend({
        status: z.enum(['received', 'processed', 'ignored', 'failed']).optional(),
        provider: z.enum(['sayswitch', 'vtpass']).optional(),
      }),
      req.query,
    );
    const filter = { ...(q.status && { status: q.status }), ...(q.provider && { provider: q.provider }) };
    const [items, total] = await Promise.all([
      // Raw bodies carry customer details, so the list that support can see leaves them out.
      WebhookEventModel.find(filter).select('-rawBody').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      WebhookEventModel.countDocuments(filter),
    ]);
    const rows = items.map(({ _id, ...rest }) => ({ ...rest, id: _id.toString() }));
    return send(reply, paginate(rows, total, q.page, q.limit));
  });

  app.get('/webhooks/:id', { preHandler: requireRole('finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const event = await WebhookEventModel.findById(id).lean();
    if (!event) throw notFound('Webhook not found');
    const { _id, ...rest } = event;
    return send(reply, { ...rest, id: _id.toString() });
  });

  app.post('/webhooks/:id/replay', { preHandler: requireRole('finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    if (!(await WebhookEventModel.exists({ _id: id }))) throw notFound('Webhook not found');
    // A failure is saved on the event itself, so the reply is the event either way, same shape as GET.
    await WebhooksService.replay(id).catch(() => undefined);
    const { _id, ...rest } = (await WebhookEventModel.findById(id).lean())!;
    return send(reply, { ...rest, id: _id.toString() });
  });
}
