import { env } from '../../../config/env';

export type PushMessage = { to: string[]; title: string; body: string; data?: Record<string, unknown> };

/** Expo push service — the app registers its ExpoPushToken via POST /api/me/push-tokens. */
export async function sendPush(msg: PushMessage) {
  if (msg.to.length === 0) return { invalidTokens: [] as string[] };
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(env.EXPO_ACCESS_TOKEN && { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }),
    },
    body: JSON.stringify(msg.to.map((to) => ({ to, title: msg.title, body: msg.body, data: msg.data, sound: 'default' }))),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Expo push ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
  // Tokens for uninstalled apps come back as DeviceNotRegistered; the caller prunes them.
  const invalidTokens = (json.data ?? [])
    .map((r, i) => (r.details?.error === 'DeviceNotRegistered' ? msg.to[i] : undefined))
    .filter((t): t is string => Boolean(t));
  return { invalidTokens };
}
