import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";

/** Who's behind an event, as buyers see them. `id` is the organiser's user id (their organiser page). */
export type Organiser = { id: string; name: string; logoUrl: string | null; events: number; rating: number | null; ratings: number };

/** GET /admin/events rows: the organiser's view (`toOwnerDto`), newest first. Money in kobo. */
export type AdminEvent = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  venue: string;
  imageUrl: string | null;
  gallery: { id: string; kind: "image" | "video"; url: string }[];
  organiser: Organiser;
  phone: string | null;
  email: string | null;
  startsAt: string;
  endsAt: string | null;
  /** 0 = no refunds. */
  refundDays: number;
  /** `paused` if either the organiser or Tasa paused; `ended` once the event is over. */
  sales: "on_sale" | "paused" | "ended";
  /** The organiser's own pause; they can lift it. */
  salesPaused: boolean;
  /** Tasa's pause; only staff can lift it. */
  adminPaused: boolean;
  tiers: { id: string; name: string; covers: number | null; price: number; limit: number | null; sold: number; remaining: number | null }[];
  sold: number;
  gross: number;
  checkedIn: number;
  staff: { id: string; name: string; username: string | null }[];
};

export type EventSales = "on_sale" | "paused" | "ended" | "tasa_paused";

/** `search` matches the title, or the exact event code. `owner` = one organiser's events. */
export type AdminEventsParams = { page: number; limit: number; search?: string; sales?: EventSales | ""; owner?: string };

const KEY = ["events", "admin"] as const;

export const useAdminEvents = (params: AdminEventsParams) =>
  useQuery({
    queryKey: [...KEY, params],
    queryFn: () => api.get<Paginated<AdminEvent>>("/admin/events", params),
    placeholderData: keepPreviousData,
  });

/** Patches the event wherever it's on screen, then refetches: it may no longer match the filter it was found under. */
export function useSetEventSales() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) => api.post<AdminEvent>(`/admin/events/${id}/sales`, { paused }),
    onSuccess: (event) => {
      client.setQueriesData<Paginated<AdminEvent>>({ queryKey: KEY }, (old) =>
        old ? { ...old, items: old.items.map((e) => (e.id === event.id ? event : e)) } : old,
      );
      void client.invalidateQueries({ queryKey: KEY });
    },
  });
}
