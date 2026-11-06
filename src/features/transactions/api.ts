import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";

/** Same order as the API's TRANSACTION_KINDS. */
export const TRANSACTION_KINDS = [
  "funding",
  "bill",
  "transfer_out",
  "transfer_in",
  "coupon_funding",
  "gift",
  "coupon_refund",
  "beneficiary_collection",
  "balance_forfeited",
  "points_redemption",
  "ticket_purchase",
  "ticket_refund",
  "ticket_withdrawal",
  "ticket_payout",
  "group_dues",
  "group_payout",
  "split_share",
  "split_refund",
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** pending → success | failed | expired. `reversed` = succeeded, then undone. */
export const TRANSACTION_STATUSES = ["pending", "success", "failed", "expired", "reversed"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type ChargeLine = { code: string; label: string; amount: number };

/** `toTransactionDto` in the API. Kobo throughout; dates are ISO strings. */
export type Transaction = {
  id: string;
  reference: string;
  kind: TransactionKind;
  type: "fund" | "payment" | "transfer" | "gift" | "coupon";
  direction: "credit" | "debit";
  status: TransactionStatus;
  title: string;
  subtitle: string;
  amount: number;
  fee: number;
  discount: number;
  total: number;
  charges: ChargeLine[];
  serviceId: string | null;
  beneficiaryId: string | null;
  bill: {
    provider: string;
    account: string;
    product: "airtime" | "data" | null;
    meterType: "prepaid" | "postpaid" | null;
    planCode: string | null;
    planName: string | null;
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
    amountReceived: number | null;
  } | null;
  counterparty: { username: string | null; name: string | null } | null;
  coupon: { code: string; kind: "coupon" | "gift" | "promo" } | null;
  giftTo: { recipient: string; name: string | null; message: string | null } | null;
  date: string;
  completedAt: string | null;
};

/** A row of GET /admin/transactions. `userName` is the best name the API has for them (null if the user is gone). */
export type AdminTransaction = Transaction & {
  user: string;
  userName?: string | null;
  needsReview: boolean;
  /** `web`: paid on the website without the app (a guest order). */
  channel: "app" | "web";
};

/** A website order a transaction belongs to: its transfer (funding) and the bill it bought. */
export type GuestOrderInfo = {
  reference: string;
  status: "awaiting_payment" | "paying" | "delivered" | "failed";
  phone: string;
  email: string | null;
  bill: { serviceId: string; provider: string; account: string; planName?: string; customerName?: string };
  amount: number;
  fee: number;
  total: number;
  failureReason: string | null;
  payAttempts: number;
  fundingTransactionId: string;
  billTransactionId: string | null;
  createdAt: string;
};

/** VTpass/SaySwitch bookkeeping on the transaction. Every field may be missing. */
export type ProviderData = {
  requestId?: string;
  transactionId?: string;
  sentAt?: string;
  lastCheckedAt?: string;
  code?: string;
  message?: string;
  cost?: number;
  reference?: string;
};

export type TransactionEvent = { type: string; at: string; note?: string };

/** One ledger line. Signed kobo: assets +, what Tela owes −. */
export type LedgerLine = { posting: string; account: string; amount: number; memo: string; at: string };

/** GET /admin/transactions/:id. */
export type TransactionDetail = AdminTransaction & {
  guestOrder: GuestOrderInfo | null;
  vendAttempts: number;
  providerData: ProviderData | null;
  events: TransactionEvent[];
  ledger: LedgerLine[];
};

export type TransactionFilters = {
  status?: TransactionStatus | "";
  kind?: TransactionKind | "";
  needsReview?: "true" | "false" | "";
  channel?: "app" | "web" | "";
  user?: string;
  reference?: string;
  /** Lagos days (YYYY-MM-DD), both inclusive. */
  from?: string;
  to?: string;
  page: number;
  limit: number;
};

const KEY = ["transactions"] as const;

export const useTransactions = (filters: TransactionFilters) =>
  useQuery({
    queryKey: [...KEY, "list", filters],
    queryFn: () => api.get<Paginated<AdminTransaction>>("/admin/transactions", filters),
    placeholderData: (previous) => previous,
  });

export const useTransaction = (id: string) =>
  useQuery({ queryKey: [...KEY, "detail", id], queryFn: () => api.get<TransactionDetail>(`/admin/transactions/${id}`) });

/**
 * Both actions reply with the bare DTO (no events or ledger), so refetch the detail
 * and the lists rather than patching the cache.
 */
function useInvalidateTransaction() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: KEY });
}

/** Asks VTpass again, past the automatic schedule. Pending bills only. */
export function useRequery(id: string) {
  const invalidate = useInvalidateTransaction();
  return useMutation({
    mutationFn: () => api.post<Transaction>(`/admin/transactions/${id}/requery`),
    onSuccess: invalidate,
  });
}

/** `cost`: kobo VTpass kept for a delivered bill, so its commission is booked. Without it, none is. */
export type ResolveInput = { outcome: "delivered" | "failed"; token?: string; cost?: number; note: string };

/** Staff's final word on a stuck bill or ticket payout. Moves money either way. */
export function useResolve(id: string) {
  const invalidate = useInvalidateTransaction();
  return useMutation({
    mutationFn: (body: ResolveInput) => api.post<Transaction>(`/admin/transactions/${id}/resolve`, body),
    onSuccess: invalidate,
  });
}
