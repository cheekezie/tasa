import type { FastifyInstance } from 'fastify';
import { parse, send } from '../../lib/response';
import { requireActor } from '../../plugins/auth';
import { SendTransferSchema } from './transfers.schema';
import { TransfersService } from './transfers.service';
import { requireFeature } from '../config/config.routes';

/** `/api/transfers` — Tela to Tela. Quote with POST /api/quotes { kind: 'transfer' }. */
export async function transfersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.post('/', { preHandler: requireFeature('transfers'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { quoteId, pin } = parse(SendTransferSchema, req.body);
    return send(reply, await TransfersService.send(req.user.sub, quoteId, pin), 201);
  });
}
