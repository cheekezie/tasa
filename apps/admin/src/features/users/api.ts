import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";

export type UserStatus = "active" | "suspended" | "closed";
export type BvnStatus = "pending" | "verified" | "rejected";

/** `toProfile` in the API. Only the last 4 digits of a BVN or NIN ever arrive here. */
export type UserProfile = {
  id: string;
  phone: string | null;
  username: string | null;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  bvn: { status: BvnStatus; last4: string | null; rejectionReason: string | null } | null;
  nin: { last4: string } | null;
  hasPin: boolean;
  /** Off = this user lets bill payments skip the PIN. Every OTP sign-in turns it back on. */
  billPinEnabled: boolean;
  payday: number | null;
  notificationPrefs: { shortfallReminders: boolean; push: boolean; paymentReceipts: boolean; walletFunding: boolean; offers: boolean };
  createdAt: string;
};

/** GET /admin/users rows. */
export type UserRow = UserProfile & { status: UserStatus };

/** GET /admin/users/:id. `wallet.cached` is Wallet.balance; `wallet.ledger` is what the postings add up to. Kobo. */
export type UserDetail = UserRow & { wallet: { cached: number; ledger: number; matches: boolean } };

/** A slice of the API's TransactionDto: what the user page shows as recent activity. */
export type UserActivity = {
  id: string;
  reference: string;
  kind: string;
  direction: "credit" | "debit";
  status: "pending" | "success" | "failed" | "expired" | "reversed";
  title: string;
  subtitle: string;
  amount: number;
  fee: number;
  total: number;
  date: string;
  needsReview: boolean;
};

export type UsersParams = { page: number; limit: number; search?: string; bvnStatus?: BvnStatus | ""; status?: UserStatus | "" };

const KEY = ["users"] as const;

export const useUsers = (params: UsersParams) =>
  useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: () => api.get<Paginated<UserRow>>("/admin/users", params),
    placeholderData: keepPreviousData,
  });

export const useUser = (id: string, options: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: [...KEY, "detail", id], queryFn: () => api.get<UserDetail>(`/admin/users/${id}`), enabled: options.enabled ?? true });

/** The user's latest transactions, from the transactions list filtered to them. */
export const useUserActivity = (id: string) =>
  useQuery({
    queryKey: ["transactions", "list", { user: id, page: 1, limit: 10 }],
    queryFn: () => api.get<Paginated<UserActivity>>("/admin/transactions", { user: id, page: 1, limit: 10 }),
  });

export function useSetUserStatus(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (status: "active" | "suspended") => api.post<{ id: string; status: "active" | "suspended" }>(`/admin/users/${id}/status`, { status }),
    onSuccess: ({ status }) => {
      client.setQueryData<UserDetail>([...KEY, "detail", id], (old) => (old ? { ...old, status } : old));
      void client.invalidateQueries({ queryKey: [...KEY, "list"] });
    },
  });
}

export type BvnDecision = { status: "verified"; fullName?: string } | { status: "rejected"; reason: string };

export function useDecideBvn(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (decision: BvnDecision) => api.post<UserRow>(`/admin/users/${id}/bvn`, decision),
    onSuccess: (user) => {
      client.setQueryData<UserDetail>([...KEY, "detail", id], (old) => (old ? { ...old, ...user } : old));
      void client.invalidateQueries({ queryKey: [...KEY, "list"] });
      void client.invalidateQueries({ queryKey: ["reports", "overview"] });
    },
  });
}

/** A mutation, never a query: the full BVN must not sit in the cache. Callers `reset()` it when done. */
export const useRevealBvn = (id: string) =>
  useMutation({ mutationFn: (reason: string) => api.post<{ bvn: string }>(`/admin/users/${id}/bvn/reveal`, { reason }) });
