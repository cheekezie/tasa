import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, send } from '../../lib/response';
import { ServiceIdSchema } from '../../lib/schemas';
import { requireActor } from '../../plugins/auth';
import { SpendingService } from './spending.service';
import { InsightsQuerySchema, SpendingQuerySchema, TransactionListQuerySchema } from './transactions.schema';
import { TransactionsService } from './transactions.service';

/** `/api/transactions` — the activity feed — and `/api/insights`. */
export async function transactionsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) =>
    send(reply, await TransactionsService.list(req.user.sub, parse(TransactionListQuerySchema, req.query))),
  );

  app.get('/:reference', async (req, reply) => {
    const { reference } = parse(z.object({ reference: z.string().min(6).max(48) }), req.params);
    return send(reply, await TransactionsService.get(req.user.sub, reference));
  });
}

export async function insightsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  /** Where the user's money went in a period. */
  app.get('/', async (req, reply) => {
    const { period } = parse(SpendingQuerySchema, req.query);
    return send(reply, await SpendingService.summary(req.user.sub, period));
  });

  app.get('/:serviceId', async (req, reply) => {
    const { serviceId } = parse(z.object({ serviceId: ServiceIdSchema }), req.params);
    const { months } = parse(InsightsQuerySchema, req.query);
    return send(reply, await TransactionsService.insights(req.user.sub, serviceId, months));
  });
}
