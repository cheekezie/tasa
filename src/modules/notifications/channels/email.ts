import { env } from '../../../config/env';

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<void>;
}

/** ZeptoMail transactional API (Zoho) — the same provider eduspace uses. */
const zeptomail: EmailProvider = {
  name: 'zeptomail',
  async send(msg) {
    const res = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: env.ZEPTOMAIL_TOKEN!.startsWith('Zoho-enczapikey') ? env.ZEPTOMAIL_TOKEN! : `Zoho-enczapikey ${env.ZEPTOMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        from: { address: env.EMAIL_FROM_ADDRESS, name: env.EMAIL_FROM_NAME },
        to: [{ email_address: { address: msg.to } }],
        subject: msg.subject,
        textbody: msg.text,
        ...(msg.html && { htmlbody: msg.html }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ZeptoMail ${res.status}: ${await res.text()}`);
  },
};

/** Development fallback — prints instead of sending. */
const consoleProvider: EmailProvider = {
  name: 'console',
  async send(msg) {
    if (env.NODE_ENV !== 'test') console.info(`[email → ${msg.to}] ${msg.subject}: ${msg.text}`);
  },
};

export const email: EmailProvider = env.ZEPTOMAIL_TOKEN ? zeptomail : consoleProvider;
