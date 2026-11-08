import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Transaction } from "@/features/transactions/api";
import { api } from "@/lib/http";

/** `CollectResult` in the API's collections.service. */
export type CollectResult =
  | { status: "credited"; transaction: Transaction; userId: string }
  | { status: "already_credited"; transaction: Transaction }
  /** SaySwitch doesn't report this reference as a successful payment (yet). */
  | { status: "not_paid" }
  /** Paid, but into no permanent account Tasa knows. `customerCode` is SaySwitch's, when it named one. */
  | { status: "unmatched"; customerCode?: string };

/**
 * POST /admin/collections: credits a transfer into a permanent account whose webhook never
 * came. SaySwitch is asked again and decides whose it was; it can only ever credit once.
 */
export function useCollect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reference: string) => api.post<CollectResult>("/admin/collections", { reference }),
    onSuccess: (result) => {
      // The user's wallet changed too; their page (users feature) refetches on its next visit.
      if (result.status === "credited") {
        void client.invalidateQueries({ queryKey: ["transactions"] });
        void client.invalidateQueries({ queryKey: ["users"] });
      }
    },
  });
}
