// Nigerian mobile prefixes → the API's airtime provider codes. A guess, not a fact: numbers
// can be ported to another network, so screens pre-select with this and let people change it.

const PREFIXES: Record<string, string[]> = {
  MTN: ['07025', '07026', '0703', '0704', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906', '0913', '0916'],
  GLO: ['0705', '0805', '0807', '0811', '0815', '0905', '0915'],
  AIRTEL: ['0701', '0708', '0802', '0808', '0812', '0901', '0902', '0904', '0907', '0911', '0912'],
  '9MOBILE': ['0809', '0817', '0818', '0908', '0909'],
};

// Longest first, so 07025 (MTN) wins before any shorter 0702 match could.
const lookup = Object.entries(PREFIXES)
  .flatMap(([network, prefixes]) => prefixes.map((prefix) => ({ prefix, network })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

/** "+234 803…", "234803…", "803…" and "0803…" all read as 0803…. */
function localNumber(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234')) return `0${digits.slice(3)}`;
  if (/^[789]/.test(digits)) return `0${digits}`;
  return digits;
}

/** The network a phone number most likely belongs to, once enough of it is typed. */
export function detectNetwork(raw: string): string | null {
  const number = localNumber(raw);
  return lookup.find(({ prefix }) => number.startsWith(prefix))?.network ?? null;
}
