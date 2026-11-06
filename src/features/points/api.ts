import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";

/** The single PointsSettings document, as stored. */
export type PointsSettings = {
  _id: string;
  active: boolean;
  /** Points per ₦100 the user actually paid on a bill, after discounts. May be fractional. */
  billPointsPer100Naira: number;
  /** Points per successful transfer. */
  transferPoints: number;
  /** Kobo one point is worth when converted. */
  pointValue: number;
  minRedeemPoints: number;
  createdAt?: string;
  updatedAt?: string;
};

/** GET/PATCH /admin/points. `outstanding.value` is kobo: the cost still to come if every point converted today. */
export type PointsSummary = { settings: PointsSettings; outstanding: { points: number; value: number } };

export type PointsSettingsUpdate = Partial<Pick<PointsSettings, "active" | "billPointsPer100Naira" | "transferPoints" | "pointValue" | "minRedeemPoints">>;

const KEY = ["points"] as const;

export const usePoints = () => useQuery({ queryKey: KEY, queryFn: () => api.get<PointsSummary>("/admin/points") });

export function useUpdatePoints() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PointsSettingsUpdate) => api.patch<PointsSummary>("/admin/points", body),
    onSuccess: (data) => client.setQueryData(KEY, data),
  });
}

/** GET /admin/points/balances: one row per user with points. `value` is kobo, at today's point value. */
export type PointsBalanceRow = {
  userId: string;
  name: string | null;
  username: string | null;
  balance: number;
  lifetimeEarned: number;
  value: number;
  lastActivityAt: string | null;
};

export type PointsBalancesParams = { search?: string; sort: "balance" | "earned"; page: number; limit: number };

export const usePointsBalances = (params: PointsBalancesParams) =>
  useQuery({
    queryKey: [...KEY, "balances", params],
    queryFn: () => api.get<Paginated<PointsBalanceRow>>("/admin/points/balances", params),
    placeholderData: keepPreviousData,
  });

/** GET /admin/users/:id/points: their summary, and their history newest first. */
export type UserPoints = {
  active: boolean;
  balance: number;
  lifetimeEarned: number;
  /** Kobo the balance converts to. */
  value: number;
  pointValue: number;
  minRedeemPoints: number;
  history: Paginated<{
    id: string;
    type: "earn" | "redeem" | "forfeit";
    points: number;
    date: string;
    transaction: { id: string; reference: string; title: string; kind: string } | null;
  }>;
};

export const useUserPoints = (userId: string, limit = 5) =>
  useQuery({ queryKey: [...KEY, "user", userId, limit], queryFn: () => api.get<UserPoints>(`/admin/users/${userId}/points`, { page: 1, limit }) });
