/**
 * Money is integer kobo everywhere inside the API and in every response.
 * Only the SaySwitch adapter converts, because SaySwitch speaks decimal naira.
 */
export const nairaToKobo = (naira: number | string) => Math.round(Number(naira) * 100);
export const koboToNaira = (kobo: number) => kobo / 100;

export const formatNaira = (kobo: number) =>
  `₦${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const isKobo = (v: number) => Number.isInteger(v) && v >= 0;
