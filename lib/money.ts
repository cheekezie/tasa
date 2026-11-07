// Money is integer kobo everywhere: API responses, state, arithmetic and comparisons. Only the
// formatter (formatNaira) turns it into naira, and only the input parser (nairaToKobo, via
// parseAmountInput) turns typed naira into kobo. `Kobo` is branded so a stray naira number won't
// type-check where money is expected.

export type Kobo = number & { readonly __kobo: true };

/**
 * Marks a number as kobo. Only for values the API sent as kobo and for literal kobo constants
 * (`kobo(10_000)` is ₦100). Never for a naira value: that's what nairaToKobo is for.
 */
export const kobo = (n: number) => n as Kobo;

export const addKobo = (a: Kobo, b: Kobo) => kobo(a + b);

export const subtractKobo = (a: Kobo, b: Kobo) => kobo(a - b);

export const sumKobo = (amounts: readonly Kobo[]) => amounts.reduce(addKobo, kobo(0));

export const minKobo = (...amounts: Kobo[]) => kobo(Math.min(...amounts));

export const maxKobo = (...amounts: Kobo[]) => kobo(Math.max(...amounts));

/** The mean, to the nearest kobo, the way the API rounds its own averages. */
export const averageKobo = (amounts: readonly Kobo[]) =>
  amounts.length > 0 ? kobo(Math.round(sumKobo(amounts) / amounts.length)) : kobo(0);

/**
 * To the nearest whole naira, for figures people read as rough guides (averages). Display only:
 * never for an amount anyone pays or is paid, which stays exact to the kobo.
 */
export const roundToNaira = (amount: Kobo) => kobo(Math.round(amount / 100) * 100);

/** `count` of something priced at `amount`: tickets × price, points × point value. Whole counts only. */
export const timesKobo = (amount: Kobo, count: number) => kobo(amount * count);

/** Reads back an amount the app put in a route param with `String(amount)`: it's kobo already. */
export const koboFromParam = (param: string | undefined) => kobo(Number(param) || 0);

/** The one place naira becomes kobo: only for what a person typed. */
export const nairaToKobo = (naira: number) => kobo(Math.round(naira * 100));

/** Typed digits as kobo: people type whole naira on a number pad. */
export function parseAmountInput(text: string) {
  // Anything after a decimal point is a prefilled amount's kobo; editing drops it.
  const digits = text.split('.')[0].replace(/\D/g, '').slice(0, 9);
  return nairaToKobo(digits ? Number(digits) : 0);
}

/** What an amount field shows: blank until there's an amount, e.g. 2_500_000 → "₦25,000". */
export const formatAmountInput = (amount: Kobo) => (amount > 0 ? formatNaira(amount) : '');

const wholeNaira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const wholeNumber = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });

/** "₦25,000", or "₦10.50" when there are kobo; compact gives "₦1.2K" / "₦3.4M" from ₦1,000 up. */
export function formatNaira(amount: Kobo, compact = false) {
  if (compact && amount >= 1_000_000_00) return `₦${tenths(amount, 1_000_000_00)}M`;
  if (compact && amount >= 1_000_00) return `₦${tenths(amount, 1_000_00)}K`;
  return withKobo(amount, wholeNaira);
}

/** The number alone, for a field that shows the ₦ beside it: 2_500_000 → "25,000". */
export const formatNairaNumber = (amount: Kobo) => withKobo(amount, wholeNumber);

// Integer split, then Intl for the naira: so ₦0.29 never shows as ₦0.28.
function withKobo(amount: Kobo, format: Intl.NumberFormat) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const rest = abs % 100;
  const whole = format.format((abs - rest) / 100);
  return `${sign}${rest === 0 ? whole : `${whole}.${String(rest).padStart(2, '0')}`}`;
}

/** `amount` in units of `unit` kobo, to one decimal place, e.g. 123_456_00 in thousands → "123.5". */
function tenths(amount: number, unit: number) {
  const count = Math.round((amount * 10) / unit);
  return `${Math.trunc(count / 10)}.${count % 10}`;
}
