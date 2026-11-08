/** "2024-01-15" → "15/01/2024" */
export function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** "15/01/2024" → "2024-01-15" (passes through partial input while typing) */
export function displayToIso(display: string): string {
  if (!display) return "";
  const [d, m, y] = display.split("/");
  if (!d || !m || !y || y.length < 4) return display;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Safely parse an ISO date string to a `Date` object in local time. */
export function parseISODate(iso: string): Date | undefined {
  if (!iso || iso.length < 10) return undefined;
  const date = new Date(`${iso}T00:00:00`);
  return isNaN(date.getTime()) ? undefined : date;
}

/** `Date` → "yyyy-mm-dd" using local calendar. */
export function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
