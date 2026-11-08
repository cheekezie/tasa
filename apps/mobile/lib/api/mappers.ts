// API responses → the models screens use. Money stays integer kobo: nothing here converts it.
import {
  ActivityItem,
  Beneficiary,
  Coupon,
  RecurringBill,
  ServiceId,
  SpendingPoint,
} from '@/constants/data';

import { Kobo, kobo, subtractKobo } from '@/lib/money';

import {
  BeneficiaryDto,
  BillServiceDto,
  ChargeDto,
  CouponDto,
  CustomerDto,
  GiftHistoryItemDto,
  GiftInboxDto,
  GiftInboxItemDto,
  InsightsDto,
  PlanDto,
  PointsEntryDto,
  PointsSummaryDto,
  ProfileDto,
  QuoteDto,
  OwnerEventDto,
  RecurringDto,
  EventDto,
  SellerDto,
  SpendingDto,
  TicketDto,
  TicketFeesDto,
  TransactionDto,
} from './types';

export type UserProfile = {
  /** Legal name; locked once the BVN is verified. */
  fullName: string;
  username: string;
  phone: string;
  email: string;
  /** Last four digits only: the full BVN never leaves the server. */
  bvnLast4: string | null;
  /** Reviewed by hand. Rejected means erased, so they can submit a corrected one. */
  bvnStatus: 'pending' | 'verified' | 'rejected' | null;
  bvnRejectionReason: string | null;
  hasPin: boolean;
  /** Off means bill payments skip the PIN. A new sign-in turns it back on. */
  billPinEnabled: boolean;
  /** Public URL of the photo in R2. */
  avatarUri: string | null;
};

export type Account = {
  profile: UserProfile;
  walletBalance: Kobo;
  payday: number | null;
  giftsUnseen: number;
  giftsBalance: Kobo;
};

/** API phones are +234…; the app shows and validates the local 0803… form. */
const localPhone = (phone: string | null) => (phone ? phone.replace(/^\+234/, '0') : '');

export function toProfile(dto: ProfileDto): UserProfile {
  return {
    fullName: dto.fullName ?? '',
    username: dto.username ?? '',
    phone: localPhone(dto.phone),
    email: dto.email ?? '',
    bvnLast4: dto.bvn?.last4 ?? null,
    bvnStatus: dto.bvn?.status ?? null,
    bvnRejectionReason: dto.bvn?.rejectionReason ?? null,
    avatarUri: dto.avatarUrl ?? null,
    hasPin: dto.hasPin,
    billPinEnabled: dto.billPinEnabled ?? true,
  };
}

export function toAccount(dto: ProfileDto): Account {
  return {
    profile: toProfile(dto),
    walletBalance: dto.walletBalance ?? kobo(0),
    payday: dto.payday,
    giftsUnseen: dto.gifts?.unseen ?? 0,
    giftsBalance: dto.gifts?.balance ?? kobo(0),
  };
}

export type Quote = {
  id: string;
  amount: Kobo;
  charges: ChargeDto[];
  fee: Kobo;
  discount: Kobo;
  total: Kobo;
  expiresAt: string;
  pointsToEarn: number;
  customer: CustomerDto | null;
  planName: string | null;
  coupon: QuoteDto['coupon'] | null;
  transfer: QuoteDto['transfer'] | null;
  gift: QuoteDto['gift'] | null;
};

export function toQuote(dto: QuoteDto): Quote {
  return {
    id: dto.id,
    amount: dto.amount,
    charges: dto.charges,
    fee: dto.fee,
    discount: dto.discount,
    total: dto.total,
    expiresAt: dto.expiresAt,
    pointsToEarn: dto.pointsToEarn ?? 0,
    customer: dto.bill?.customer ?? null,
    planName: dto.bill?.planName ?? null,
    coupon: dto.coupon ?? null,
    transfer: dto.transfer ?? null,
    gift: dto.gift ?? null,
  };
}

export type BillProvider = { code: string; name: string; minAmount?: Kobo; logo: string | null };
export type BillService = { id: ServiceId; available: boolean; pausedMessage: string | null; providers: BillProvider[] };
export type Plan = { code: string; name: string; amount: Kobo };

export function toBillService(dto: BillServiceDto): BillService {
  return {
    id: dto.id,
    available: dto.available,
    pausedMessage: dto.pausedMessage ?? null,
    providers: dto.providers.map(({ code, name, minAmount, logo }) => ({
      code,
      name,
      minAmount,
      logo: logo ?? null,
    })),
  };
}

