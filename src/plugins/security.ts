import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env';
import { redis } from '../lib/redis';

export const securityPlugin = fp(async (app: FastifyInstance) => {
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  // Redis-backed so limits hold across every API instance. Sensitive routes (OTP, PIN,
  // quotes that hit SaySwitch) set a tighter per-route `config.rateLimit`.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Tests use the in-memory store so repeated runs don't trip the OTP limits.
    ...(env.NODE_ENV !== 'test' && { redis }),
    // Signed-in traffic is limited per user, so a carrier NAT doesn't throttle everyone
    // behind it. This runs before `authenticate`, so verify the token here; a forged one
    // falls back to the IP and gains nothing.
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        try {
          return `u:${app.jwt.verify<{ sub: string }>(auth.slice(7)).sub}`;
        } catch {
          // fall through
        }
      }
      return req.ip;
    },
  });
});
