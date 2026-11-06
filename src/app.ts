import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import mongoose from 'mongoose';
import { env, isProd } from './config/env';
import { AppError } from './lib/errors';
import { redis } from './lib/redis';
import { authPlugin } from './plugins/auth';
import { securityPlugin } from './plugins/security';
import { adminsRoutes } from './modules/admins/admins.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { beneficiariesRoutes } from './modules/beneficiaries/beneficiaries.routes';
import { billsRoutes } from './modules/bills/bills.routes';
import { adminCouponsRoutes, adminPromotionsRoutes, couponsRoutes, giftsRoutes, promotionsRoutes } from './modules/coupons/coupons.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { adminEventsRoutes, adminSellersRoutes, eventsRoutes, organisersRoutes, sellerRoutes, ticketsRoutes } from './modules/tickets/tickets.routes';
import { adminGroupsRoutes, groupsRoutes, publicGroupsRoutes } from './modules/groups/groups.routes';
import { guestRoutes } from './modules/guest/guest.routes';
import { splitsRoutes } from './modules/splits/splits.routes';
import { adminConfigRoutes, configRoutes, maintenanceGate } from './modules/config/config.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { quotesRoutes } from './modules/quotes/quotes.routes';
import { recurringRoutes } from './modules/recurring/recurring.routes';
import { insightsRoutes, transactionsRoutes } from './modules/transactions/transactions.routes';
import { transfersRoutes } from './modules/transfers/transfers.routes';
import { usersLookupRoutes, usersRoutes } from './modules/users/users.routes';
import { walletRoutes } from './modules/wallet/wallet.routes';
import { pointsRoutes } from './modules/points/points.routes';
import { webhooksRoutes } from './modules/webhooks/webhooks.routes';

export async function buildApp() {
  const app = Fastify({
    trustProxy: true, // real client IP behind the load balancer (rate limits, session audit)
    bodyLimit: 1024 * 1024,
    logger:
      env.NODE_ENV === 'test'
        ? false
        : isProd
          ? { level: 'info', redact: ['req.headers.authorization', 'req.body.pin', 'req.body.code'] }
          : { level: 'info', transport: { target: 'pino-pretty', options: { singleLine: true, ignore: 'pid,hostname' } } },
  });

  await app.register(authPlugin); // first: the rate limiter reads JWTs
  await app.register(securityPlugin);
  await app.register(multipart);

  // Must be set before routes register: child plugins capture the handler at registration time.
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ success: false, statusCode: 404, code: 'NOT_FOUND', message: 'Route not found' }),
  );

  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        ...(error.errors && { errors: error.errors }),
      });
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests — slow down and try again shortly',
      });
    }
    if (error.name === 'CastError') {
      return reply.status(400).send({ success: false, statusCode: 400, code: 'INVALID_ID', message: 'Invalid identifier' });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ success: false, statusCode: error.statusCode, message: error.message });
    }
    req.log.error(error);
    return reply.status(500).send({ success: false, statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });

  app.get('/health', async () => ({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'ok' : 'down',
    redis: redis.status === 'ready' ? 'ok' : 'down',
    env: env.NODE_ENV,
  }));

  app.addHook('onRequest', maintenanceGate);

  // Who calls what:
  //   /api/webhooks/*  — SaySwitch (signed, raw body)
  //   /api/admin/*     — back office
  //   everything else  — the Tela app
  await app.register(configRoutes, { prefix: '/api/config' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usersRoutes, { prefix: '/api/me' });
  await app.register(usersLookupRoutes, { prefix: '/api/users' });
  await app.register(quotesRoutes, { prefix: '/api/quotes' });
  await app.register(walletRoutes, { prefix: '/api/wallet' });
  await app.register(billsRoutes, { prefix: '/api/bills' });
  await app.register(transfersRoutes, { prefix: '/api/transfers' });
  await app.register(couponsRoutes, { prefix: '/api/coupons' });
  await app.register(giftsRoutes, { prefix: '/api/gifts' });
  await app.register(promotionsRoutes, { prefix: '/api/promotions' });
  await app.register(beneficiariesRoutes, { prefix: '/api/beneficiaries' });
  await app.register(recurringRoutes, { prefix: '/api/recurring' });
  await app.register(transactionsRoutes, { prefix: '/api/transactions' });
  await app.register(insightsRoutes, { prefix: '/api/insights' });
  await app.register(notificationsRoutes, { prefix: '/api/notifications' });
  await app.register(pointsRoutes, { prefix: '/api/points' });
  await app.register(eventsRoutes, { prefix: '/api/events' });
  await app.register(ticketsRoutes, { prefix: '/api/tickets' });
  await app.register(sellerRoutes, { prefix: '/api/seller' });
  await app.register(organisersRoutes, { prefix: '/api/organisers' });
  await app.register(groupsRoutes, { prefix: '/api/groups' });
  await app.register(splitsRoutes, { prefix: '/api/splits' });
  await app.register(publicGroupsRoutes, { prefix: '/api/public/groups' });
  await app.register(guestRoutes, { prefix: '/api/guest' });
  await app.register(webhooksRoutes, { prefix: '/api/webhooks' });
  await app.register(adminsRoutes, { prefix: '/api/admin' });
  await app.register(adminPromotionsRoutes, { prefix: '/api/admin/promotions' });
  await app.register(adminCouponsRoutes, { prefix: '/api/admin/coupons' });
  await app.register(reportsRoutes, { prefix: '/api/admin/reports' });
  await app.register(adminEventsRoutes, { prefix: '/api/admin/events' });
  await app.register(adminSellersRoutes, { prefix: '/api/admin/sellers' });
  await app.register(adminGroupsRoutes, { prefix: '/api/admin/groups' });
  await app.register(adminConfigRoutes, { prefix: '/api/admin/config' });

  return app;
}
