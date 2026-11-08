import type { FastifyInstance } from 'fastify';
import { unauthorized } from '../../lib/errors';
import { WebhooksService } from './webhooks.service';

/**
 * `/api/webhooks/*` — SaySwitch signs the exact bytes it sends, so this scope keeps bodies
 * as raw strings instead of parsing JSON.
 */
export async function webhooksRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));

  app.post('/sayswitch', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ok = await WebhooksService.receiveSaySwitch(String(req.body ?? ''), req.headers);
    if (!ok) throw unauthorized('Invalid signature');
    // Acknowledge fast; processing happens on the webhooks queue.
    return reply.status(200).send({ received: true });
  });

  // VTpass expects exactly this acknowledgement, sent before any slow work.
  app.post('/vtpass', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    await WebhooksService.receiveVtpass(String(req.body ?? ''));
    return reply.status(200).send({ response: 'success' });
  });
}
