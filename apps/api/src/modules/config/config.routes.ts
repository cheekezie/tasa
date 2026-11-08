import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parse, send } from '../../lib/response';
import { requireActor, requireRole } from '../../plugins/auth';
import { auditAdminAction, requireActiveAdmin } from '../admins/admins.guard';
import { MaintenanceSchema, UpdateFeaturesSchema } from './config.schema';
import { ConfigService, type FeatureKey } from './config.service';

/** Route guard: answers FEATURE_DISABLED while any of these is switched off. */
export const requireFeature =
  (...keys: FeatureKey[]) =>
  async () => {
    await ConfigService.assertEnabled(...keys);
  };

/** Still reachable during maintenance: the app's config itself, providers' webhooks, and the back office. */
const OPEN_DURING_MAINTENANCE = ['/api/config', '/api/webhooks/', '/api/admin/', '/api/admin'];

/**
 * Root `onRequest` hook. While maintenance is on, every app call gets 503 MAINTENANCE, so a
 * screen that was already open finds out on its next request.
 */
export async function maintenanceGate(req: FastifyRequest, reply: FastifyReply) {
  if (!req.url.startsWith('/api/') || OPEN_DURING_MAINTENANCE.some((path) => req.url === path || req.url.startsWith(path))) return;
  const maintenance = await ConfigService.maintenance();
  if (!maintenance) return;
  return reply.status(503).send({
    success: false,
    statusCode: 503,
    code: 'MAINTENANCE',
    message: maintenance.message,
    errors: maintenance.until ? { until: maintenance.until.toISOString() } : undefined,
  });
}

/** `/api/config` — no sign-in needed: the app reads it before anything else. */
export async function configRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    // Short enough that a switch reaches everyone within a minute, long enough to spare the API.
    reply.header('Cache-Control', 'public, max-age=30');
    return send(reply, await ConfigService.publicConfig());
  });
}

/** `/api/admin/config` — switching features off and on, and maintenance mode. */
export async function adminConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('admin'));
  app.addHook('preHandler', requireActiveAdmin);
  app.addHook('onResponse', auditAdminAction);

  app.get('/', async (_req, reply) => send(reply, await ConfigService.adminConfig()));

  app.patch('/features', { preHandler: requireRole('support') }, async (req, reply) =>
    send(reply, await ConfigService.updateFeatures(parse(UpdateFeaturesSchema, req.body))),
  );

  /** Takes every app user offline, so only super admins. */
  app.put('/maintenance', { preHandler: requireRole('super_admin') }, async (req, reply) =>
    send(reply, await ConfigService.setMaintenance(parse(MaintenanceSchema, req.body), req.user.sub)),
  );
}
