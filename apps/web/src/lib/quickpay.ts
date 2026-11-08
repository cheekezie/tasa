/** What can be bought on the website without the app. Each maps to an API service (and provider). */
export type ProductSlug = 'jamb' | 'waec' | 'electricity' | 'airtime';

export type Product = {
  slug: ProductSlug;
  serviceId: 'jamb' | 'electricity' | 'airtime';
  /** Fixed for exam PINs; chosen from a list for the rest. */
  provider?: string;
  title: string;
  blurb: string;
  accountLabel: string;
  accountHint: string;
  accountInput: 'numeric' | 'tel';
  /** Priced by a plan (exam PINs) or by an amount they type. */
  priced: 'plan' | 'amount';
  /** Checked with the provider before ordering (shows the owner's name). */
  verify: boolean;
  /** Naira. */
  minAmount?: number;
};

export const PRODUCTS: Product[] = [
  {
    slug: 'jamb',
    serviceId: 'jamb',
    provider: 'JAMB',
    title: 'JAMB PIN',
    blurb: 'UTME and Direct Entry e-PINs, sent to your phone in seconds.',
    accountLabel: 'JAMB profile code',
    accountHint: 'The profile code JAMB sent you after you registered your NIN.',
    accountInput: 'numeric',
    priced: 'plan',
    verify: true,
  },
  {
    slug: 'waec',
    serviceId: 'jamb',
    provider: 'WAEC',
    title: 'WAEC PIN',
    blurb: 'Result checker and registration PINs.',
    accountLabel: 'Your phone number',
    accountHint: 'The PIN is tied to this number and texted to it.',
    accountInput: 'tel',
    priced: 'plan',
    verify: false,
  },
  {
    slug: 'electricity',
    serviceId: 'electricity',
    title: 'Electricity token',
    blurb: 'Prepaid and postpaid meters on every DisCo. Token by SMS.',
    accountLabel: 'Meter number',
    accountHint: 'We check it with your DisCo and show the name on the meter.',
    accountInput: 'numeric',
    priced: 'amount',
    verify: true,
    minAmount: 1000,
  },
  {
    slug: 'airtime',
    serviceId: 'airtime',
    title: 'Airtime',
    blurb: 'MTN, Airtel, Glo and 9mobile top-ups.',
    accountLabel: 'Phone number to top up',
    accountHint: 'Any Nigerian number.',
    accountInput: 'tel',
    priced: 'amount',
    verify: false,
    minAmount: 50,
  },
];

export const productBySlug = (slug: string) => PRODUCTS.find((p) => p.slug === slug);

/** The largest order on the website, in naira (the API holds the real limit). */
export const MAX_NAIRA = 50_000;

export const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
