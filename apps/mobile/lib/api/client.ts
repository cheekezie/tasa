// The one place that talks to the Tasa API. Screens never call this directly: they go through
// lib/api/services, usually via a hook in hooks/.
import { ApiError, networkError } from './errors';
import { Tokens, clearTokens, getTokens, saveTokens } from './tokens';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4110/api';

const DEFAULT_TIMEOUT_MS = 20_000;

type Query = Record<string, string | number | boolean | undefined | null>;

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Sign-in calls send no token and must not trigger a refresh. */
  auth?: boolean;
  timeoutMs?: number;
};

type Outgoing = { path: string; init: RequestInit; options: RequestOptions };

/** Runs before every send; replays after a refresh run it again, so they pick up the new token. */
type RequestInterceptor = (request: Outgoing) => Outgoing;

type Envelope<T> =
  | { success: true; statusCode: number; message?: string; data: T }
  | {
      success: false;
      statusCode: number;
      code?: string;
      message: string;
      errors?: Record<string, string>;
    };

const jsonHeaders: RequestInterceptor = (request) => ({
  ...request,
  init: {
    ...request.init,
    headers: {
      Accept: 'application/json',
      // fetch sets the multipart boundary itself, so FormData must not get a type here.
      ...(request.init.body && !(request.init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...request.init.headers,
    },
  },
});

const bearerToken: RequestInterceptor = (request) => {
  const token = getTokens()?.accessToken;
  if (request.options.auth === false || !token) return request;
  return {
    ...request,
    init: {
      ...request.init,
      headers: { ...request.init.headers, Authorization: `Bearer ${token}` },
    },
  };
};

// Method and path only: bodies carry PINs, BVNs and tokens.
const devLog: RequestInterceptor = (request) => {
  if (__DEV__) console.debug(`[api] ${request.init.method} ${request.path}`);
  return request;
};

const requestInterceptors = [jsonHeaders, bearerToken, devLog];

function toUrl(path: string, query?: Query) {
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${API_URL}${path}${params ? `?${params}` : ''}`;
}

/** One network round trip: applies the timeout and turns the envelope into data or an ApiError. */
async function send<T>({ path, init, options }: Outgoing): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(toUrl(path, options.query), { ...init, signal: controller.signal });
  } catch (error) {
    // Not every failure here is the network: an unsendable body throws too, so show the cause.
    if (__DEV__) console.warn(`[api] ${init.method} ${path} failed`, error);
    throw networkError(timedOut);
  } finally {
    clearTimeout(timer);
  }

  let envelope: Envelope<T> | null = null;
  try {
    envelope = await response.json();
  } catch {
    // Proxies answer with HTML; handled below as an error with no envelope.
  }
  if (envelope?.success) return envelope.data;
  // The server did answer, so this is never "can't reach Tasa". With no message of its own,
  // errorMessage() falls back to a line for the status code.
  throw new ApiError({
    status: response.status,
    code: (envelope && 'code' in envelope && envelope.code) || 'UNEXPECTED_RESPONSE',
    message: readMessage(envelope),
    errors: envelope && 'errors' in envelope ? envelope.errors : undefined,
  });
}

/** The message from an error body, including ones not shaped like ours (gateways, frameworks). */
function readMessage(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const { message, error, detail } = body as Record<string, unknown>;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  if (typeof detail === 'string') return detail;
  if (typeof error === 'string') return error;
  return null;
}

let onSessionExpired: () => void = () => {};

/** AppContext registers here so a dead session drops the user back to sign-in. */
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

let refreshing: Promise<void> | null = null;

async function refreshTokens(refreshToken: string) {
  try {
    const tokens = await send<Tokens>({
      path: '/auth/refresh',
      init: {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      },
      options: { auth: false },
    });
    await saveTokens(tokens);
  } catch (error) {
    // Only a clear "no" from the server ends the session; being offline must not sign anyone out.
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      await clearTokens();
      onSessionExpired();
    }
    throw error;
  }
}

/**
 * Refresh tokens rotate, and reusing an old one signs out every device in that session. So
 * however many requests hit a 401 together, exactly one refresh goes out and the rest wait for it.
 */
function refreshOnce(refreshToken: string) {
  refreshing ??= refreshTokens(refreshToken).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const outgoing: Outgoing = {
    path,
    options,
    init: {
      method: options.method ?? 'GET',
      body:
        options.body === undefined || options.body instanceof FormData
          ? (options.body as FormData | undefined)
          : JSON.stringify(options.body),
    },
  };
  const prepare = () =>
    requestInterceptors.reduce((next, interceptor) => interceptor(next), outgoing);

  const usedToken = getTokens();
  try {
    return await send<T>(prepare());
  } catch (error) {
    const expired = error instanceof ApiError && error.status === 401;
    if (!expired || options.auth === false || !usedToken) throw error;

    // A 401 means nothing ran on the server, so replaying once is safe even for payments.
    // If another request already rotated the tokens, just use the new ones.
    if (getTokens()?.accessToken === usedToken.accessToken) {
      await refreshOnce(usedToken.refreshToken);
    }
    return send<T>(prepare());
  }
}
