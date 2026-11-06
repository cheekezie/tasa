import { env } from "./env";

type Level = "debug" | "info" | "warn" | "error";
type Threshold = Level | "silent";

const LEVELS: Record<Threshold, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

const threshold = LEVELS[env.VITE_LOG_LEVEL ?? (env.MODE === "production" ? "error" : "debug")];

function log(level: Level, event: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const entry = { level, event, time: new Date().toISOString(), ...data };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => log("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => log("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => log("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => log("error", event, data),
};
