import { env } from '../../../config/env';

export interface SmsProvider {
  name: string;
  send(to: string, body: string): Promise<void>;
}

/** Termii — widely used Nigerian SMS gateway. The DND route reaches numbers on Do-Not-Disturb, which OTPs must. */
const termii: SmsProvider = {
  name: 'termii',
  async send(to, body) {
    const res = await fetch('https://v3.api.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TERMII_API_KEY,
        to: to.replace('+', ''),
        from: env.TERMII_SENDER_ID,
        sms: body,
        type: 'plain',
        channel: 'dnd',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Termii ${res.status}: ${await res.text()}`);
  },
};

/** Development fallback — prints instead of sending. */
const consoleProvider: SmsProvider = {
  name: 'console',
  async send(to, body) {
    if (env.NODE_ENV !== 'test') console.info(`[sms → ${to}] ${body}`);
  },
};

export const sms: SmsProvider = env.TERMII_API_KEY ? termii : consoleProvider;
