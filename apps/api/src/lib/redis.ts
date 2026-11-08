import { Redis } from 'ioredis';
import { env } from '../config/env';

/** Shared connection for app commands (presence, caching, rate limiting). */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

/** BullMQ needs its own connections with `maxRetriesPerRequest: null`. */
export const createQueueConnection = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

redis.on('error', (err) => console.error('[redis]', err.message));