export const toPlan = (dto: PlanDto): Plan => dto;

const METHOD_BY_TYPE: Partial<Record<TransactionDto['type'], ActivityItem['method']>> = {
  fund: 'bankTransfer',
  payment: 'wallet',
  transfer: 'wallet',
  gift: 'wallet',
  coupon: 'wallet',
};

export function toActivityItem(dto: TransactionDto): ActivityItem {
  const counterparty = dto.counterparty;
  const recipient =
    dto.giftTo?.name ??
    dto.giftTo?.recipient ??
    (counterparty?.username ? `@${counterparty.username}` : (counterparty?.name ?? undefined));
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    title: dto.title,
    subtitle: dto.subtitle,
    // What the wallet actually moved by: includes charges, excludes discounts.
    amount: dto.direction === 'debit' ? dto.total : dto.amount,
    direction: dto.direction,
    date: dto.date,
    serviceId: dto.serviceId ?? undefined,
    beneficiaryId: dto.beneficiaryId ?? undefined,
    reference: dto.reference,
    // Converted points are a wallet credit, not a bank transfer.
    method: dto.kind === 'points_redemption' ? undefined : METHOD_BY_TYPE[dto.type],
    provider: dto.bill?.provider,
    accountNumber: dto.bill?.account,
    recipient,
    note: dto.giftTo?.message ?? undefined,
    fee: dto.fee || undefined,
    discount: dto.discount || undefined,
    couponCode: dto.coupon?.code,
    token: dto.bill?.token ?? undefined,
    units: dto.bill?.units ?? undefined,
    pins: dto.bill?.pins ?? undefined,
    // A gift was for someone else's account, so it isn't theirs to repeat.
    rebuy:
      dto.bill && !dto.giftTo
        ? {
            provider: dto.bill.provider,
            account: dto.bill.account,
            amount: dto.amount,
            product: dto.bill.product,
            meterType: dto.bill.meterType,
            planCode: dto.bill.planCode,
          }
        : undefined,
  };
}

export type Funding = {
  reference: string;
  status: TransactionDto['status'];
  amount: Kobo;
  total: Kobo;
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** Epoch ms after which the account stops accepting this transfer. */
  expiresAt: number;
};

export function toFunding(dto: TransactionDto): Funding {
  return {
    reference: dto.reference,
    status: dto.status,
    amount: dto.amount,
    total: dto.total,
    bankName: dto.funding?.bankName ?? '',
    accountNumber: dto.funding?.accountNumber ?? '',
    accountName: dto.funding?.accountName ?? '',
    expiresAt: dto.funding ? new Date(dto.funding.expiresAt).getTime() : 0,
  };
}

export type Insights = { series: SpendingPoint[]; total: Kobo; average: Kobo };

export function toInsights(dto: InsightsDto): Insights {
  return {
    series: dto.series.map(({ label, amount }) => ({ month: label, amount })),
    total: dto.total,
    average: dto.average,
  };
}

export const toBeneficiary = (dto: BeneficiaryDto): Beneficiary => ({
  id: dto.id,
  label: dto.label,
  serviceId: dto.serviceId,
  provider: dto.provider,
  accountNumber: dto.accountNumber,
  customerName: dto.customerName ?? null,
  autoPay: dto.autoPay,
  virtualAccount: dto.virtualAccount,
});

export const toRecurringBill = (dto: RecurringDto): RecurringBill => ({
  id: dto.id,
  active: dto.active,
  serviceId: dto.serviceId,
  label: dto.label,
  amount: dto.amount,
  nextDate: dto.nextDate,
  frequency: dto.frequency,
  beneficiaryId: dto.beneficiaryId ?? undefined,
  provider: dto.provider,
  accountNumber: dto.accountNumber,
  planCode: dto.planCode ?? undefined,
});

export const toCoupon = (dto: CouponDto): Coupon => ({
  id: dto.id,
  kind: dto.kind ?? 'coupon',
  myBalance: dto.myBalance
    ? {
        amount: dto.myBalance.allowance,
        used: dto.myBalance.used,
        left: dto.myBalance.left,
      }
    : null,
  status: dto.status,
  isOwner: dto.isOwner ?? false,
  code: dto.code,
  title: dto.title,
  amount: dto.amount ?? kobo(0),
  quantity: dto.quantity ?? 0,
  redeemed: dto.redeemed ?? 0,
  services: dto.services,
  expiresAt: dto.expiresAt,
});

