const LAGOS_MS = 3_600_000;

/** Midnight in Lagos at the start of a YYYY-MM-DD, as a UTC instant. */
export const lagosDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - LAGOS_MS);

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
