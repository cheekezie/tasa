// Request and response shapes of the Tasa API. Every money field here is integer kobo, typed `Kobo`,
// both ways: lib/api/mappers.ts reshapes responses but never converts them.
import { RecurringFrequency } from '@/constants/data';
import { ServiceId } from '@/constants/theme';
import { Kobo } from '@/lib/money';

export type { ContactInput, Paginated } from '@tasa/contracts/common';
export type RecipientInput = { type: 'username' | 'phone' | 'email'; value: string };

export type OtpSentDto = { channel: string; expiresInSeconds: number; resendInSeconds: number };

export type ProfileDto = {
  id: string;
  phone: string | null;
  username: string | null;
  email: string | null;
  fullName: string | null;
  avatarUrl?: string | null;
  bvn: {
    status: 'pending' | 'verified' | 'rejected';
    last4: string | null;
    rejectionReason: string | null;
  } | null;
  hasPin: boolean;
  billPinEnabled?: boolean;
  payday: number | null;
  notificationPrefs: { shortfallReminders?: boolean; push?: boolean };
  walletBalance?: Kobo;
  gifts?: { unseen: number; balance: Kobo };
  createdAt: string;
};

export type SessionDto = {
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
  user: ProfileDto;
};

export type UpdateProfileInput = {
  username?: string;
  fullName?: string;
  payday?: number | null;
  notificationPrefs?: {
    shortfallReminders?: boolean;
    push?: boolean;
    paymentReceipts?: boolean;
    walletFunding?: boolean;
    offers?: boolean;
  };
};

export type LookupDto = { found: true; isSelf: boolean; user: { username: string | null; name: string } } | { found: false; canInvite: boolean };

export type BankAccountDto = { bankName: string; accountNumber: string; accountName: string };

export type WalletDto = { balance: Kobo; account: BankAccountDto | null };

export type ChargeDto = { code: string; label: string; amount: Kobo };

export type CustomerDto = {
  name: string;
  address?: string;
  detail?: { label: string; value: string };
};

export type QuoteDto = {
  id: string;
  kind: 'funding' | 'bill' | 'transfer' | 'coupon' | 'gift' | 'ticket' | 'ticket_payout';
  amount: Kobo;
  charges: ChargeDto[];
  fee: Kobo;
  discount: Kobo;
  total: Kobo;
  expiresAt: string;
  /** What this will earn if it succeeds. 0 when it earns nothing. */
  pointsToEarn: number;
  bill?: {
    serviceId: ServiceId;
    provider: string;
    account: string;
    planName: string | null;
    customer: CustomerDto | null;
  };
  coupon?: { code: string; kind: 'coupon' | 'gift' | 'promo'; title: string; auto: boolean };
  transfer?: { username: string | null; name: string };
  ticket?: { eventTitle: string; tierName: string; quantity: number; unitPrice: Kobo };
  /** The bank account a ticket payout goes to, fixed when it was priced. */
  ticketPayout?: VerifiedBankAccountDto;
  gift?: { recipient: string; recipientName: string | null; onTasa: boolean };
};

/** What the app sends to POST /quotes. */
export type BillQuoteInput = {
  kind: 'bill';
  serviceId: ServiceId;
  provider: string;
  account: string;
  amount?: Kobo;
  product?: 'airtime' | 'data';
  planCode?: string;
  meterType?: 'prepaid' | 'postpaid';
  couponCode?: string;
  autoApply?: boolean;
  beneficiaryId?: string;
};

export type QuoteInput =
  | { kind: 'funding'; amount: Kobo }
  | { kind: 'group_dues'; groupId: string; items: { dueId: string; periods: number[] }[] }
  | { kind: 'group_payout'; groupId: string; amount: Kobo }
  | { kind: 'split_share'; splitId: string }
  | { kind: 'ticket'; eventId: string; tierId: string; quantity: number }
  | BillQuoteInput
  | { kind: 'transfer'; recipient: RecipientInput; amount: Kobo; note?: string }
  | {
      kind: 'coupon';
      title: string;
      amount: Kobo;
      quantity: number;
      services: ServiceId[] | 'all';
    }
  | {
      kind: 'gift';
      recipient: RecipientInput;
      recipientName?: string;
      serviceId: ServiceId | null;
      amount: Kobo;
      message?: string;
    };

/** Everything the back office can switch off. Matches the API's FEATURES. */
export type SellerIdType = 'nin_slip' | 'drivers_licence' | 'passport' | 'voters_card';