export type Promotion = {
  id: string;
  code: string;
  title: string;
  summary: string;
  services: ServiceId[] | 'all';
  providers: string[];
  /** What the bill must reach before the promo applies. */
  minSpend: Kobo;
};

export const toPromotion = (dto: CouponDto): Promotion => ({
  id: dto.id,
  code: dto.code,
  title: dto.title,
  summary: dto.terms?.summary ?? '',
  services: dto.services,
  providers: dto.providers ?? [],
  minSpend: dto.terms?.minSpend ?? kobo(0),
});

/** Whether a promo can apply to this bill, as far as the app can tell; the quote has the final say. */
export const promoFits = (promo: Promotion, serviceId: ServiceId, provider: string, amount: Kobo) =>
  (promo.services === 'all' || promo.services.includes(serviceId)) &&
  (promo.providers.length === 0 || promo.providers.includes(provider.toUpperCase())) &&
  amount >= promo.minSpend;

export type GiftInboxItem = (
  | {
      type: 'balance';
      amount: Kobo;
      used: Kobo;
      left: Kobo;
      services: ServiceId[] | 'all';
      expiresAt: string;
    }
  | Omit<Extract<GiftInboxItemDto, { type: 'bill_paid' }>, 'id' | 'from' | 'message' | 'seen' | 'createdAt'>
) & { id: string; from: string; message: string | null; seen: boolean; createdAt: string };

export type GiftInbox = { unseen: number; balance: Kobo; items: GiftInboxItem[] };

export function toGiftInbox(dto: GiftInboxDto): GiftInbox {
  return {
    unseen: dto.unseen,
    balance: dto.balance,
    items: dto.items.map((item) =>
      item.type === 'balance' ? { ...item, used: subtractKobo(item.amount, item.left) } : item,
    ),
  };
}

export type PointsSummary = Omit<PointsSummaryDto, 'lifetimeEarned'>;

export type PointsEntry = Omit<PointsEntryDto, 'transaction'> & { transaction: ActivityItem | null };

export const toPointsEntry = (dto: PointsEntryDto): PointsEntry => ({
  ...dto,
  // Entries from before the API sent this field come back without it.
  transaction: dto.transaction ? toActivityItem(dto.transaction) : null,
});

export const toPointsSummary = ({ lifetimeEarned: _, ...dto }: PointsSummaryDto): PointsSummary => dto;

export type GiftHistoryItem = GiftHistoryItemDto;

export const toGiftHistoryItem = (dto: GiftHistoryItemDto): GiftHistoryItem => dto;

export type SpendingCategory = 'bills' | 'transfers' | 'gifts' | 'coupons' | 'tickets' | 'dues';
type SpendingLine<K extends string = string> = { key: K; amount: Kobo; count: number; share: number };

export type Spending = Omit<SpendingDto, 'byCategory' | 'byService' | 'byProvider' | 'trend'> & {
  byCategory: SpendingLine<SpendingCategory>[];
  byService: SpendingLine[];
  byProvider: SpendingLine[];
  trend: SpendingPoint[];
};

const toSpendingLine = <K extends string>(line: SpendingDto['byService'][number]) =>
  ({ ...line, key: line.key as K });

export const toSpending = (dto: SpendingDto): Spending => ({
  ...dto,
  byCategory: dto.byCategory.map((line) => toSpendingLine<SpendingCategory>(line)),
  byService: dto.byService.map((line) => toSpendingLine(line)),
  byProvider: dto.byProvider.map((line) => toSpendingLine(line)),
  trend: dto.trend.map(({ label, amount }) => ({ month: label, amount })),
});

export const toEvent = (dto: EventDto) => dto;
export type Event = ReturnType<typeof toEvent>;

export const toOwnerEvent = (dto: OwnerEventDto) => dto;
export type OwnerEvent = ReturnType<typeof toOwnerEvent>;

export const toTicket = (dto: TicketDto) => dto;
export type Ticket = ReturnType<typeof toTicket>;

export const toTicketFees = ({ serviceCharge, buyerPays, sellingFee, youReceive }: TicketFeesDto) => ({
  serviceCharge,
  buyerPays,
  sellingFee,
  youReceive,
});

export const toSeller = (dto: SellerDto) => dto;
export type Seller = ReturnType<typeof toSeller>;
