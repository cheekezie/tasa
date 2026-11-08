import type { FastifyInstance } from 'fastify';
import { parse, send } from '../../lib/response';
import { IdParamsSchema } from '../../lib/schemas';
import { requireActor } from '../../plugins/auth';
import { CreateRecurringSchema, UpdateRecurringSchema } from './recurring.schema';
import { RecurringService } from './recurring.service';
import { requireFeature } from '../config/config.routes';

export async function recurringRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await RecurringService.list(req.user.sub)));

  app.post('/', { preHandler: requireFeature('recurring') }, async (req, reply) =>
    send(reply, await RecurringService.create(req.user.sub, parse(CreateRecurringSchema, req.body)), 201),
  );

  app.patch('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await RecurringService.update(req.user.sub, id, parse(UpdateRecurringSchema, req.body)));
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    await RecurringService.cancel(req.user.sub, id);
    return send(reply, { cancelled: true });
  });
}
