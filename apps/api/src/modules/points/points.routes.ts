import type { FastifyInstance } from 'fastify';
import { parse, send } from '../../lib/response';
import { requireActor } from '../../plugins/auth';
import { PointsHistoryQuerySchema, RedeemPointsSchema } from './points.schema';
import { PointsService } from './points.service';
import { requireFeature } from '../config/config.routes';

/** `/api/points` — earned on bills and transfers, converted to wallet cash. */
export async function pointsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await PointsService.summary(req.user.sub)));

  app.get('/history', async (req, reply) => {
    const { page, limit } = parse(PointsHistoryQuerySchema, req.query);
    return send(reply, await PointsService.history(req.user.sub, page, limit));
  });

  app.post('/redeem', { preHandler: requireFeature('points'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { points, idempotencyKey } = parse(RedeemPointsSchema, req.body);
    return send(reply, await PointsService.redeem(req.user.sub, points, idempotencyKey), 201);
  });
}
