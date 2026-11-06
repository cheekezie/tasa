import type { FastifyInstance } from 'fastify';
import { IdParamsSchema } from '../../lib/schemas';
import { parse, send } from '../../lib/response';
import { requireActor } from '../../plugins/auth';
import { requireFeature } from '../config/config.routes';
import { CreateSplitSchema, PayShareSchema, SplitAgainSchema, UpdateSplitSchema } from './splits.schema';
import { SplitsService } from './splits.service';

/**
 * `/api/splits` — one bill, shared. Shares are priced with `POST /api/quotes { kind: 'split_share' }`
 * and paid here; the last share in pays the bill from the pot.
 */
export async function splitsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await SplitsService.list(req.user.sub)));

  // Pricing it asks VTpass to verify the meter or card.
  app.post('/', { preHandler: requireFeature('splits'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await SplitsService.create(req.user.sub, parse(CreateSplitSchema, req.body)), 201),
  );

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SplitsService.detail(id, req.user.sub));
  });

  app.post('/:id/shares', { preHandler: requireFeature('splits') }, async (req, reply) => {
    const { quoteId, pin } = parse(PayShareSchema, req.body);
    return send(reply, await SplitsService.payShare(req.user.sub, quoteId, pin), 201);
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SplitsService.update(id, req.user.sub, parse(UpdateSplitSchema, req.body)));
  });

  // A new split, priced (and the meter checked) like any other.
  app.post('/:id/again', { preHandler: requireFeature('splits'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SplitsService.again(id, req.user.sub, parse(SplitAgainSchema, req.body ?? {}).hours), 201);
  });

  app.post('/:id/cancel', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await SplitsService.cancel(id, req.user.sub));
  });
}
