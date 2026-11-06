type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export const env = {
  MODE: import.meta.env.MODE,
  /** The Tela API, including /api. */
  VITE_API_URL: (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4110/api",
  VITE_LOG_LEVEL: (import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined) || undefined,
};
