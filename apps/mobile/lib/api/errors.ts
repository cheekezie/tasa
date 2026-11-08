import { formatNaira } from '@/lib/format';
import i18n from '@/lib/i18n';
import { kobo } from '@/lib/money';

export type ApiErrorInit = {
  status: number;
  code: string;
  /** The API's own words. Missing when the response wasn't one of ours (a proxy page, say). */
  message?: string | null;
  errors?: Record<string, string>;
};

/** A failed request. `status` is 0 when no response came back (offline or timed out). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: Record<string, string>;
  /** The backend's message, untranslated, or null when it sent none. */
  readonly serverMessage: string | null;

  constructor({ status, code, message, errors }: ApiErrorInit) {
    const serverMessage = message?.trim() || null;
    super(serverMessage ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors ?? {};
    this.serverMessage = serverMessage;
  }

  /** No answer, or the server broke mid-request: a money action may or may not have happened. */
  get outcomeUnknown() {
    return this.status === 0 || this.status >= 500;
  }

  /** What's missing for `INSUFFICIENT_FUNDS`. The API sends it in kobo under `errors.shortfall`. */
  get shortfall() {
    return kobo(Number(this.errors.shortfall) || 0);
  }
}

export const networkError = (timedOut: boolean) =>
  new ApiError({ status: 0, code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' });

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

export const hasCode = (error: unknown, ...codes: string[]) =>
  isApiError(error) && codes.includes(error.code);

/** Our own line for a failure the API didn't explain, by what kind of failure it was. */
function statusMessage({ status, code }: ApiError) {
  if (status === 0) return i18n.t(code === 'TIMEOUT' ? 'errors.timeout' : 'errors.network');
  if (status === 401) return i18n.t('errors.unauthorized');
  if (status === 403) return i18n.t('errors.forbidden');
  if (status === 404) return i18n.t('errors.notFound');
  if (status === 409) return i18n.t('errors.conflict');
  if (status === 429) return i18n.t('apiErrors.RATE_LIMITED');
  if (status >= 500) return i18n.t('errors.server');
  if (status >= 400) return i18n.t('errors.badRequest');
  return i18n.t('errors.generic');
}

/**
 * What to tell the user about a failure, in this order:
 * 1. A code we have words for (`apiErrors` in the locale files), so it reads in their language.
 * 2. Otherwise the API's own message, as sent: it knows what went wrong better than we do.
 * 3. Otherwise our line for that kind of failure (offline, timed out, server error…).
 */
export function errorMessage(error: unknown) {
  if (!isApiError(error)) return i18n.t('errors.generic');
  const key = `apiErrors.${error.code}`;
  if (i18n.exists(key)) {
    // Codes are only known at runtime, so the key can't be checked against the locale types.
    return i18n.t(key as 'errors.generic', { amount: formatNaira(error.shortfall) });
  }
  return error.serverMessage ?? statusMessage(error);
}
