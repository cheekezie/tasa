import type { IconName } from '@/components/ui/Icon';
import type { Kobo } from '@/lib/money';

import { ServiceId } from './theme';

export type { ServiceId };

export type UtilityService = {
  id: ServiceId;
  name: string;
  subtitle: string;
  icon: IconName;
  providers: string[];
};

export type SpendingPoint = { month: string; amount: Kobo };

export type BankAccount = { bankName: string; accountNumber: string; accountName: string };

export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export type RecurringBill = {
  id: string;
  active: boolean;
  serviceId: ServiceId;
  label: string;
  amount: Kobo;
  nextDate: string;
  frequency: RecurringFrequency;
  beneficiaryId?: string;
  /** Optional only for schedules saved before these fields existed. */
  provider?: string;
  /** Meter, smart card, phone or account number the payment goes to. */
  accountNumber?: string;
  /** Set on bundles and packages; their price comes from the plan. */
  planCode?: string;
};

export type Beneficiary = {
  id: string;
  label: string;
  serviceId: ServiceId;
  accountNumber: string;
  provider: string;
  /** The account owner's name as the provider gave it when saved, e.g. on the meter. */
  customerName: string | null;
  autoPay: boolean;
  /** Null until the user accepts the auto-pay terms. */
  virtualAccount: BankAccount | null;
};

export type Coupon = {
  id: string;
  kind: 'coupon' | 'gift' | 'promo';
  /** The viewer's own spend on it, once they've used it. */
  myBalance: { amount: Kobo; used: Kobo; left: Kobo } | null;
  status: string;
  isOwner: boolean;
  code: string;
  title: string;
  amount: Kobo;
  quantity: number;
  redeemed: number;
  services: ServiceId[] | 'all';
  expiresAt: string;
};

export type TransactionStatus = 'pending' | 'success' | 'failed' | 'expired' | 'reversed';

export type ActivityItem = {
  id: string;
  type: 'payment' | 'fund' | 'transfer' | 'gift' | 'coupon';
  title: string;
  subtitle: string;
  status: TransactionStatus;
  amount: Kobo;
  direction: 'debit' | 'credit';
  date: string;
  serviceId?: ServiceId;
  beneficiaryId?: string;
  /** Receipt details. Older entries may not have them, so every one is optional. */
  reference?: string;
  method?: 'wallet' | 'bankTransfer' | 'virtualAccount';
  provider?: string;
  accountNumber?: string;
  recipient?: string;
  note?: string;
  fee?: Kobo;
  discount?: Kobo;
  couponCode?: string;
  token?: string;
  units?: string;
  pins?: { pin: string; serial: string | null }[];
  /** Set on your own bills: what's needed to buy the same thing again. */
  rebuy?: {
    provider: string;
    account: string;
    amount: Kobo;
    product: 'airtime' | 'data' | null;
    meterType: 'prepaid' | 'postpaid' | null;
    planCode: string | null;
  };
};

export const utilityServices: UtilityService[] = [
  {
    id: 'electricity',
    name: 'Electricity',
    subtitle: 'IKEDC, EKEDC, AEDC & more',
    icon: { ios: 'bolt.fill', android: 'bolt' },
    providers: ['IKEDC', 'EKEDC', 'AEDC', 'PHED'],
  },
  {
    id: 'airtime',
    name: 'Airtime & Data',
    subtitle: 'MTN, Glo, Airtel, 9mobile',
    icon: { ios: 'iphone', android: 'smartphone' },
    providers: ['MTN', 'Glo', 'Airtel', '9mobile'],
  },
  {
    id: 'tv',
    name: 'Cable TV',
    subtitle: 'DStv, GOtv, StarTimes',
    icon: { ios: 'tv.fill', android: 'tv' },
    providers: ['DStv', 'GOtv', 'StarTimes'],
  },
  {
    id: 'water',
    name: 'Water',
    subtitle: 'State water boards',
    icon: { ios: 'drop.fill', android: 'water_drop' },
    providers: ['LWC', 'FCT Water Board'],
  },
  {
    id: 'internet',
    name: 'Internet',
    subtitle: 'Spectranet, Smile & more',
    icon: { ios: 'wifi', android: 'wifi' },
    providers: ['Spectranet', 'Smile', 'Swift'],
  },
  {
    id: 'jamb',
    name: 'Exams',
    subtitle: 'JAMB, WAEC, NECO PINs & fees',
    icon: { ios: 'graduationcap.fill', android: 'school' },
    providers: ['JAMB', 'WAEC', 'NECO'],
  },
];

/** What the priced choice is called: a TV package, an exam service, otherwise a plan. */
export const planCopy = (service: ServiceId) =>
  service === 'jamb'
    ? ({ section: 'bill.service', title: 'bill.service', placeholder: 'bill.chooseService' } as const)
    : service === 'tv'
      ? ({ section: 'bill.choosePlan', title: 'bill.package', placeholder: 'bill.choosePackage' } as const)
      : ({ section: 'bill.choosePlan', title: 'bill.plan', placeholder: 'bill.choosePlanShort' } as const);

export const accountNumberLabels: Record<ServiceId, string> = {
  electricity: 'Meter number',
  airtime: 'Phone number',
  tv: 'Smart card number',
  water: 'Account number',
  internet: 'Account number',
  jamb: 'Registration / candidate number',
};

export function getServiceColor(id: ServiceId) {
  const map = {
    electricity: '#FFB020',
    airtime: '#5B8DEF',
    tv: '#9B59B6',
    water: '#3498DB',
    internet: '#1ABC9C',
    jamb: '#2ECC71',
  } as const;
  return map[id];
}

export function getServiceById(id: ServiceId) {
  return utilityServices.find((service) => service.id === id)!;
}