export type FeatureKey =
  | 'funding'
  | 'bills'
  | 'bill_electricity'
  | 'bill_airtime'
  | 'bill_tv'
  | 'bill_internet'
  | 'bill_jamb'
  | 'transfers'
  | 'gifts'
  | 'coupons'
  | 'recurring'
  | 'points'
  | 'tickets'
  | 'ticket_selling'
  | 'ticket_payouts';

/** Read at startup, before sign-in: whether to show the app at all, and what's switched off. */
export type AppConfigDto = {
  maintenance: { active: boolean; message: string | null; until: string | null };
  features: Record<FeatureKey, { enabled: boolean; message: string | null }>;
};

export type BillServiceDto = {
  id: ServiceId;
  available: boolean;
  /** Why it's unavailable when staff have paused it. */
  pausedMessage?: string | null;
  providers: { code: string; name: string; minAmount?: Kobo; sellsPins?: boolean; logo?: string }[];
};

export type PlanDto = { code: string; name: string; amount: Kobo };

export type TransactionStatus = 'pending' | 'success' | 'failed' | 'expired' | 'reversed';

export type TransactionDto = {
  id: string;
  reference: string;
  kind: string;
  type: 'payment' | 'fund' | 'transfer' | 'gift' | 'coupon';
  direction: 'credit' | 'debit';
  status: TransactionStatus;
  title: string;
  subtitle: string;
  amount: Kobo;
  fee: Kobo;
  discount: Kobo;
  total: Kobo;
  serviceId: ServiceId | null;
  beneficiaryId: string | null;
  bill: {
    provider: string;
    account: string;
    product: 'airtime' | 'data' | null;
    meterType: 'prepaid' | 'postpaid' | null;
    planCode: string | null;
    customerName: string | null;
    token: string | null;
    units: string | null;
    pins: { pin: string; serial: string | null }[] | null;
  } | null;
  funding: {
    accountNumber: string;
    bankName: string;
    accountName: string;
    expiresAt: string;
  } | null;
  counterparty: { username: string | null; name: string | null } | null;
  coupon: { code: string; kind: string } | null;
  giftTo: { recipient: string; name: string | null; message: string | null } | null;
  date: string;
};

type SpendingLineDto = { key: string; amount: Kobo; count: number; share: number };

export type EventTierDto = {
  id: string;
  name: string;
  covers: string | null;
  price: Kobo;
  remaining: number | null;
};

export type OrganiserDto = {
  id: string;
  name: string;
  logoUrl: string | null;
  /** Checked by Tasa's compliance team. */ verified: boolean;
  events: number;
  rating: number | null;
  ratings: number;
};

export type GalleryItemDto = { id: string; kind: 'image' | 'video'; url: string };

export type OrganiserContactDto = { phone: string | null; email: string | null; website: string | null; instagram: string | null };

/** An organiser's public page. */
export type OrganiserPageDto = OrganiserDto & {
  /** The caller's own page: same content as buyers see, shown as theirs. */
  mine: boolean;
  about: string | null;
  contact: OrganiserContactDto;
  since: string;
  upcoming: EventDto[];
};

/** What an organiser can say about themselves. A blank clears a field. */
export type OrganiserProfileInput = {
  organisation?: string;
  about?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
};

export type EventSalesDto = {
  purchases: { id: string; buyer: string; tierName: string; quantity: number; amount: Kobo; checkedIn: number; refunded: number; at: string }[];
  byTier: { id: string; name: string; sold: number; limit: number | null; gross: Kobo }[];
};

export type EventDto = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  venue: string;
  imageUrl: string | null;
  /** Photos and videos, usually from past events. */
  gallery: GalleryItemDto[];
  /** The organisation behind it, how many events they've run, and what goers rated them. */
  organiser: OrganiserDto;
  phone: string | null;
  email: string | null;
  startsAt: string;
  endsAt: string | null;
  refundDays: number;
  sales: 'on_sale' | 'paused' | 'ended';
  tiers: EventTierDto[];
};

export type OwnerEventDto = Omit<EventDto, 'tiers'> & {
  salesPaused: boolean;
  adminPaused: boolean;
  tiers: (EventTierDto & { limit: number | null; sold: number })[];
  sold: number;
  gross: Kobo;
  checkedIn: number;
  staff: { id: string; name: string; username: string | null }[];
};

