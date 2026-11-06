import { env } from '../../../config/env';
import type { BillerGateway } from './biller';
import { createVtpassGateway } from './vtpass';

// No simulator: VTpass's sandbox (with its documented test numbers) is the test bed.
export const biller: BillerGateway = createVtpassGateway({
  baseUrl: env.VTPASS_BASE_URL,
  apiKey: env.VTPASS_API_KEY,
  publicKey: env.VTPASS_PUBLIC_KEY,
  secretKey: env.VTPASS_SECRET_KEY,
});
