import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { unprocessable } from '../../lib/errors';
import { IdParamsSchema } from '../../lib/schemas';
import { parse, send } from '../../lib/response';
import { requireActor, requireRole } from '../../plugins/auth';
import { auditAdminAction, requireActiveAdmin } from '../admins/admins.guard';
import {
  BankAccountSchema,
  BuyTicketsSchema,
  CreateEventSchema,
  EventCodeParamsSchema,
  EventListQuerySchema,
  FeesQuerySchema,
  AdminEventsQuerySchema,
  AdminSellersQuerySchema,
  SellerDocumentParamsSchema,
  SellerDocumentQuerySchema,
  SellerIdTypeSchema,
  SellerReviewSchema,
  SellerSuspensionSchema,
  MediaParamsSchema,
  OptInSchema,
  PayoutSchema,
  RateEventSchema,
  ScanSchema,
  StaffParamsSchema,
  StaffSchema,
  UpdateEventSchema,
  UpdateSellerSchema,
  VerifyBankSchema,
  WithdrawSchema,
} from './tickets.schema';
import { AVATAR_MAX_BYTES } from '../users/avatars.service';
import { TicketsService, VIDEO_MAX_BYTES } from './tickets.service';
import { SellerReviewService } from './seller-review.service';
import { requireFeature } from '../config/config.routes';

/** `/api/events` — what's on sale, and the organiser's own events. */
export async function eventsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => {
    const { search } = parse(EventListQuerySchema, req.query);
    return send(reply, await TicketsService.listEvents(search));
  });

  app.post('/', { preHandler: requireFeature('ticket_selling'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await TicketsService.createEvent(req.user.sub, parse(CreateEventSchema, req.body)), 201),
  );

  app.get('/mine', async (req, reply) => send(reply, await TicketsService.myEvents(req.user.sub)));

  /** What a share link opens. */
  app.get('/code/:code', async (req, reply) => {
    const { code } = parse(EventCodeParamsSchema, req.params);
    return send(reply, await TicketsService.eventByCode(code));
  });

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await TicketsService.event(id));
  });

  app.get('/:id/manage', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await TicketsService.ownerEvent(req.user.sub, id));
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await TicketsService.updateEvent(req.user.sub, id, parse(UpdateEventSchema, req.body)));
  });

  app.post('/:id/image', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const file = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch(() => undefined);
    if (!file) throw unprocessable('Choose an image to upload', 'PHOTO_MISSING');
    const buffer = await file.toBuffer().catch(() => {
      throw unprocessable('Use an image under 5MB', 'PHOTO_TOO_LARGE');
    });
    return send(reply, await TicketsService.setEventImage(req.user.sub, id, buffer));
  });

  app.post('/:id/gallery', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const file = await req.file({ limits: { fileSize: VIDEO_MAX_BYTES, files: 1 } }).catch(() => undefined);
    if (!file) throw unprocessable('Choose a photo or video to upload', 'MEDIA_MISSING');
    const buffer = await file.toBuffer().catch(() => {
      throw unprocessable('Use a video under 50MB', 'MEDIA_TOO_LARGE');
    });
    return send(reply, await TicketsService.addMedia(req.user.sub, id, buffer));
  });

  app.delete('/:id/gallery/:mediaId', async (req, reply) => {
    const { id, mediaId } = parse(MediaParamsSchema, req.params);
    return send(reply, await TicketsService.removeMedia(req.user.sub, id, mediaId));
  });

  /** Who bought what, for the organiser only. */
  app.get('/:id/sales', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await TicketsService.sales(req.user.sub, id));
  });

  app.post('/:id/staff', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const { username } = parse(StaffSchema, req.body);
    return send(reply, await TicketsService.addStaff(req.user.sub, id, username));
  });

  app.delete('/:id/staff/:userId', async (req, reply) => {
    const { id, userId } = parse(StaffParamsSchema, req.params);
    return send(reply, await TicketsService.removeStaff(req.user.sub, id, userId));
  });

  /** Someone who was there, once their ticket was scanned. Rating again replaces the old one. */
  app.put('/:id/rating', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const { stars } = parse(RateEventSchema, req.body);
    return send(reply, await TicketsService.rate(req.user.sub, id, stars));
  });

  /** Only the organiser and their door staff, and only for this event. */
  app.post('/:id/scan', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const { code } = parse(ScanSchema, req.body);
    return send(reply, await TicketsService.scan(req.user.sub, id, code));
  });
}

/** `/api/tickets` — what the user bought. Quote with POST /api/quotes { kind: 'ticket' }. */
export async function ticketsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await TicketsService.myTickets(req.user.sub)));

  app.post('/purchases', { preHandler: requireFeature('tickets'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { quoteId, pin, holders } = parse(BuyTicketsSchema, req.body);
    return send(reply, await TicketsService.buy(req.user.sub, quoteId, pin, holders), 201);
  });

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await TicketsService.ticket(req.user.sub, id));
  });

  app.post('/:id/refund', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await TicketsService.refund(req.user.sub, id));
  });
}

