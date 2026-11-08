import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { env } from "./env";

/** What the API says went wrong. `message` is written for people; branch on `code`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, errors?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

type Envelope<T> =
  | { success: true; statusCode: number; data: T }
  | { success: false; statusCode: number; code?: string; message: string; errors?: Record<string, string> };

/** Set by the auth store, so this file never imports it (and never loops). */
type TokenBridge = {
  access: () => string | null;
  refresh: () => string | null;
  save: (tokens: { accessToken: string; refreshToken: string }) => void;
  signOut: () => void;
};
let tokens: TokenBridge = { access: () => null, refresh: () => null, save: () => {}, signOut: () => {} };
export const bindTokens = (bridge: TokenBridge) => {
  tokens = bridge;
};

export const http = axios.create({ baseURL: env.VITE_API_URL, timeout: 30_000 });

http.interceptors.request.use((config) => {
  const token = tokens.access();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// One refresh at a time: every request that 401s while it runs waits for the same answer.
let refreshing: Promise<string | null> | null = null;
async function refreshAccess() {
  const refreshToken = tokens.refresh();
  if (!refreshToken) return null;
  refreshing ??= axios
    .post<Envelope<{ accessToken: string; refreshToken: string }>>(`${env.VITE_API_URL}/auth/refresh`, { refreshToken })
    .then(({ data }) => {
      if (!data.success) return null;
      tokens.save(data.data);
      return data.data.accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

http.interceptors.response.use(undefined, async (error: AxiosError<Envelope<unknown>>) => {
  const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
  const isAuthCall = original?.url?.startsWith("/auth/");
  if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
    original._retried = true;
    const access = await refreshAccess();
    if (access) return http(original);
    tokens.signOut();
  }
  // A file request (responseType "blob") gets its error as a blob too: read the envelope out of it.
  let body: Envelope<unknown> | undefined = error.response?.data;
  if (body instanceof Blob && body.type.includes("json")) {
    body = await body
      .text()
      .then((text) => JSON.parse(text) as Envelope<unknown>)
      .catch(() => undefined);
  }
  if (body && body.success === false) {
    throw new ApiError(body.statusCode, body.code ?? "ERROR", body.message, body.errors);
  }
  throw new ApiError(
    error.response?.status ?? 0,
    error.code === "ECONNABORTED" ? "TIMEOUT" : "NETWORK_ERROR",
    error.response ? "Something went wrong. Try again." : "Can't reach the Tasa API. Check your connection.",
  );
});

/** The API's envelope, unwrapped: callers get `data` or an ApiError. */
export const api = {
  get: async <T>(url: string, params?: Record<string, unknown>) =>
    (await http.get<Envelope<T> & { success: true }>(url, { params: clean(params) })).data.data,
  post: async <T>(url: string, body?: unknown) => (await http.post<Envelope<T> & { success: true }>(url, body)).data.data,
  put: async <T>(url: string, body?: unknown) => (await http.put<Envelope<T> & { success: true }>(url, body)).data.data,
  patch: async <T>(url: string, body?: unknown) => (await http.patch<Envelope<T> & { success: true }>(url, body)).data.data,
  delete: async <T>(url: string) => (await http.delete<Envelope<T> & { success: true }>(url)).data.data,
};

/** Drops empty filters, so `?status=` isn't sent for "any". */
function clean(params?: Record<string, unknown>) {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null && v !== "all"));
}

/** A page of results, as every admin list returns them. */
export type { Paginated } from "@tasa/contracts/common";
