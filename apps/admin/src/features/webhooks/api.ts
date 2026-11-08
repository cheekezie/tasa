import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";

export const WEBHOOK_PROVIDERS = ["sayswitch", "vtpass"] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export const WEBHOOK_STATUSES = ["received", "processed", "ignored", "failed"] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

/**
 * A row of GET /admin/webhooks: the stored event without its raw body (that carries customer
 * details, so only finance sees it). Optional fields are missing, not null, until set.
 */
export type WebhookEvent = {
  id: string;
  provider: WebhookProvider;
  /** VTpass callbacks are unsigned (`none`); they only ever trigger a requery. */
  signature: "valid" | "invalid" | "none";
  status: WebhookStatus;
  reference?: string;
  /** What processing did, e.g. "funding success" or "collection TSV… (credited)". */
  result?: string;
  error?: string;
  processedAt?: string;
  createdAt: string;
};

/** GET /admin/webhooks/:id (finance): the same, plus the body exactly as received. */
export type WebhookEventDetail = WebhookEvent & { rawBody: string };

export type WebhookFilters = { provider?: WebhookProvider | ""; status?: WebhookStatus | ""; page: number; limit: number };

const KEY = ["webhooks"] as const;

export const useWebhooks = (filters: WebhookFilters) =>
  useQuery({
    queryKey: [...KEY, "list", filters],
    queryFn: () => api.get<Paginated<WebhookEvent>>("/admin/webhooks", filters),
    placeholderData: (previous) => previous,
  });

export const useWebhook = (id: string) =>
  useQuery({ queryKey: [...KEY, "detail", id], queryFn: () => api.get<WebhookEventDetail>(`/admin/webhooks/${id}`) });

/**
 * Runs the stored body through processing again. Safe: every path re-asks the provider before
 * money moves. The reply is the raw Mongo document (`_id`, not `id`), so refetch instead of
 * caching it. A failed replay still records its error on the event, so refetch then too.
 */
export function useReplayWebhook(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<(Omit<WebhookEventDetail, "id"> & { _id: string }) | null>(`/admin/webhooks/${id}/replay`),
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: KEY }), client.invalidateQueries({ queryKey: ["transactions"] })]),
  });
}
