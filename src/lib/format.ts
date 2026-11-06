/** Money arrives in kobo everywhere. */
export const naira = (kobo: number | null | undefined, opts: { compact?: boolean } = {}) => {
  if (kobo === null || kobo === undefined) return "—";
  const value = kobo / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
    ...(opts.compact && { notation: "compact" }),
  }).format(value);
};

/** Kobo → the text a naira input starts with when editing: "10.5" stays "10.50", whole naira stay whole. Integer maths only. */
export const nairaForInput = (kobo: number | null | undefined) => {
  if (kobo === null || kobo === undefined) return "";
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(kobo));
  const rest = abs % 100;
  return `${sign}${Math.trunc(abs / 100)}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
};

/** Naira typed by a person → kobo for the API. The only place naira becomes kobo. */
export const toKobo = (naira: number) => Math.round(naira * 100);

export const count = (n: number | null | undefined) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("en-NG").format(n));

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso)) : "—";

export const date = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(new Date(iso)) : "—";

/** "2026-11-01", Lagos time: what the reports' from/to take. */
export const lagosDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d);

export const percent = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`);

export const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
