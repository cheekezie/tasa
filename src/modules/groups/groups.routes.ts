import type { FastifyInstance } from 'fastify';
import { IdParamsSchema } from '../../lib/schemas';
import { unprocessable } from '../../lib/errors';
import { parse, send } from '../../lib/response';
import { AVATAR_MAX_BYTES } from '../users/avatars.service';
import { requireActor, requireRole } from '../../plugins/auth';
import { auditAdminAction, requireActiveAdmin } from '../admins/admins.guard';
import { requireFeature } from '../config/config.routes';
import {
  AdminGroupsQuerySchema,
  GroupSuspensionSchema,
  AcceptTermsSchema,
  AddExecutiveSchema,
  DueParamsSchema,
  DueReportQuerySchema,
  DueSchema,
  ApprovePayoutChangeSchema,
  BackfillSchema,
  CreateGroupSchema,
  ExecutiveParamsSchema,
  JoinCodeParamsSchema,
  JoinGroupSchema,
  MemberParamsSchema,
  MembersQuerySchema,
  ObjectPayoutChangeSchema,
  PayQuoteSchema,
  ProposePayoutChangeSchema,
  UpdateGroupSchema,
  UpdateDueSchema,
} from './groups.schema';
import { GroupsAdminService } from './groups.admin';
import { dueReportWorkbook } from './groups.export';
import { GroupsService } from './groups.service';

/**
 * `/api/groups` — groups people pay dues to. Members join by invite code and accept the terms
 * (which name the payout account); executives run members, dues and withdrawals. Paying is
 * priced with `POST /api/quotes { kind: 'group_dues' }`, withdrawals with `{ kind: 'group_payout' }`.
 */
