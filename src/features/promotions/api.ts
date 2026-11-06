import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";
import type { ServiceId } from "@/features/coupons/money";

export type PromoStatus = "active" | "paused" | "expired" | "cancelled";
export type PromoAudience = "all" | "first_bill" | "bvn_on_file";

export const AUDIENCE_LABELS: Record<PromoAudience, string> = {
  all: "Everyone",
  first_bill: "First bill only",
  bvn_on_file: "People with a BVN on file",
};

/** The promo's rules as stored. Kobo, except `value` for a percentage. */
export type PromoRules = {
  valueType: "percent" | "fixed";
  /** Percent 1–100, or kobo for fixed. */
  value: number;
  /** Most one use can take off; null = no cap. */
  maxDiscount: number | null;
  minSpend: number;
  appliesTo: "amount" | "fee";
  budget: number;
  spent: number;
  usesPerUser: number;
  audience: PromoAudience;
  autoApply: boolean;
  listed: boolean;
};

/** GET /admin/promotions(/:id). */
export type Promotion = {
  id: string;
  code: string;
  kind: "promo";
  fundedBy: "tela";
  title: string;
  description: string | null;
  services: ServiceId[] | "all";
  providers: string[];
  status: PromoStatus;
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  terms: Omit<PromoRules, "budget" | "spent" | "audience" | "listed" | "autoApply"> & { summary: string };
  autoApply: boolean;
  rules: PromoRules;
  stats: { uses: number; users: number; spent: number; budgetLeft: number };
  createdBy: string | null;
};

export type PromoInput = {
  title: string;
  description?: string;
  valueType: "percent" | "fixed";
  value: number;
  maxDiscount: number | null;
  minSpend: number;
  appliesTo: "amount" | "fee";
  budget: number;
  usesPerUser: number;
  audience: PromoAudience;
  autoApply: boolean;
  listed: boolean;
  services: ServiceId[] | "all";
  providers: string[];
  startsAt?: string;
  expiresAt: string;
};

/** Saves come back with nudges for setups that are allowed but easy to farm. */
export type PromoSaved = { promo: Promotion; warnings: string[] };

const KEY = ["promotions"] as const;

export const usePromotions = (params: { status: string; page: number; limit: number }) =>
  useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: () => api.get<Paginated<Promotion>>("/admin/promotions", params),
    placeholderData: keepPreviousData,
  });

function useRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: KEY });
    void client.invalidateQueries({ queryKey: ["reports", "giveaways"] });
  };
}

export function useCreatePromotion() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: PromoInput & { code: string }) => api.post<PromoSaved>("/admin/promotions", body),
    onSuccess: refresh,
  });
}

export function useUpdatePromotion() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PromoInput> & { id: string; status?: "active" | "paused" }) => api.patch<PromoSaved>(`/admin/promotions/${id}`, body),
    onSuccess: refresh,
  });
}

export function useEndPromotion() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api.post<Promotion>(`/admin/promotions/${id}/end`),
    onSuccess: refresh,
  });
}
