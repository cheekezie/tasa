import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, send } from '../../lib/response';
import { ObjectIdSchema, PaginationQuerySchema } from '../../lib/schemas';
import { requireActor } from '../../plugins/auth';
import { NotificationsService } from './notifications.service';

export async function notificationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => {
    const { page, limit } = parse(PaginationQuerySchema, req.query);
    return send(reply, await NotificationsService.list(req.user.sub, page, limit));
  });

  /** Body `{ ids }` marks those; an empty body marks everything read. */
  app.post('/read', async (req, reply) => {
    const { ids } = parse(z.object({ ids: z.array(ObjectIdSchema).max(100).optional() }), req.body);
    await NotificationsService.markRead(req.user.sub, ids);
    return send(reply, { ok: true });
  });
}
