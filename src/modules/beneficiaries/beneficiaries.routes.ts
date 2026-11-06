import type { FastifyInstance } from 'fastify';
import { parse, send } from '../../lib/response';
import { IdParamsSchema } from '../../lib/schemas';
import { requireActor } from '../../plugins/auth';
import { CreateBeneficiarySchema, OptInSchema, UpdateBeneficiarySchema } from './beneficiaries.schema';
import { BeneficiariesService } from './beneficiaries.service';

export async function beneficiariesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  app.get('/', async (req, reply) => send(reply, await BeneficiariesService.list(req.user.sub)));

  app.post('/', async (req, reply) =>
    send(reply, await BeneficiariesService.create(req.user.sub, parse(CreateBeneficiarySchema, req.body)), 201),
  );

  app.get('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await BeneficiariesService.get(req.user.sub, id));
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    return send(reply, await BeneficiariesService.update(req.user.sub, id, parse(UpdateBeneficiarySchema, req.body)));
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    await BeneficiariesService.archive(req.user.sub, id);
    return send(reply, { archived: true });
  });

  /** The auto-pay terms to show before opting in. */
  app.get('/auto-pay-terms', async (_req, reply) => send(reply, BeneficiariesService.terms()));

  /** Opt in: accept the terms → a permanent account number with auto-pay on. */
  app.post('/:id/virtual-account', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { id } = parse(IdParamsSchema, req.params);
    const input = parse(OptInSchema, req.body);
    return send(reply, await BeneficiariesService.optIn(req.user.sub, id, input, { ip: req.ip, userAgent: req.headers['user-agent'] }), 201);
  });
}
