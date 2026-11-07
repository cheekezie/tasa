import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { otpRateLimit } from '../../config/env';
import { unprocessable } from '../../lib/errors';
import { parse, send } from '../../lib/response';
import { requireActor } from '../../plugins/auth';
import { GiftInboxService } from '../coupons/gift-inbox.service';
import { PinService } from './pin.service';
import { ContactSchema, RecipientSchema } from '../../lib/schemas';
import {
  BillPinSchema,
  BvnSchema,
  NinSchema,
  CloseAccountSchema,
  ContactVerifySchema,
  PushTokenSchema,
  ResetPinSchema,
  SetPinSchema,
  UpdateProfileSchema,
  UsernameSchema,
  VerifyPinSchema,
} from './users.schema';
import { AVATAR_MAX_BYTES, AvatarsService } from './avatars.service';
import { UsersService } from './users.service';

/**
 * `/api/users/lookup` — find a Tasa user by username, phone or email before sending money
 * or a gift. POST so phone numbers and emails stay out of URLs and access logs.
 */
export async function usersLookupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  // Tight: every lookup tells the caller whether an account exists.
  app.post('/lookup', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) =>
    send(reply, await UsersService.lookup(req.user.sub, parse(RecipientSchema, req.body))),
  );
}

/** `/api/me` — the signed-in user's profile, PIN and devices. */
export async function usersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireActor('user'));

  /** Profile plus what the home screen needs: wallet balance and gifts waiting (`gifts.unseen` → badge). */
  app.get('/', async (req, reply) => {
    const [me, gifts] = await Promise.all([UsersService.me(req.user.sub), GiftInboxService.summary(req.user.sub)]);
    return send(reply, { ...me, gifts });
  });

  app.patch('/', async (req, reply) =>
    send(reply, await UsersService.update(req.user.sub, parse(UpdateProfileSchema, req.body))),
  );

  app.get('/username-available', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { username } = parse(z.object({ username: UsernameSchema }), req.query);
    return send(reply, { username, available: await UsersService.isUsernameAvailable(username, req.user.sub) });
  });

  app.post('/bvn', async (req, reply) => {
    const { bvn } = parse(BvnSchema, req.body);
    return send(reply, await UsersService.setBvn(req.user.sub, bvn));
  });

  app.post('/nin', async (req, reply) => {
    const { nin } = parse(NinSchema, req.body);
    return send(reply, await UsersService.setNin(req.user.sub, nin));
  });

  /** Add or change a phone/email: send a code to it, then verify. Both are sign-in identities. */
  app.post('/contacts/otp', { config: { rateLimit: { max: otpRateLimit(5), timeWindow: '10 minutes' } } }, async (req, reply) => {
    const contact = parse(ContactSchema, req.body);
    return send(reply, await UsersService.requestContactCode(req.user.sub, contact), 200, 'Code sent');
  });

  app.post('/contacts/verify', { config: { rateLimit: { max: otpRateLimit(10), timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { code, ...contact } = parse(ContactVerifySchema, req.body);
    return send(reply, await UsersService.verifyContact(req.user.sub, contact, code));
  });

  app.put('/pin', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { pin, currentPin } = parse(SetPinSchema, req.body);
    await PinService.set(req.user.sub, pin, currentPin);
    return send(reply, { hasPin: true }, 200, 'Transaction PIN saved');
  });

  /** Multipart with one `file` part. Replaces and deletes any previous photo. */
  app.post('/avatar', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }).catch((err) => {
      req.log.warn(err, 'avatar upload unreadable');
      return undefined;
    });
    if (!file) throw unprocessable('Choose a photo to upload', 'PHOTO_MISSING');
    const buffer = await file.toBuffer().catch(() => {
      throw unprocessable('Use a photo under 5MB', 'PHOTO_TOO_LARGE');
    });
    return send(reply, await AvatarsService.upload(req.user.sub, buffer));
  });

  app.delete('/avatar', async (req, reply) => {
    await AvatarsService.remove(req.user.sub);
    return send(reply, { removed: true });
  });

  /** Proves the PIN, e.g. to unlock on a new device. Wrong tries count towards the lockout. */
  app.post('/pin/verify', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { pin } = parse(VerifyPinSchema, req.body);
    await PinService.verify(req.user.sub, pin);
    return send(reply, { valid: true });
  });

  /** Whether bill payments ask for the PIN. Turns back on at every new sign-in. */
  app.post('/pin/bills', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { enabled, pin } = parse(BillPinSchema, req.body);
    return send(reply, await PinService.setBillPin(req.user.sub, enabled, pin));
  });

  app.post('/pin/reset/otp', { config: { rateLimit: { max: otpRateLimit(3), timeWindow: '1 hour' } } }, async (req, reply) =>
    send(reply, await PinService.requestReset(req.user.sub), 200, 'Code sent'),
  );

  app.post('/pin/reset', { config: { rateLimit: { max: otpRateLimit(5), timeWindow: '1 hour' } } }, async (req, reply) => {
    const { code, pin } = parse(ResetPinSchema, req.body);
    return send(reply, await PinService.reset(req.user.sub, code, pin), 200, 'PIN changed');
  });

  /** Permanent. The app must make the user confirm first. */
  app.delete('/', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { pin, forfeitAmount } = parse(CloseAccountSchema, req.body);
    return send(reply, await UsersService.close(req.user.sub, pin, forfeitAmount), 200, 'Account closed');
  });

  app.post('/push-tokens', async (req, reply) => {
    const { token } = parse(PushTokenSchema, req.body);
    await UsersService.addPushToken(req.user.sub, token);
    return send(reply, { registered: true });
  });

  app.delete('/push-tokens', async (req, reply) => {
    const { token } = parse(PushTokenSchema, req.body);
    await UsersService.removePushToken(req.user.sub, token);
    return send(reply, { removed: true });
  });
}