/** `/api/seller` — opting in, and the ticket wallet. */
export async function sellerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await TicketsService.seller(req.user.sub)));

  app.post('/', { preHandler: requireFeature('ticket_selling'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await TicketsService.optIn(req.user.sub, parse(OptInSchema, req.body))),
  );

  /** A rename shows on every event and ticket at once, past ones included. */
  app.patch('/', async (req, reply) => send(reply, await TicketsService.updateSeller(req.user.sub, parse(UpdateSellerSchema, req.body))));

  app.post('/logo', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch(() => undefined);
    if (!file) throw unprocessable('Choose an image to upload', 'PHOTO_MISSING');
    const buffer = await file.toBuffer().catch(() => {
      throw unprocessable('Use an image under 5MB', 'PHOTO_TOO_LARGE');
    });
    return send(reply, await TicketsService.setLogo(req.user.sub, buffer));
  });

  /**
   * Who they are, for compliance: multipart with `idType`, then the files `photo` (of them) and
   * `id` (of the document). Both are checked by their bytes and stored encrypted.
   */
  app.post('/verification', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const files: Partial<Record<'photo' | 'id', Buffer>> = {};
    let idType: unknown;
    try {
      for await (const part of req.parts({ limits: { fileSize: AVATAR_MAX_BYTES, files: 2, fields: 4 } })) {
        if (part.type === 'file' && (part.fieldname === 'photo' || part.fieldname === 'id')) files[part.fieldname] = await part.toBuffer();
        else if (part.type === 'file') await part.toBuffer();
        else if (part.fieldname === 'idType') idType = part.value;
      }
    } catch {
      throw unprocessable('Use images under 5MB', 'PHOTO_TOO_LARGE');
    }
    if (!files.photo) throw unprocessable('Add a photo of yourself', 'PHOTO_MISSING');
    if (!files.id) throw unprocessable('Add a photo of your ID', 'ID_PHOTO_MISSING');
    const type = parse(SellerIdTypeSchema, idType);
    return send(reply, await SellerReviewService.submit(req.user.sub, { idType: type, photo: files.photo, id: files.id }), 201);
  });

  app.get('/fees', async (req, reply) => {
    const { price } = parse(FeesQuerySchema, req.query);
    return send(reply, await TicketsService.fees(price));
  });

  app.get('/banks', async (_req, reply) => send(reply, await TicketsService.banks()));

  app.post('/bank-account/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { bankCode, accountNumber } = parse(VerifyBankSchema, req.body);
    return send(reply, await TicketsService.verifyBankAccount(bankCode, accountNumber));
  });

  app.put('/bank-account', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await TicketsService.setBankAccount(req.user.sub, parse(BankAccountSchema, req.body))),
  );

  /** To their bank. Quote with POST /api/quotes { kind: 'ticket_payout', amount }. */
  app.post('/payouts', { preHandler: requireFeature('ticket_payouts'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { quoteId, pin } = parse(PayoutSchema, req.body);
    return send(reply, await TicketsService.payout(req.user.sub, quoteId, pin), 201);
  });

  /** To their bill payment wallet. It stays there: wallet money can't be sent to a bank. */
  app.post('/withdrawals', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { amount, pin, idempotencyKey } = parse(WithdrawSchema, req.body);
    return send(reply, await TicketsService.withdraw(req.user.sub, amount, pin, idempotencyKey), 201);
  });
}

/** `/api/organisers` — an organiser's public page. */
export async function organisersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await TicketsService.organiser(id, req.user.sub));
  });
}

/** `/api/admin/sellers` — reviewing organisers, and suspending them. Ids are the organiser's user id. */
export async function adminSellersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', { preHandler: requireRole('compliance', 'support', 'finance') }, async (req, reply) =>
    send(reply, await SellerReviewService.list(parse(AdminSellersQuerySchema, req.query))),
  );

  app.get('/:id', { preHandler: requireRole('compliance', 'support', 'finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SellerReviewService.detail(id));
  });

  /** The image itself, decrypted. POST and no-store, so it stays out of URLs, history and caches. */
  app.post('/:id/documents/:kind', { preHandler: requireRole('compliance'), config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { id, kind } = parse(SellerDocumentParamsSchema, req.params);
    const { submission } = parse(SellerDocumentQuerySchema, req.query);
    const doc = await SellerReviewService.document(id, kind, { admin: req.user.sub, role: req.user.role, ip: req.ip }, submission);
    return reply.header('cache-control', 'no-store').type(doc.mimeType).send(doc.bytes);
  });

  app.post('/:id/review', { preHandler: requireRole('compliance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SellerReviewService.review(id, parse(SellerReviewSchema, req.body), req.user.sub));
  });

  app.post('/:id/suspension', { preHandler: requireRole('compliance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SellerReviewService.setSuspension(id, parse(SellerSuspensionSchema, req.body), req.user.sub));
  });
}

/** `/api/admin/events` — pausing sales on someone's event. */
export async function adminEventsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', { preHandler: requireRole('support', 'finance', 'compliance') }, async (req, reply) =>
    send(reply, await TicketsService.adminEvents(parse(AdminEventsQuerySchema, req.query))),
  );

  app.post('/:id/sales', { preHandler: requireRole('support', 'finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const { paused } = parse(z.object({ paused: z.boolean() }), req.body);
    return send(reply, await TicketsService.adminPause(id, paused));
  });
}
