import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, send } from '../../lib/response';
import { IdParamsSchema, ObjectIdSchema, PaginationQuerySchema } from '../../lib/schemas';
import { requireActor, requireRole } from '../../plugins/auth';
import {
  AdminCouponListSchema,
  ConfirmQuoteSchema,
  CouponCodeSchema,
  CreatePromoSchema,
  TasaCouponSchema,
  UpdatePromoSchema,
} from './coupons.schema';
import { auditAdminAction, requireActiveAdmin } from '../admins/admins.guard';
import { CouponsService } from './coupons.service';
import { GiftInboxService } from './gift-inbox.service';
import { requireFeature } from '../config/config.routes';

/**
 * `/api/coupons`, `/api/gifts`, `/api/promotions`. Create a coupon or gift by quoting with
 * POST /api/quotes { kind: 'coupon' | 'gift' }, then confirming here with the quote and PIN.
 * Any code — coupon, gift or Tasa promo — is used by passing `couponCode` on a bill quote;
 * the API decides what it's worth.
 */
export async function couponsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => {
    const { page, limit } = parse(PaginationQuerySchema, req.query);
    return send(reply, await CouponsService.listMine(req.user.sub, page, limit));
  });

  app.post('/', { preHandler: requireFeature('coupons') }, async (req, reply) => {
    const { quoteId, pin } = parse(ConfirmQuoteSchema, req.body);
    return send(reply, await CouponsService.create(req.user.sub, quoteId, pin, 'coupon'), 201);
  });

  /** Coupons and gifts this user has started spending and still has balance on. */
  app.get('/balances', async (req, reply) => send(reply, await CouponsService.myBalances(req.user.sub)));

  app.get('/code/:code', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { code } = parse(z.object({ code: CouponCodeSchema }), req.params);
    return send(reply, await CouponsService.getByCode(code, req.user.sub));
  });

  /** Stops new claims and returns unclaimed money now; claimants keep their balance until expiry. */
  app.post('/:id/cancel', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.cancel(req.user.sub, id));
  });
}

export async function giftsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.post('/', { preHandler: requireFeature('gifts') }, async (req, reply) => {
    const { quoteId, pin } = parse(ConfirmQuoteSchema, req.body);
    return send(reply, await CouponsService.create(req.user.sub, quoteId, pin, 'gift'), 201);
  });

  /** Gift balances addressed to this user that still have money on them. */
  app.get('/received', async (req, reply) => send(reply, await CouponsService.receivedGifts(req.user.sub)));

  /**
   * Everything gifted to this user — balances and bills paid for them (with tokens) — so a
   * missed notification never means a missed gift. `unseen` drives the dashboard badge.
   */
  app.get('/inbox', async (req, reply) => send(reply, await GiftInboxService.inbox(req.user.sub)));

  /** Every gift received or sent, in any state, with what each was spent on. */
  app.get('/history', async (req, reply) => {
    const { direction, page, limit } = parse(PaginationQuerySchema.extend({ direction: z.enum(['received', 'sent']).default('received') }), req.query);
    return send(reply, await GiftInboxService.history(req.user.sub, direction, page, limit));
  });

  /** `{ ids }` marks those seen; an empty body marks everything. */
  app.post('/inbox/seen', async (req, reply) => {
    const { ids } = parse(z.object({ ids: z.array(ObjectIdSchema).max(100).optional() }), req.body);
    await GiftInboxService.markSeen(req.user.sub, ids);
    return send(reply, await GiftInboxService.summary(req.user.sub));
  });
}

/** Tasa promos the app can show as banners: active, listed, budget left, and not used up by this user. */
export async function promotionsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await CouponsService.listedPromos(req.user.sub)));
}

/** `/api/admin/promotions` — Tasa-funded promo codes. Finance creates and edits; anyone in the back office can read. */
export async function adminPromotionsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', async (req, reply) => {
    const q = parse(PaginationQuerySchema.extend({ status: z.enum(['active', 'paused', 'expired', 'cancelled']).optional() }), req.query);
    return send(reply, await CouponsService.listPromos(q));
  });

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.getPromo(id));
  });

  /** Response includes `warnings` for risky-but-allowed setups (e.g. fixed value with no minSpend). */
  app.post('/', { preHandler: requireRole('finance') }, async (req, reply) =>
    send(reply, await CouponsService.createPromo(parse(CreatePromoSchema, req.body), req.user.sub), 201),
  );

  app.patch('/:id', { preHandler: requireRole('finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.updatePromo(id, parse(UpdatePromoSchema, req.body)));
  });

  app.post('/:id/end', { preHandler: requireRole('finance') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.endPromo(id));
  });
}

/**
 * `/api/admin/coupons` — every coupon and gift. Finance creates Tasa-funded giveaways
 * (`fundedBy: 'tasa'`); support and finance can pause or close any coupon (a user's
 * unclaimed money goes back to them).
 */
export async function adminCouponsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', async (req, reply) => send(reply, await CouponsService.adminList(parse(AdminCouponListSchema, req.query))));

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.adminGet(id));
  });

  /** A giveaway coupon (many people) or a gift to one phone number, paid for by Tasa. */
  app.post('/', { preHandler: requireRole('finance') }, async (req, reply) =>
    send(reply, await CouponsService.createTasaCoupon(parse(TasaCouponSchema, req.body), req.user.sub), 201),
  );

  app.post('/:id/pause', { preHandler: requireRole('finance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.adminSetPaused(id, true));
  });

  app.post('/:id/resume', { preHandler: requireRole('finance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.adminSetPaused(id, false));
  });

  app.post('/:id/close', { preHandler: requireRole('finance', 'support') }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await CouponsService.adminClose(id));
  });
}