export async function groupsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await GroupsService.mine(req.user.sub)));

  app.post('/', { preHandler: requireFeature('groups'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await GroupsService.create(req.user.sub, parse(CreateGroupSchema, req.body)), 201),
  );

  // Codes are short, so guessing them is throttled.
  app.get('/join/:code', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { code } = parse(JoinCodeParamsSchema, req.params);
    return send(reply, await GroupsService.preview(code));
  });

  app.post('/join', { preHandler: requireFeature('groups'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await GroupsService.join(req.user.sub, parse(JoinGroupSchema, req.body)), 201),
  );

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.detail(id, req.user.sub));
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.update(id, req.user.sub, parse(UpdateGroupSchema, req.body)));
  });

  app.post('/:id/logo', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const file = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch(() => undefined);
    if (!file) throw unprocessable('Choose an image to upload', 'PHOTO_MISSING');
    const buffer = await file.toBuffer().catch(() => {
      throw unprocessable('Use an image under 5MB', 'PHOTO_TOO_LARGE');
    });
    return send(reply, await GroupsService.setLogo(id, req.user.sub, buffer));
  });

  app.post('/:id/terms', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.acceptTerms(id, req.user.sub, parse(AcceptTermsSchema, req.body).acceptTerms));
  });

  // ── Dues (what the group collects) ──
  app.post('/:id/dues', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.addDue(id, req.user.sub, parse(DueSchema, req.body)), 201);
  });

  app.patch('/:id/dues/:dueId', async (req, reply) => {
    const { id, dueId } = parse(DueParamsSchema, req.params);
    parse(UpdateDueSchema, req.body);
    return send(reply, await GroupsService.endDue(id, req.user.sub, dueId));
  });

  // The same report as an Excel file, every member on one sheet.
  app.get('/:id/dues/:dueId/report.xlsx', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id, dueId } = parse(DueParamsSchema, req.params);
    const { year, search } = parse(DueReportQuerySchema, req.query);
    const { buffer, filename } = await dueReportWorkbook(id, req.user.sub, dueId, { year, search });
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  app.get('/:id/dues/:dueId/report', async (req, reply) => {
    const { id, dueId } = parse(DueParamsSchema, req.params);
    return send(reply, await GroupsService.dueReport(id, req.user.sub, dueId, parse(DueReportQuerySchema, req.query)));
  });

  app.post('/:id/invite-code', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.rotateInviteCode(id, req.user.sub));
  });

  // ── Members ──
  app.get('/:id/members', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.members(id, req.user.sub, parse(MembersQuerySchema, req.query)));
  });

  app.get('/:id/members/:memberId', async (req, reply) => {
    const { id, memberId } = parse(MemberParamsSchema, req.params);
    return send(reply, await GroupsService.member(id, req.user.sub, memberId));
  });

  app.post('/:id/members/:memberId/approve', async (req, reply) => {
    const { id, memberId } = parse(MemberParamsSchema, req.params);
    return send(reply, await GroupsService.decide(id, req.user.sub, memberId, true));
  });

  app.post('/:id/members/:memberId/reject', async (req, reply) => {
    const { id, memberId } = parse(MemberParamsSchema, req.params);
    return send(reply, await GroupsService.decide(id, req.user.sub, memberId, false));
  });

  app.post('/:id/members/:memberId/backfill', async (req, reply) => {
    const { id, memberId } = parse(MemberParamsSchema, req.params);
    return send(reply, await GroupsService.backfill(id, req.user.sub, memberId, parse(BackfillSchema, req.body)));
  });

  app.delete('/:id/members/:memberId', async (req, reply) => {
    const { id, memberId } = parse(MemberParamsSchema, req.params);
    return send(reply, await GroupsService.remove(id, req.user.sub, memberId));
  });

  // ── Executives ──
  app.post('/:id/executives', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.addExecutive(id, req.user.sub, parse(AddExecutiveSchema, req.body).username), 201);
  });

  app.delete('/:id/executives/:userId', async (req, reply) => {
    const { id, userId } = parse(ExecutiveParamsSchema, req.params);
    return send(reply, await GroupsService.removeExecutive(id, req.user.sub, userId));
  });

  // ── Money ──
  app.post('/:id/pay', { preHandler: requireFeature('groups') }, async (req, reply) => {
    const { quoteId, pin } = parse(PayQuoteSchema, req.body);
    return send(reply, await GroupsService.payDues(req.user.sub, quoteId, pin), 201);
  });

  app.get('/:id/withdrawals', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.withdrawals(id, req.user.sub));
  });

  app.post('/:id/withdrawals', { preHandler: requireFeature('group_payouts') }, async (req, reply) => {
    const { quoteId, pin } = parse(PayQuoteSchema, req.body);
    return send(reply, await GroupsService.payout(req.user.sub, quoteId, pin), 201);
  });

  // ── Changing where the money goes ──
  app.post('/:id/payout-change', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.proposePayoutChange(id, req.user.sub, parse(ProposePayoutChangeSchema, req.body)), 201);
  });

  app.post('/:id/payout-change/approve', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.approvePayoutChange(id, req.user.sub, parse(ApprovePayoutChangeSchema, req.body).pin));
  });

  app.post('/:id/payout-change/object', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsService.objectToPayoutChange(id, req.user.sub, parse(ObjectPayoutChangeSchema, req.body).reason));
  });
}

/**
 * `/api/public/groups` — no sign-in: the website's invite page (`/g/:code`) shows who's inviting
 * before the app opens. Name and picture only; codes are throttled like the app's preview.
 */
export async function publicGroupsRoutes(app: FastifyInstance) {
  app.get('/:code', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { code } = parse(JoinCodeParamsSchema, req.params);
    reply.header('Cache-Control', 'public, max-age=60');
    return send(reply, await GroupsService.publicPreview(code));
  });
}

/** `/api/admin/groups` — what groups hold and who runs them; compliance and support can suspend one. */
export async function adminGroupsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', { preHandler: requireRole('compliance', 'support', 'finance') }, async (req, reply) =>
    send(reply, await GroupsAdminService.list(parse(AdminGroupsQuerySchema, req.query))),
  );

  app.get('/:id', { preHandler: requireRole('compliance', 'support', 'finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsAdminService.detail(id));
  });

  app.post('/:id/suspension', { preHandler: requireRole('compliance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await GroupsAdminService.setSuspension(id, parse(GroupSuspensionSchema, req.body), req.user.sub));
  });
}
