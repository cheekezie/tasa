import type { FastifyInstance } from 'fastify';
import { parse, send } from '../../lib/response';
import { Catalog } from '../bills/bills.catalog';
import { CreateGuestOrderSchema, GuestOrderParamsSchema, GuestOrderQuerySchema, GuestPlansParamsSchema, GuestVerifySchema } from './guest.schema';
import { GuestService } from './guest.service';

/**
 * `/api/guest` — paying a one-off bill on the website, no sign-in: JAMB and WAEC PINs,
 * electricity, airtime. Every route is throttled per IP; orders are also capped per phone and
 * in size. The order's status needs the secret `key` it was created with.
 */
export async function guestRoutes(app: FastifyInstance) {
  app.get('/services', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return send(reply, await GuestService.services());
  });

  app.get('/services/:serviceId/providers/:provider/plans', async (req, reply) => {
    const { serviceId, provider } = parse(GuestPlansParamsSchema, req.params);
    reply.header('Cache-Control', 'public, max-age=300');
    return send(reply, await Catalog.plans(serviceId, Catalog.resolveProvider(serviceId, provider).code));
  });

  // Each one is a call to VTpass.
  app.post('/verify', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await GuestService.verify(parse(GuestVerifySchema, req.body))),
  );

  // Each one issues a SaySwitch account.
  app.post('/orders', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) =>
    send(reply, await GuestService.create(parse(CreateGuestOrderSchema, req.body)), 201),
  );

  app.get('/orders/:reference', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { reference } = parse(GuestOrderParamsSchema, req.params);
    const { key } = parse(GuestOrderQuerySchema, req.query);
    reply.header('Cache-Control', 'no-store');
    return send(reply, await GuestService.get(reference, key));
  });
}
