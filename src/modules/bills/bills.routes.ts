import type { FastifyInstance } from 'fastify';
import { parse, send } from '../../lib/response';
import { requireActor } from '../../plugins/auth';
import { Catalog } from './bills.catalog';
import { PlansParamsSchema, PurchaseSchema, VerifyAccountSchema } from './bills.schema';
import { BillsService, verifyBillAccount } from './bills.service';
import { ConfigService, billFeature } from '../config/config.service';

/**
 * `/api/bills/*`. Flow: GET services/plans → POST /api/quotes { kind: 'bill' } (verifies
 * the meter/smart card and returns the charges) → POST /api/bills/purchases { quoteId, pin }.
 */
export async function billsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  /** A service switched off in the back office shows as unavailable, with the reason. */
  app.get('/services', async (_req, reply) => {
    const { features } = await ConfigService.publicConfig();
    return send(
      reply,
      Catalog.services().map((service) => {
        const paused = [features.bills, features[billFeature(service.id)]].find((f) => !f.enabled);
        return { ...service, available: service.available && !paused, pausedMessage: paused?.message ?? null };
      }),
    );
  });

  /** Data bundles (airtime networks), TV packages, internet plans, exam PIN types. */
  app.get('/services/:serviceId/providers/:provider/plans', async (req, reply) => {
    const { serviceId, provider } = parse(PlansParamsSchema, req.params);
    const resolved = Catalog.resolveProvider(serviceId, provider);
    return send(reply, await Catalog.plans(serviceId, resolved.code));
  });

  /**
   * Who a meter, smart card or account belongs to, as VTpass has it: the same check pricing does,
   * without a price. Throttled: each one is a call to VTpass.
   */
  app.post('/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const input = parse(VerifyAccountSchema, req.body);
    const provider = Catalog.resolveProvider(input.serviceId, input.provider);
    const verified = await verifyBillAccount(input.serviceId, provider, input.account, { meterType: input.meterType, planCode: input.planCode });
    return send(reply, { account: verified.account, customer: verified.customer ?? null });
  });

  app.post('/purchases', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { quoteId, pin, saveBeneficiary } = parse(PurchaseSchema, req.body);
    const tx = await BillsService.purchase(req.user.sub, quoteId, { pin, saveBeneficiary });
    // 202 while the provider is still working on it; the app polls GET /api/transactions/:reference.
    return send(reply, tx, tx.status === 'pending' ? 202 : 201);
  });
}
