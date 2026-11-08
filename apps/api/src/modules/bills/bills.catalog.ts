import { unprocessable } from '../../lib/errors';
import { redis } from '../../lib/redis';
import type { ServiceId } from '../../lib/schemas';
import { biller } from './providers';
import type { PlanOption } from './providers/biller';

const CACHE_SECONDS = 60 * 60;

/**
 * Our provider codes → VTpass serviceIDs. Codes are what the API returns; names are what
 * the app shows. `verify` = TV: VTpass can look up this provider's smart cards.
 */
export type ProviderEntry = {
  code: string;
  name: string;
  serviceID: string;
  /** Airtime networks: the data-bundle serviceID. */
  dataServiceID?: string;
  verify?: boolean;
  /** Product sells PINs rather than paying an account (WAEC, Spectranet). */
  pins?: boolean;
  /** One provider, several VTpass products: their plans are listed together, labelled. */
  products?: { serviceID: string; label: string }[];
  minAmount?: number;
  /** VTpass's logo for this biller, a file under LOGO_BASE. */
  logo?: string;
};

const ELECTRICITY: ProviderEntry[] = [
  { code: 'IKEDC', name: 'Ikeja Electric', serviceID: 'ikeja-electric', logo: 'Ikeja-Electric-Payment-PHCN.jpg' },
  { code: 'EKEDC', name: 'Eko Electric', serviceID: 'eko-electric', logo: 'Eko-Electric-Payment-PHCN.jpg' },
  { code: 'AEDC', name: 'Abuja Electric', serviceID: 'abuja-electric', logo: 'Abuja-Electric.jpg' },
  { code: 'PHED', name: 'Port Harcourt Electric', serviceID: 'portharcourt-electric', logo: 'Port-Harcourt-Electric.jpg' },
  { code: 'IBEDC', name: 'Ibadan Electric', serviceID: 'ibadan-electric', logo: 'IBEDC-Ibadan-Electricity-Distribution-Company.jpg' },
  { code: 'KEDCO', name: 'Kano Electric', serviceID: 'kano-electric', logo: 'Kano-Electric.jpg' },
  { code: 'KAEDCO', name: 'Kaduna Electric', serviceID: 'kaduna-electric', logo: 'Kaduna-Electric-KAEDCO.jpg' },
  { code: 'JED', name: 'Jos Electric', serviceID: 'jos-electric', logo: 'Jos-Electric-JED.jpg' },
  { code: 'EEDC', name: 'Enugu Electric', serviceID: 'enugu-electric', logo: 'Enugu-Electric-EEDC.jpg' },
  { code: 'BEDC', name: 'Benin Electric', serviceID: 'benin-electric', logo: 'Benin-Electricity-BEDC.jpg' },
  { code: 'ABA', name: 'Aba Power', serviceID: 'aba-electric', logo: 'Aba-Electric-Payment-ABEDC.jpg' },
  { code: 'YEDC', name: 'Yola Electric', serviceID: 'yola-electric', logo: 'Yola-Electric-Payment-IKEDC.jpg' },
].map((p) => ({ ...p, minAmount: 50_000 }));

const NETWORKS: ProviderEntry[] = [
  { code: 'MTN', name: 'MTN', serviceID: 'mtn', dataServiceID: 'mtn-data', minAmount: 5_000, logo: 'MTN-Airtime-VTU.jpg' },
  { code: 'GLO', name: 'Glo', serviceID: 'glo', dataServiceID: 'glo-data', minAmount: 5_000, logo: 'GLO-Airtime.jpg' },
  { code: 'AIRTEL', name: 'Airtel', serviceID: 'airtel', dataServiceID: 'airtel-data', minAmount: 5_000, logo: 'Airtel-Airtime-VTU.jpg' },
  // VTpass still calls 9mobile by its old name.
  { code: '9MOBILE', name: '9mobile', serviceID: 'etisalat', dataServiceID: 'etisalat-data', minAmount: 5_000, logo: '9mobile-Airtime.jpg' },
];

const TV: ProviderEntry[] = [
  { code: 'DSTV', name: 'DStv', serviceID: 'dstv', verify: true, logo: 'Pay-DSTV-Subscription.jpg' },
  { code: 'GOTV', name: 'GOtv', serviceID: 'gotv', verify: true, logo: 'Gotv-Payment.jpg' },
  { code: 'STARTIMES', name: 'StarTimes', serviceID: 'startimes', verify: true, logo: 'Startimes-Subscription.jpg' },
  { code: 'SHOWMAX', name: 'Showmax', serviceID: 'showmax', logo: 'ShowMax.jpg' },
];

const INTERNET: ProviderEntry[] = [
  { code: 'SMILE', name: 'Smile', serviceID: 'smile-direct', logo: 'Smile-Payment.jpg' },
  { code: 'SPECTRANET', name: 'Spectranet', serviceID: 'spectranet', pins: true, logo: 'Spectranet.jpg' },
];

const EXAMS: ProviderEntry[] = [
  { code: 'JAMB', name: 'JAMB', serviceID: 'jamb', logo: 'JAMB-PIN-VENDING-(UTME-&-Direct-Entry).jpg' },
  {
    code: 'WAEC',
    name: 'WAEC',
    serviceID: 'waec',
    pins: true,
    logo: 'WAEC-Result-Checker-PIN.jpg',
    products: [
      { serviceID: 'waec', label: 'Result Checker PIN' },
      { serviceID: 'waec-registration', label: 'Registration PIN' },
    ],
  },
];

