import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). For secrets we must read back, e.g. BVN. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** AES-256-GCM for files we must keep private in a public bucket: iv(12) · tag(16) · ciphertext. */
export function encryptBytes(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function decryptBytes(payload: Buffer): Buffer {
  if (payload.length < 29) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', KEY, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const hmac512 = (key: string, value: string) => createHmac('sha512', key).update(value).digest('hex');

export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export const randomToken = (bytes = 48) => randomBytes(bytes).toString('base64url');

// Crockford base32 without I, L, O, U — nothing a user can misread when typing a coupon code.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const randomCode = (length: number) =>
  Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export const randomDigits = (digits: number) => String(randomInt(0, 10 ** digits)).padStart(digits, '0');
