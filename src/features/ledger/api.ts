import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

/**
 * GET /admin/ledger/summary: balance per account group, raw ledger signs (assets +, owed −).
 * Every root is covered, so the groups sum to zero like the books.
 */
export type LedgerSummary = {
  "provider:sayswitch": number;
  "provider:vtpass": number;
  "bills:in_flight": number;
  "payouts:in_flight": number;
  "wallet:*": number;
  "tickets:*": number;
  "coupon:*": number;
  "revenue:*": number;
  "expense:*": number;
  "equity:*": number;
  "liability:*": number;
};

/**
 * GET /admin/ledger/vtpass: VTpass's own balance vs `provider:vtpass` on our books. When VTpass
 * doesn't answer, `vtpass` and `difference` are null and `vtpassError` says why; `books` still shows.
 */
export type VtpassBalance = { vtpass: number | null; books: number; difference: number | null; vtpassError: string | null };

/** `fee`: kobo SaySwitch charged to send it (SaySwitch only), booked as a cost. */
export type TopupInput = { amount: number; from: "sayswitch" | "external"; fee?: number; note: string; idempotencyKey: string };

/** POST /admin/ledger/vtpass-topups. `duplicate: true` = that key was already recorded; nothing new was posted. */
export type TopupResult = { posting: string; duplicate: boolean; books: number };

const KEY = ["ledger"] as const;

export const useLedgerSummary = () =>
  useQuery({ queryKey: [...KEY, "summary"], queryFn: () => api.get<LedgerSummary>("/admin/ledger/summary") });

export const useVtpassBalance = () =>
  useQuery({ queryKey: [...KEY, "vtpass"], queryFn: () => api.get<VtpassBalance>("/admin/ledger/vtpass") });

/** Records a top-up made in the providers' dashboards, so the books match VTpass again. Moves no money itself. */
export function useRecordTopup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TopupInput) => api.post<TopupResult>("/admin/ledger/vtpass-topups", body),
    onSuccess: ({ books }) => {
      client.setQueryData<VtpassBalance>([...KEY, "vtpass"], (prev) => (prev ? { ...prev, books, difference: prev.vtpass === null ? null : prev.vtpass - books } : prev));
      void client.invalidateQueries({ queryKey: [...KEY, "summary"] });
      void client.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}
