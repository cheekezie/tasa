import { request } from '../client';
import { AppConfigDto } from '../types';

/** Short timeout: startup waits for this, and the app can run on defaults if it doesn't come. */
const CONFIG_TIMEOUT_MS = 6_000;

export const configService = {
  get: () => request<AppConfigDto>('/config', { auth: false, timeoutMs: CONFIG_TIMEOUT_MS }),
};
