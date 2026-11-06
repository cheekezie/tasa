import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { ServiceId } from "@/features/coupons/money";

export const CHARGE_SCOPES = ["funding", "bill", "transfer", "coupon", "gift", "ticket", "ticket_sale", "ticket_payout", "group_dues", "group_fee", "group_payout", "split"] as const;
export type ChargeScope = (typeof CHARGE_SCOPES)[number];

export const SCOPE_LABELS: Record<ChargeScope, string> = {
  funding: "Wallet funding",
  bill: "Bills",
  transfer: "Transfers",
  coupon: "Creating giveaways",
  gift: "Sending gifts",
  ticket: "Buying tickets",
  ticket_sale: "Ticket sales (organiser)",
  ticket_payout: "Ticket payouts to bank",
  group_dues: "Paying group dues (member)",
  group_fee: "Group dues received (group)",
  group_payout: "Group withdrawals to bank",
  split: "Paying a split bill share",
};

/** GET /admin/charges: a plain array. fee = clamp(round(amount × rateBps / 10 000) + fixed, min, max), kobo. */
export type ChargeRule = {
  id: string;
  scope: ChargeScope;
  serviceId: ServiceId | null;
  provider: string | null;
  code: string;
  label: string;
  rateBps: number;
  fixed: number;
  min: number;
  max: number | null;
  active: boolean;
  updatedAt: string;
};

export type ChargeRuleInput = Omit<ChargeRule, "id" | "updatedAt">;
export type ChargeRuleUpdate = Partial<Pick<ChargeRule, "label" | "rateBps" | "fixed" | "min" | "max" | "active">>;

/** GET /admin/charges/preview. */
export type ChargePreview = { amount: number; charges: { code: string; label: string; amount: number }[]; fee: number; total: number };
export type PreviewParams = { scope: ChargeScope; serviceId?: string; provider?: string; amount: number };

const KEY = ["charges"] as const;

export const useChargeRules = () => useQuery({ queryKey: KEY, queryFn: () => api.get<ChargeRule[]>("/admin/charges") });

export const useChargePreview = (params: PreviewParams | null) =>
  useQuery({
    queryKey: [...KEY, "preview", params],
    queryFn: () => api.get<ChargePreview>("/admin/charges/preview", params!),
    enabled: params !== null,
  });

/** Any rule change can reprice any preview, so drop them all. */
function useRefresh() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: KEY });
}

export function useCreateChargeRule() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: ChargeRuleInput) => api.post<ChargeRule>("/admin/charges", body), onSuccess: refresh });
}

export function useUpdateChargeRule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...body }: ChargeRuleUpdate & { id: string }) => api.patch<ChargeRule>(`/admin/charges/${id}`, body),
    onSuccess: refresh,
  });
}

export function useDeleteChargeRule() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => api.delete<{ deleted: true }>(`/admin/charges/${id}`), onSuccess: refresh });
}
