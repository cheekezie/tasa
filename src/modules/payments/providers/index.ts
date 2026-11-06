import { env } from '../../../config/env';
import type { PaymentGateway } from './gateway';
import { createSaySwitchGateway } from './sayswitch';

// No simulator: tests run against SaySwitch's sandbox (sk_test_ keys), so a broken
// integration can't hide behind a mock.
export const gateway: PaymentGateway = createSaySwitchGateway({
  baseUrl: env.SAYSWITCH_BASE_URL,
  secretKey: env.SAYSWITCH_SECRET_KEY,
  publicKey: env.SAYSWITCH_PUBLIC_KEY,
});
