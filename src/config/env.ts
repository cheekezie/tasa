import { z } from 'zod';

const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4110),
  /** Must be a replica set (or Atlas): wallet movements run in Mongo transactions. */
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27018/tela-app?replicaSet=rs0'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  /** Browser origins (Expo web, admin). Native apps send no Origin and are unaffected. */
  CORS_ORIGINS: list('http://localhost:8081,http://localhost:5173'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(60),

  // ── Cloudflare R2 (profile photos) ─────────────────────────────────────
  CF_ACCOUNT_ID: z.string().min(1, 'CF_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET: z.string().min(1, 'R2_BUCKET is required'),
  /** e.g. https://pub-xxxx.r2.dev or a custom domain. */
  R2_PUBLIC_URL: z.string().min(1, 'R2_PUBLIC_URL is required'),

  /** The code every OTP flow accepts in development. See `devOtp` below. */
  DEV_OTP_CODE: z.string().regex(/^\d{6}$/, 'DEV_OTP_CODE must be 6 digits').default('123456'),

  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),

  // ── SaySwitch (wallet funding, beneficiary accounts) ───────────────────
  SAYSWITCH_BASE_URL: z.string().default('https://backendapi.sayswitchgroup.com'),
  /** `sk_test_…` runs against SaySwitch's sandbox on the same host. */
  SAYSWITCH_SECRET_KEY: z.string().min(1, 'SAYSWITCH_SECRET_KEY is required'),
  SAYSWITCH_PUBLIC_KEY: z.string().min(1, 'SAYSWITCH_PUBLIC_KEY is required'),
  /**
   * SaySwitch needs an email on every collection. Users who haven't added one get
   * `<userId>@<this domain>` — use a domain you own so nothing bounces to a stranger.
   */
  CUSTOMER_EMAIL_DOMAIN: z.string().default('customers.tela.ng'),

  // ── VTpass (bill payments) ─────────────────────────────────────────────
  /** Sandbox until VTpass provisions the live account; then https://vtpass.com/api */
  VTPASS_BASE_URL: z.string().default('https://sandbox.vtpass.com/api'),
  VTPASS_API_KEY: z.string().min(1, 'VTPASS_API_KEY is required'),
  /** Sent on GET requests (variations, balance). */
  VTPASS_PUBLIC_KEY: z.string().min(1, 'VTPASS_PUBLIC_KEY is required'),
  /** Sent on POST requests (verify, pay, requery). */
  VTPASS_SECRET_KEY: z.string().min(1, 'VTPASS_SECRET_KEY is required'),

  /**
   * Version of the auto-pay terms a user must accept before a beneficiary (e.g. a saved
   * meter) gets an account number. Bump it when the terms change; the app sends the
   * version the user saw.
   */
  AUTOPAY_TERMS_VERSION: z.string().default('2026-10-28'),
  AUTOPAY_TERMS_URL: z.string().default('https://tela.ng/terms/auto-pay'),

  /** How long a funding account is shown to the user. Late transfers are still credited. */
  FUNDING_ACCOUNT_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  QUOTE_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  TERMII_API_KEY: z.string().optional(),
  TERMII_SENDER_ID: z.string().default('Tela'),
  /** Email OTPs (for when SMS doesn't arrive) and receipts. ZeptoMail "Send Mail" token. */
  ZEPTOMAIL_TOKEN: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().default('noreply@tela.ng'),
  EMAIL_FROM_NAME: z.string().default('Tela'),
  /** The public website: links in emails to website orders (and its store links). */
  SITE_URL: z.string().url().default('https://tela.africa'),
  /**
   * VTpass wants a customer phone on every bill. Users who signed up by email may not have
   * one yet; their bills carry this business number instead.
   */
  BUSINESS_PHONE: z.string().regex(/^0[789][01]\d{8}$/, 'Use the 11-digit local format, e.g. 08012345678').optional(),
  /** Expo push access token — optional; only needed if "enhanced push security" is on. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

const parsed = envSchema
  .superRefine((e, ctx) => {
    if (process.env.NODE_ENV === 'production' && process.env.DEV_OTP_CODE) {
      ctx.addIssue({ code: 'custom', path: ['DEV_OTP_CODE'], message: 'A fixed OTP would let anyone sign in to any account' });
    }
    if (e.NODE_ENV === 'production' && e.SAYSWITCH_SECRET_KEY.startsWith('sk_test_')) {
      ctx.addIssue({ code: 'custom', path: ['SAYSWITCH_SECRET_KEY'], message: 'Test SaySwitch key in production' });
    }
    if (e.NODE_ENV === 'production' && e.VTPASS_BASE_URL.includes('sandbox')) {
      ctx.addIssue({ code: 'custom', path: ['VTPASS_BASE_URL'], message: 'VTpass sandbox in production' });
    }
    if (e.NODE_ENV === 'production' && !e.TERMII_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['TERMII_API_KEY'], message: 'OTPs cannot be sent without an SMS provider' });
    }
    if (e.NODE_ENV === 'production' && !e.ZEPTOMAIL_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['ZEPTOMAIL_TOKEN'], message: 'Email OTPs cannot be sent without an email provider' });
    }
    if (e.NODE_ENV === 'production' && !e.BUSINESS_PHONE) {
      ctx.addIssue({ code: 'custom', path: ['BUSINESS_PHONE'], message: 'Needed for bills paid by users without a phone number' });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/**
 * A fixed code opens every account, so it reads the raw variable: NODE_ENV above defaults to
 * development, and a deploy that forgot to set it must not fall into this.
 */
export const resolveDevOtp = (nodeEnv: string | undefined, code: string) => (nodeEnv === 'development' ? code : null);

/** Set only in development: every OTP flow takes this code and nothing is sent. */
export const devOtp = { code: resolveDevOtp(process.env.NODE_ENV, env.DEV_OTP_CODE) };

/** Local testing repeats sign-ins far past the real OTP limits. */
export const otpRateLimit = (max: number) => (devOtp.code ? 1000 : max);
