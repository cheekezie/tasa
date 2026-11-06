import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";
import type { ServiceId } from "@/features/coupons/money";

export type CouponStatus = "active" | "paused" | "expired" | "cancelled";

/** Tela coupons cost Tela as they're used; user coupons hold the owner's money in a pool. */
type TelaStats = { cost: number; maxExposure: number; exposureLeft: number };
type UserStats = { poolLeft: number };

/** GET /admin/coupons(/:id). Kobo throughout. */
export type AdminCoupon = {
  id: string;
  code: string;
  kind: "coupon" | "gift";
  fundedBy: "user" | "tela";
  title: string;
  description: string | null;
  services: ServiceId[] | "all";
  providers: string[];
  status: CouponStatus;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  /** Per person. */
  amount: number;
  quantity: number;
  /** People who have claimed it. */
  redeemed: number;
  remaining: number;
  message: string | null;
  isOwner: boolean;
  myBalance: null;
  /** The user who paid for it; null for Tela's. */
  owner: string | null;
  ownerName: string | null;
  /** The admin who made a Tela giveaway. */
  createdBy: string | null;
  createdByName: string | null;
  /** Closed to new claims (claimants keep their balance), or cancelled outright. */
  closed: boolean;
  closedAt: string | null;
  /** `name` is what the sender typed; `userName` is the Tela account it reached, once they've joined. */
  recipient: { label: string; name: string | null; user: string | null; userName: string | null } | null;
  stats: { claims: number; uses: number; used: number } & Partial<TelaStats> & Partial<UserStats>;
};

/** One person's claim. Kobo; `allowance`/`left` are null for promos (uses only, no balance). */
export type CouponClaim = {
  id: string;
  user: string;
  userName: string | null;
  username: string | null;
  allowance: number | null;
  used: number;
  left: number | null;
  uses: number;
  claimedAt: string;
};

/** GET /admin/coupons/:id: the coupon plus its latest 500 claims. */
export type AdminCouponDetail = AdminCoupon & { claims: CouponClaim[] };

export type CouponFilters = { kind: string; fundedBy: string; status: string };

type Recipient = { type: "username" | "phone" | "email"; value: string };

/** POST /admin/coupons, Tela-funded. */
export type TelaCouponInput =
  | { kind: "coupon"; title: string; description?: string; amount: number; quantity: number; services?: ServiceId[] | "all"; code?: string; expiresAt: string }
  | { kind: "gift"; title: string; description?: string; amount: number; recipient: Recipient; recipientName?: string; message?: string; expiresAt: string };

export const useCoupons = (params: CouponFilters & { code: string; page: number; limit: number }) =>
  useQuery({
    queryKey: ["coupons", "list", params],
    queryFn: () => api.get<Paginated<AdminCoupon>>("/admin/coupons", params),
    placeholderData: keepPreviousData,
  });

export const useCoupon = (id: string) =>
  useQuery({ queryKey: ["coupons", "detail", id], queryFn: () => api.get<AdminCouponDetail>(`/admin/coupons/${id}`) });

export function useCreateTelaCoupon() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TelaCouponInput) => api.post<AdminCoupon>("/admin/coupons", body),
    onSuccess: (coupon) => {
      client.setQueryData(["coupons", "detail", coupon.id], { ...coupon, claims: [] });
      void client.invalidateQueries({ queryKey: ["coupons", "list"] });
      void client.invalidateQueries({ queryKey: ["reports", "giveaways"] });
    },
  });
}

/** Pause, resume or close: each returns the coupon as it now stands, without its claims, so those are kept. */
export function useCouponAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "close" }) => api.post<AdminCoupon>(`/admin/coupons/${id}/${action}`),
    onSuccess: (coupon) => {
      client.setQueryData<AdminCouponDetail>(["coupons", "detail", coupon.id], (old) => ({ ...coupon, claims: old?.claims ?? [] }));
      void client.invalidateQueries({ queryKey: ["coupons", "list"] });
      void client.invalidateQueries({ queryKey: ["reports", "giveaways"] });
    },
  });
}