const PROVIDERS: Record<ServiceId, ProviderEntry[]> = {
  electricity: ELECTRICITY,
  airtime: NETWORKS,
  tv: TV,
  internet: INTERNET,
  jamb: EXAMS,
  water: [],
};

export type ServiceInfo = {
  id: ServiceId;
  name: string;
  available: boolean;
  accountLabel: string;
};

export const SERVICES: Record<ServiceId, ServiceInfo> = {
  electricity: { id: 'electricity', name: 'Electricity', available: true, accountLabel: 'Meter number' },
  airtime: { id: 'airtime', name: 'Airtime & Data', available: true, accountLabel: 'Phone number' },
  tv: { id: 'tv', name: 'Cable TV', available: true, accountLabel: 'Smart card number' },
  internet: { id: 'internet', name: 'Internet', available: true, accountLabel: 'Smile email or Spectranet phone number' },
  jamb: { id: 'jamb', name: 'Exams', available: true, accountLabel: 'JAMB profile ID, or phone number for WAEC' },
  // VTpass doesn't sell water bills; the app should show this as "coming soon".
  water: { id: 'water', name: 'Water', available: false, accountLabel: 'Account number' },
};

/** True when the price comes from a plan the user picks, not an amount they type. */
export const isPlanBased = (serviceId: ServiceId, product?: 'airtime' | 'data') =>
  serviceId === 'tv' || serviceId === 'internet' || serviceId === 'jamb' || (serviceId === 'airtime' && product === 'data');

// Always the live host: the sandbox is missing about half of these images.
const LOGO_BASE = 'https://vtpass.com/resources/products/200X200/';
const logoUrl = (file: string) => LOGO_BASE + encodeURIComponent(file);

export const planCacheKey = (serviceID: string) => `catalog:plans:${serviceID}`;

export const Catalog = {
  providers: (serviceId: ServiceId) => PROVIDERS[serviceId],

  /** Accepts the code or the display name, any case ("Glo", "GLO", "Ikeja Electric"). */
  resolveProvider(serviceId: ServiceId, input: string): ProviderEntry {
    const wanted = input.trim().toUpperCase();
    // Codes from before the VTpass switch (SaySwitch called Smile "SMILE4G").
    const alias = wanted === 'SMILE4G' ? 'SMILE' : wanted;
    const match = PROVIDERS[serviceId].find((p) => p.code === alias || p.name.toUpperCase() === alias);
    if (!match) throw unprocessable(`We don't support ${input} for ${SERVICES[serviceId].name} yet`, 'PROVIDER_UNSUPPORTED');
    return match;
  },

  /** The VTpass serviceID a bill is sent to. */
  serviceIDFor(serviceId: ServiceId, providerCode: string, product?: 'airtime' | 'data') {
    const p = this.resolveProvider(serviceId, providerCode);
    return serviceId === 'airtime' && product === 'data' ? p.dataServiceID! : p.serviceID;
  },

  async plans(serviceId: ServiceId, providerCode: string, product?: 'airtime' | 'data'): Promise<PlanOption[]> {
    if (!isPlanBased(serviceId, serviceId === 'airtime' ? (product ?? 'data') : product)) return [];
    const { products } = this.resolveProvider(serviceId, providerCode);
    if (products) {
      const lists = await Promise.all(
        products.map(async ({ serviceID, label }) =>
          (await this.plansOf(serviceID)).map((plan) => ({ ...plan, name: `${label}: ${plan.name}`, serviceID })),
        ),
      );
      return lists.flat();
    }
    return this.plansOf(this.serviceIDFor(serviceId, providerCode, serviceId === 'airtime' ? 'data' : product));
  },

  async plansOf(serviceID: string): Promise<PlanOption[]> {
    const key = planCacheKey(serviceID);
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as PlanOption[];
    const plans = await biller.plans(serviceID);
    await redis.set(key, JSON.stringify(plans), 'EX', CACHE_SECONDS);
    return plans;
  },

  async plan(serviceId: ServiceId, providerCode: string, planCode: string, product?: 'airtime' | 'data') {
    const plan = (await this.plans(serviceId, providerCode, product)).find((p) => p.code === planCode);
    if (!plan) throw unprocessable('That plan is no longer available. Pick another', 'PLAN_UNAVAILABLE');
    return plan;
  },

  /** VTpass tells us when prices change; drop the cached plans so the next quote reloads them. */
  async invalidate(serviceID?: string) {
    if (serviceID) return void (await redis.del(planCacheKey(serviceID)));
    const keys = await redis.keys(planCacheKey('*'));
    if (keys.length) await redis.del(...keys);
  },

  services() {
    return Object.values(SERVICES).map((s) => ({
      ...s,
      providers: PROVIDERS[s.id].map(({ code, name, minAmount, pins, logo }) => ({
        code,
        name,
        ...(minAmount && { minAmount }),
        ...(pins && { sellsPins: true }),
        ...(logo && { logo: logoUrl(logo) }),
      })),
    }));
  },
};
