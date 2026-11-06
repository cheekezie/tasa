import { devOtp, env } from '../../config/env';
import { randomDigits, safeEqual, sha256 } from '../../lib/crypto';
import { tooMany, unauthorized } from '../../lib/errors';
import { redis } from '../../lib/redis';
import type { Contact } from '../../lib/schemas';
import { email } from '../notifications/channels/email';
import { sms } from '../notifications/channels/sms';

const TTL_SECONDS = 10 * 60;
const RESEND_SECONDS = 60;
const MAX_TRIES = 5;

/** `login` signs in or up; `link` proves a signed-in user owns a phone/email they're adding. */
export type OtpPurpose = 'login' | 'link' | 'pin_reset';

const id = (purpose: OtpPurpose, c: Contact) => `${purpose}:${c.type}:${c.value}`;
const key = (purpose: OtpPurpose, c: Contact) => `otp:${id(purpose, c)}`;
const cooldownKey = (purpose: OtpPurpose, c: Contact) => `otp:cooldown:${id(purpose, c)}`;
// The hash binds the code to who it was sent to and why, so a code can't be replayed elsewhere.
const hash = (purpose: OtpPurpose, c: Contact, code: string) => sha256(`${id(purpose, c)}:${code}`);

async function deliver(c: Contact, code: string, purpose: OtpPurpose) {
  const what = purpose === 'login' ? 'Your Tela code' : 'Your Tela verification code';
  if (c.type === 'phone') {
    await sms.send(c.value, `${what} is ${code}. It expires in 10 minutes. Never share it with anyone.`);
    return;
  }
  await email.send({
    to: c.value,
    subject: `${what}: ${code}`,
    text: `${what} is ${code}. It expires in 10 minutes. Never share it with anyone — Tela staff will never ask for it.`,
    html: `<p>${what} is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. Never share it with anyone — Tela staff will never ask for it.</p>`,
  });
}

/** One-time codes live in Redis only: hashed, single-use, five tries, ten minutes. */
export const OtpService = {
  async send(c: Contact, purpose: OtpPurpose) {

    if (!devOtp.code) {
      const fresh = await redis.set(cooldownKey(purpose, c), '1', 'EX', RESEND_SECONDS, 'NX');
      if (!fresh) throw tooMany('Please wait a minute before requesting another code', 'OTP_COOLDOWN');
    }
    const code = devOtp.code ?? randomDigits(6);
    await redis.set(key(purpose, c), JSON.stringify({ hash: hash(purpose, c, code), tries: 0 }), 'EX', TTL_SECONDS);
    if (!devOtp.code) await deliver(c, code, purpose);
    return {
      channel: c.type,
      expiresInSeconds: TTL_SECONDS,
      resendInSeconds: RESEND_SECONDS,
      ...(env.NODE_ENV === 'test' && { code }),
    };
  },

  async verify(c: Contact, code: string, purpose: OtpPurpose) {
    const k = key(purpose, c);
    const raw = await redis.get(k);
    if (!raw) throw unauthorized('That code has expired. Request a new one');
    const entry = JSON.parse(raw) as { hash: string; tries: number };
    if (entry.tries >= MAX_TRIES) {
      await redis.del(k);
      throw unauthorized('Too many wrong codes. Request a new one');
    }
    if (!safeEqual(entry.hash, hash(purpose, c, code))) {
      const ttl = await redis.ttl(k);
      await redis.set(k, JSON.stringify({ ...entry, tries: entry.tries + 1 }), 'EX', Math.max(ttl, 1));
      throw unauthorized('Incorrect code');
    }
    await redis.del(k);
  },
};
