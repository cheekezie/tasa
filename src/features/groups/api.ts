import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";

export type GroupPeriod = "weekly" | "monthly" | "yearly";
export type PayoutAccount = { bankCode: string; bankName: string; accountNumber: string; accountName: string };
export type Person = { name: string | null; username: string | null };

/** GET /admin/groups rows. Money in kobo. */
export type GroupRow = {
  id: string;
  name: string;
  owner: Person | null;
  members: number;
  balance: number;
  status: "active" | "closed";
  suspended: boolean;
  createdAt: string;
};

export type GroupPayoutChange = {
  id: string;
  status: "awaiting_approval" | "cooling_off" | "applied" | "rejected" | "expired";
  from: PayoutAccount;
  to: PayoutAccount;
  proposedBy: string | null;
  cosigners: { name: string | null; approvedAt: string | null }[];
  effectiveAt: string | null;
  closedBy: string | null;
  closedReason: string | null;
  createdAt: string;
};

/** GET /admin/groups/:id. Money in kobo. */
export type GroupDetail = {
  id: string;
  name: string;
  about: string | null;
  inviteCode: string;
  requireApproval: boolean;
  dues: {
    id: string;
    name: string;
    kind: "recurring" | "one_off";
    period: GroupPeriod | null;
    amount: number;
    compulsory: boolean;
    dueAt: string | null;
    endedAt: string | null;
  }[];
  fields: { key: string; label: string; required: boolean }[];
  payout: PayoutAccount;
  termsVersion: number;
  executives: (Person & { id: string; role: "owner" | "executive"; addedAt: string })[];
  members: { active: number; pending: number; removed: number };
  balance: number;
  collected: { amount: number; payments: number };
  withdrawals: { id: string; reference: string; status: "pending" | "success" | "failed"; amount: number; fee: number; to: PayoutAccount | null; by: string | null; at: string }[];
  payoutChanges: GroupPayoutChange[];
  status: "active" | "closed";
  suspension: {
    active: boolean;
    reason: string | null;
    at: string | null;
    by: string | null;
    history: { action: "suspended" | "lifted"; reason: string | null; by: string | null; at: string }[];
  };
  createdAt: string;
};

export type GroupsParams = { page: number; limit: number; suspended?: "true" | "false" | ""; search?: string };

const KEY = ["groups"] as const;

export const useGroups = (params: GroupsParams) =>
  useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: () => api.get<Paginated<GroupRow>>("/admin/groups", params),
    placeholderData: keepPreviousData,
  });

export const useGroup = (id: string) => useQuery({ queryKey: [...KEY, "detail", id], queryFn: () => api.get<GroupDetail>(`/admin/groups/${id}`) });

export type GroupSuspensionChange = { suspended: true; reason: string } | { suspended: false; reason?: string };

export function useSetGroupSuspension(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: GroupSuspensionChange) => api.post<GroupDetail>(`/admin/groups/${id}/suspension`, change),
    onSuccess: (group) => {
      client.setQueryData([...KEY, "detail", id], group);
      void client.invalidateQueries({ queryKey: [...KEY, "list"] });
    },
  });
}

export const PERIOD_LABELS: Record<GroupPeriod, string> = { weekly: "a week", monthly: "a month", yearly: "a year" };