export type CreateEventInput = {
  title: string;
  phone: string;
  email?: string;
  description?: string;
  venue: string;
  startsAt: string;
  endsAt?: string;
  refundDays: number;
  tiers: { name: string; covers?: string; price: Kobo; limit: number | null }[];
};

export type TicketDto = {
  id: string;
  code: string;
  purchaseId: string;
  status: 'valid' | 'used' | 'refunded';
  eventId: string;
  eventTitle: string;
  tierName: string;
  holderName: string;
  covers: string | null;
  price: Kobo;
  refundableUntil: string | null;
  canRefund: boolean;
  scannedAt: string | null;
  /** Only once it's been scanned at the door. */
  canRate: boolean;
  rating: number | null;
  venue?: string;
  startsAt?: string;
  organiser?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type TicketFeesDto = {
  price: Kobo;
  serviceCharge: Kobo;
  buyerPays: Kobo;
  sellingFee: Kobo;
  youReceive: Kobo;
};

export type BankAccountInput = { bankCode: string; accountNumber: string };

/** Who buyers see, where the money goes, and the terms they agreed to, sent with the PIN. */
export type OptInInput = Partial<BankAccountInput> & OrganiserProfileInput & { organisation: string; acceptTerms: string };

export type VerifiedBankAccountDto = BankAccountInput & { bankName: string; accountName: string };

export type SellerDto = {
  optedIn: boolean;
  /** For their public page: /organisers/:organiserId. */
  organiserId: string;
  /** What buyers see instead of the seller's name. null for sellers from before it was asked. */
  organisation: string | null;
  logoUrl: string | null;
  about: string | null;
  contact: OrganiserContactDto;
  /** False for sellers who agreed to older terms: they accept `termsVersion` before their next event. */
  termsAccepted: boolean;
  termsVersion: string;
  /** Their photo and ID as compliance judged them. Creating events needs `approved`. */
  verification: {
    status: 'unsubmitted' | 'pending' | 'approved' | 'rejected';
    idType: SellerIdType | null;
    submittedAt: string | null;
    reason: string | null;
  };
  /** Tasa stopped them organising: events paused, withdrawals on hold. */
  suspension: { active: boolean; reason: string | null };
  hasId: boolean;
  idOnFile: 'bvn' | 'nin' | null;
  bankAccount?: VerifiedBankAccountDto | null;
  wallet?: {
    balance: Kobo;
    held: Kobo;
    available: Kobo;
    holds: { until: string; amount: Kobo; tickets: number }[];
  };
};

export type SpendingDto = {
  from: string | null;
  to: string;
  spent: Kobo;
  previousSpent: Kobo | null;
  changePercent: number | null;
  transactions: number;
  byCategory: SpendingLineDto[];
  byService: SpendingLineDto[];
  byProvider: SpendingLineDto[];
  saved: Kobo;
  biggest: {
    amount: Kobo;
    kind: 'bill' | 'transfer_out' | 'gift' | 'coupon_funding' | 'ticket_purchase';
    serviceId: ServiceId | null;
    provider: string | null;
    reference: string;
    date: string;
  } | null;
  received: { gifts: Kobo; coupons: Kobo };
  points: { earned: number; value: Kobo };
  trend: { month: string; label: string; amount: Kobo }[];
  recurringMonthly: Kobo;
};

export type InsightsDto = {
  series: { month: string; label: string; amount: Kobo }[];
  total: Kobo;
  average: Kobo;
};

export type BeneficiaryDto = {
  id: string;
  label: string;
  serviceId: ServiceId;
  provider: string;
  accountNumber: string;
  /** Who the provider says owns it, checked when it was saved: the meter or smart card owner. */
  customerName: string | null;
  meterType: 'prepaid' | 'postpaid' | null;
  autoPay: boolean;
  virtualAccount: BankAccountDto | null;
};

/** The provider checks the account before it's saved; electricity needs the meter type for that. */
export type BeneficiaryInput = {
  label: string;
  serviceId: ServiceId;
  provider: string;
  account: string;
  meterType?: 'prepaid' | 'postpaid';
};

export type AutoPayTermsDto = { version: string; url: string };

export type RecurringDto = {
  id: string;
  label: string;
  serviceId: ServiceId;
  provider: string;
  accountNumber: string;
  planCode: string | null;
  amount: Kobo;
  frequency: RecurringFrequency;
  nextDate: string;
  beneficiaryId: string | null;
  active: boolean;
};

export type RecurringInput = {
  label: string;
  serviceId: ServiceId;
  provider: string;
  account: string;
  amount: Kobo;
  frequency: RecurringFrequency;
  startDate: string;
  beneficiaryId?: string;
  planCode?: string;
  product?: 'airtime' | 'data';
  meterType?: 'prepaid' | 'postpaid';
};

/** No PIN: setting up or changing a schedule pays nothing; each run is checked when it pays. */
export type RecurringChanges = {
  label?: string;
  amount?: Kobo;
  planCode?: string;
  frequency?: RecurringFrequency;
  nextDate?: string;
};

export type CouponDto = {
  id: string;
  code: string;
  title: string;
  services: ServiceId[] | 'all';
  /** Provider codes it's limited to; empty means any provider. */
  providers?: string[];
  status: string;
  expiresAt: string;
  amount?: Kobo;
  quantity?: number;
  redeemed?: number;
  isOwner?: boolean;
  kind?: 'coupon' | 'gift' | 'promo';
  myBalance?: { allowance: Kobo; used: Kobo; left: Kobo } | null;
  /** Promos only. */
  terms?: { summary: string; minSpend?: Kobo };
};

export type CouponCreatedDto = { transaction: TransactionDto; coupon: CouponDto | null };

export type GiftInboxItemDto =
  | {
      type: 'balance';
      id: string;
      from: string;
      message: string | null;
      /** The whole gift. */
      amount: Kobo;
      left: Kobo;
      services: ServiceId[] | 'all';
      expiresAt: string;
      seen: boolean;
      createdAt: string;
    }
  | {
      type: 'bill_paid';
      id: string;
      from: string;
      message: string | null;
      serviceId: ServiceId;
      provider: string;
      account: string;
      amount: Kobo;
      token: string | null;
      pins: { pin: string; serial: string | null }[] | null;
      seen: boolean;
      createdAt: string;
    };

type GiftHistoryBase = { id: string; person: string; message: string | null; amount: Kobo; date: string };

export type GiftHistoryItemDto =
  | (GiftHistoryBase & {
      type: 'balance';
      used: Kobo;
      left: Kobo;
      state: 'active' | 'used_up' | 'expired' | 'cancelled';
      services: ServiceId[] | 'all';
      expiresAt: string;
      spentOn: { amount: Kobo; reference: string; serviceId: ServiceId | null; provider: string | null; date: string }[];
    })
  | (GiftHistoryBase & {
      type: 'bill';
      state: 'delivered' | 'pending' | 'failed';
      serviceId: ServiceId;
      provider: string;
      account: string;
    });

export type GiftInboxDto = { unseen: number; balance: Kobo; items: GiftInboxItemDto[] };

export type PointsSummaryDto = {
  active: boolean;
  balance: number;
  lifetimeEarned: number;
  value: Kobo;
  /** What one point is worth. */
  pointValue: Kobo;
  minRedeemPoints: number;
};

export type PointsEntryDto = {
  id: string;
  type: 'earn' | 'redeem' | 'forfeit';
  points: number;
  date: string;
  /** What earned or spent the points. Null for adjustments with no payment behind them. */
  transaction: TransactionDto | null;
};

export type NotificationDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

// ── Groups ────────────────────────────────────────────────────────────────
export type GroupPeriod = 'weekly' | 'monthly' | 'yearly';
export type MaskedAccountDto = { bankName: string; accountName: string; last4: string };

/**
 * - `paid`: covered. `due`: compulsory, unpaid and current. `overdue`: compulsory, unpaid and past.
 * - `optional`: an optional due, unpaid (never owed). `upcoming`: hasn't started; can be paid ahead.
 */
export type DuePeriodStatus = 'paid' | 'due' | 'overdue' | 'optional' | 'upcoming';

/** Something a group collects: recurring on each member's own periods, or a one-off. */
export type GroupDueDto = {
  id: string;
  name: string;
  kind: 'recurring' | 'one_off';
  period: GroupPeriod | null;
  /** Per period. */
  amount: Kobo;
  compulsory: boolean;
  /** One-offs: overdue after this. */
  dueAt: string | null;
  endedAt: string | null;
  createdAt: string;
  /** In the terms: Tasa's charge per payment. */
  charge?: Kobo;
  /** Executives only. */
  stats?: { current: { start: string; members: number; paid: number }; outstanding: Kobo; collected: Kobo };
};

export type DuePeriodDto = { index: number; start: string; end: string | null; status: DuePeriodStatus };
export type MemberDueDto = GroupDueDto & { periods: DuePeriodDto[]; owed: Kobo; paidCount: number };

export type GroupUpcomingDto = {
  dueId: string;
  name: string;
  kind: GroupDueDto['kind'];
  period: GroupPeriod | null;
  status: 'overdue' | 'due' | 'upcoming';
  periods: number;
  amount: Kobo;
  /** When it fell (or falls) due. */
  date: string;
};

export type DueInput = { name: string; kind: GroupDueDto['kind']; period?: GroupPeriod; amount: Kobo; compulsory: boolean; dueAt?: string };

/** What a joiner accepts: who runs it, what it collects, and where the money is paid out to. */
export type GroupTermsDto = { version: number; runBy: string; payout: MaskedAccountDto; dues: GroupDueDto[]; points: string[] };

export type GroupMembershipDto = {
  id: string;
  status: 'pending' | 'active' | 'removed';
  fields: Record<string, string>;
  startsAt: string;
  joinedAt: string;
  /** Owed now: current and overdue, compulsory dues only. */
  amountOwed: Kobo;
  overdue: Kobo;
  periodsOwed: number;
  mustAcceptTerms: boolean;
  /** Their own statement (on the group, and for executives viewing one member). */
  dues?: MemberDueDto[];
  /** In the groups list, for Home: owed now per compulsory due, then the next period ahead. */
  upcoming?: GroupUpcomingDto[];
};

export type GroupMemberDto = GroupMembershipDto & {
  user: { id: string; name: string | null; username: string | null };
};
export type GroupMemberDetailDto = GroupMemberDto & { backfills: { dueId: string | null; periods: number; note: string | null; at: string }[] };

/** Who paid what of one due: members down the side, calendar columns across (newest last). */
export type GroupDueReportDto = {
  due: GroupDueDto;
  totals: { collected: Kobo; outstanding: Kobo; members: number; owing: number };
  columns: { start: string; end: string | null; members: number; paid: number; collected: Kobo }[];
  /** Years to filter by, oldest first; empty for one-offs. */
  years: number[];
  /** The year shown, or null when every year is (yearly dues) or there are none (one-offs). */
  year: number | null;
  items: {
    id: string;
    user: { id: string; name: string | null; username: string | null };
    cells: (DuePeriodStatus | null)[];
    owed: Kobo;
    paid: number;
  }[];
  total: number;
};

export type GroupPayoutChangeDto = {
  id: string;
  status: 'awaiting_approval' | 'cooling_off' | 'applied' | 'rejected' | 'expired';
  from: MaskedAccountDto;
  to: MaskedAccountDto;
  proposedBy: string;
  cosigners: { id: string; name: string; approvedAt: string | null }[];
  /** You're a co-signer who hasn't approved yet. */
  awaitingYou: boolean;
  expiresAt: string;
  effectiveAt: string | null;
};

export type GroupFieldDto = { key: string; label: string; required: boolean };

export type GroupDto = {
  id: string;
  name: string;
  logoUrl: string | null;
  about: string | null;
  requireApproval: boolean;
  fields: GroupFieldDto[];
  dues: GroupDueDto[];
  terms: GroupTermsDto;
  executives: { id: string; name: string | null; username: string | null; role: 'owner' | 'executive' }[];
  role: 'owner' | 'executive' | null;
  membership: GroupMembershipDto | null;
  members: { active: number; pending: number };
  suspended: { at: string; reason: string | null } | null;
  payoutChange: GroupPayoutChangeDto | null;
  /** Executives only. */
  inviteCode?: string;
  payout?: { bankCode: string; bankName: string; accountNumber: string; accountName: string };
  balance?: Kobo;
};

export type GroupSummaryDto = {
  id: string;
  name: string;
  logoUrl: string | null;
  role: GroupDto['role'];
  suspended: boolean;
  membership: GroupMembershipDto | null;
};
export type GroupPreviewDto = {
  id: string;
  name: string;
  logoUrl: string | null;
  about: string | null;
  requireApproval: boolean;
  fields: GroupFieldDto[];
  terms: GroupTermsDto;
};

/** One dues payment, with the website page its QR code opens. */
export type GroupReceiptDto = {
  id: string;
  reference: string;
  /** What went to the group's dues (charges not included). */
  amount: Kobo;
  paidAt: string;
  /** A one-off's period has no dates. */
  dues: {
    name: string;
    kind: GroupDueDto['kind'] | null;
    period: GroupPeriod | null;
    periods: { index: number; start: string | null; end: string | null }[];
  }[];
  code: string;
  url: string;
};
export type GroupWithdrawalDto = {
  id: string;
  status: 'pending' | 'success' | 'failed';
  amount: Kobo;
  to: MaskedAccountDto | null;
  by: string | null;
  at: string;
};

export type CreateGroupInput = {
  name: string;
  about?: string;
  requireApproval: boolean;
  fields: { label: string; required: boolean }[];
  dues: DueInput[];
  bankCode: string;
  accountNumber: string;
};

// ── Split bills ───────────────────────────────────────────────────────────
export type SplitStatus = 'open' | 'paying' | 'paid' | 'failed' | 'expired' | 'cancelled';
export type SplitPersonDto = { id: string; name: string; username: string | null };

export type SplitDto = {
  id: string;
  title: string;
  status: SplitStatus;
  starter: SplitPersonDto;
  isStarter: boolean;
  bill: { serviceId: ServiceId; provider: string; account: string; planName: string | null; customerName: string | null };
  amount: Kobo;
  fee: Kobo;
  total: Kobo;
  collected: Kobo;
  shares: (SplitPersonDto & { amount: Kobo; paid: boolean; refunded: boolean })[];
  myShare: { amount: Kobo; paid: boolean; refunded: boolean } | null;
  deadline: string;
  /** On a single split: the other rounds of the same bill (split again), newest first. */
  history?: SplitRoundDto[];
  /** Once the pot has paid: the bill's receipt, token included, for everyone in the split. */
  result?: SplitResultDto | null;
  closedReason: string | null;
  createdAt: string;
};

export type SplitResultDto = {
  status: TransactionStatus;
  reference: string;
  paidAt: string;
  customerName: string | null;
  token: string | null;
  units: string | null;
  pins: { pin: string; serial: string | null }[];
};

export type SplitRoundDto = {
  id: string;
  status: SplitStatus;
  total: Kobo;
  myShare: { amount: Kobo; paid: boolean; refunded: boolean } | null;
  createdAt: string;
  closedAt: string | null;
  result: SplitResultDto | null;
};

export type CreateSplitInput = {
  title: string;
  bill: {
    serviceId: ServiceId;
    provider: string;
    account: string;
    amount?: Kobo;
    planCode?: string;
    product?: 'airtime' | 'data';
    meterType?: 'prepaid' | 'postpaid';
  };
  shares: { username: string; amount?: Kobo }[];
  hours: number;
};

// ── Students ──────────────────────────────────────────────────────────────
export type Programme =
  | 'undergraduate'
  | 'part_time'
  | 'masters'
  | 'doctorate'
  | 'pgd'
  | 'nd'
  | 'hnd'
  | 'nce'
  | 'diploma'
  | 'jupeb'
  | 'ijmb'
  | 'pre_degree'
  | 'pre_science'
  | 'foundation';

export type SchoolDto = {
  id: string;
  name: string;
  shortName: string;
  kind: string;
  ownership: 'federal' | 'state' | 'private' | null;
  state: string;
  logoUrl: string | null;
  /** A code to an address on one of these verifies them; none means ID card only. */
  emailDomains: string[];
};

/** "Are you a student?": what they agree to before the student profile opens. `version` goes back when they accept. */
export type StudentTermsDto = { version: number; points: string[]; accepted: boolean };

/** A school's faculties and their departments; `general` while the school has no list of its own on Tasa. */
export type SchoolFacultiesDto = { general: boolean; faculties: { name: string; departments: string[] }[] };

export type StudentVerificationStatus = 'unsubmitted' | 'pending' | 'verified' | 'rejected';

export type StudentProfileDto = {
  school: SchoolDto | null;
  faculty: string | null;
  department: string;
  programme: Programme;
  /** 1–5, up to the programme's years. */
  level: number;
  /** "300 level", "ND1", "Year 2 · Master’s". */
  levelLabel: string;
  matricNumber: string;
  admissionYear: number;
  verification: {
    status: StudentVerificationStatus;
    method: 'email' | 'id_card' | null;
    email: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    reason: string | null;
    /** Staff took a verification back: only the ID card works now. */
    revoked: boolean;
  };
};

export type StudentProfileInput = {
  schoolId: string;
  faculty?: string;
  department: string;
  programme: Programme;
  level: number;
  matricNumber: string;
  admissionYear: number;
};
