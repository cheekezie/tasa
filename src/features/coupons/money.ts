import { ApiError } from "@/lib/http";
import { nairaForInput, toKobo } from "@/lib/format";

/** Service ids the API knows. Data bundles are `airtime`. */
export const SERVICE_IDS = ["electricity", "airtime", "tv", "water", "internet", "jamb"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const SERVICE_LABELS: Record<ServiceId, string> = {
  electricity: "Electricity",
  airtime: "Airtime & data",
  tv: "TV",
  water: "Water",
  internet: "Internet",
  jamb: "Exams (JAMB)",
};

export const serviceLabel = (id: string) => SERVICE_LABELS[id as ServiceId] ?? id;

/** "1,500.50" typed by a person → kobo, or null when it isn't a number. */
export function koboFromInput(value: string): number | null {
  const cleaned = value.replace(/[,\s₦]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? toKobo(n) : null;
}

/** Kobo → what goes back into a naira input when editing. */
export const inputFromKobo = nairaForInput;

/** The API's field errors, or none. */
export const fieldErrors = (error: unknown): Record<string, string> => (error instanceof ApiError && error.errors ? error.errors : {});

/** ISO → the value a datetime-local input wants, in the browser's time. */
export function localInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Badge colour for a coupon or promo status. */
export const statusVariant = (status: string) =>
  (({ active: "success", paused: "warning", expired: "inactive", cancelled: "closed" }) as const)[status as "active"] ?? "neutral";
