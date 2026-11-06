import type { FastifyInstance, FastifyRequest } from 'fastify';
import { otpRateLimit } from '../../config/env';
import { parse, send } from '../../lib/response';
import { AdminLoginSchema, LogoutSchema, OtpRequestSchema, OtpVerifySchema, RefreshSchema } from './auth.schema';
import { requireActor } from '../../plugins/auth';
import { revokeUserSessions } from '../users/users.service';
import { createAuthService } from './auth.service';

const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/**
 * `/api/auth/*`. The app keeps tokens in secure storage and sends the refresh token in
 * the body (no cookies — native clients don't need them).
 */
export async function authRoutes(app: FastifyInstance) {
  const auth = createAuthService(app);
  // Many Nigerian subscribers share one carrier IP, so OTP limits are per phone/email
  // (after the body is parsed); the IP limit is only a loose backstop. OtpService adds a
  // 60s resend cooldown on top.
  const perPhone = (max: number, timeWindow: string) => ({
    config: {
      rateLimit: {
        max: otpRateLimit(max),
        timeWindow,
        hook: 'preHandler' as const,
        keyGenerator: (req: FastifyRequest) => {
          const contact = OtpRequestSchema.safeParse(req.body);
          return contact.success ? `otp:${contact.data.type}:${contact.data.value}` : req.ip;
        },
      },
    },
  });

  app.post('/otp', perPhone(5, '1 hour'), async (req, reply) => {
    const contact = parse(OtpRequestSchema, req.body);
    return send(reply, await auth.requestOtp(contact), 200, contact.type === 'email' ? 'Code sent to your email' : 'Code sent');
  });

  app.post('/otp/verify', perPhone(10, '10 minutes'), async (req, reply) => {
    const { code, ...contact } = parse(OtpVerifySchema, req.body);
    return send(reply, await auth.verifyOtp(contact, code, meta(req)));
  });

  app.post('/refresh', async (req, reply) => {
    const { refreshToken } = parse(RefreshSchema, req.body);
    return send(reply, await auth.refresh(refreshToken, meta(req)));
  });

  app.post('/logout', async (req, reply) => {
    const { refreshToken } = parse(LogoutSchema, req.body);
    await auth.logout(refreshToken);
    return send(reply, { loggedOut: true });
  });

  /** Signs this user out on every device. */
  app.post('/logout/all', { preHandler: [app.authenticate, requireActor('user')] }, async (req, reply) => {
    await revokeUserSessions(req.user.sub);
    return send(reply, { loggedOut: true });
  });

  app.post('/admin/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { email, password } = parse(AdminLoginSchema, req.body);
    return send(reply, await auth.adminLogin(email, password, meta(req)));
  });
}
