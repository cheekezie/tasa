import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, http, type Paginated } from "@/lib/http";

export type SellerVerificationStatus = "pending" | "approved" | "rejected" | "unsubmitted";
export type SellerIdType = "nin_slip" | "drivers_licence" | "passport" | "voters_card";
export type SellerDocument = "photo" | "id";

/** `verificationDto`: no files or keys, those only leave the API through the document endpoint. */
export type SellerVerification = {
  status: SellerVerificationStatus;
  idType: SellerIdType | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Only set while rejected. */
  reason: string | null;
};

/** `suspensionDto`: reason and `at` are only set while active. */
export type SellerSuspension = { active: boolean; reason: string | null; at: string | null };

/** GET /admin/sellers rows. `id` is the organiser's user id. */
export type SellerRow = {
  id: string;
  name: string | null;
  username: string | null;
  organisation: string | null;
  logoUrl: string | null;
  verification: SellerVerification;
  suspension: SellerSuspension;
  events: number;
  since: string;
};

/**
 * A submission they replaced with a newer one, newest first. `pending` means they replaced it
 * before anyone reviewed it. Its files are kept: pass `id` to `useSellerDocument`.
 */
export type SellerSubmission = {
  id: string;
  status: Exclude<SellerVerificationStatus, "unsubmitted">;
  idType: SellerIdType;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reason: string | null;
  hasDocuments: boolean;
};

/** GET /admin/sellers/:id. BVN and NIN arrive as last 4 only. Money in kobo. */
export type SellerDetail = {
  id: string;
  organisation: string | null;
  logoUrl: string | null;
  about: string | null;
  contact: { phone?: string; email?: string; website?: string; instagram?: string };
  user: {
    name: string | null;
    username: string | null;
    phone: string | null;
    email: string | null;
    /** Their own photo; the organisation's logo is `logoUrl`. */
    avatarUrl: string | null;
    bvnLast4: string | null;
    bvnStatus: "pending" | "verified" | "rejected" | null;
    ninLast4: string | null;
    status: "active" | "suspended" | "closed";
    joinedAt: string;
  } | null;
  verification: SellerVerification & { reviewedBy: string | null; hasDocuments: boolean; history: SellerSubmission[] };
  suspension: SellerSuspension & {
    by: string | null;
    liftedAt: string | null;
    /** Every suspend and lift, newest first. */
    history: { action: "suspended" | "lifted"; reason: string | null; by: string | null; at: string }[];
  };
  bankAccount: { bankCode: string; bankName: string; accountNumber: string; accountName: string } | null;
  ticketBalance: number;
  termsAccepted: string | null;
  since: string;
};

export const ID_TYPE_LABELS: Record<SellerIdType, string> = {
  nin_slip: "NIN slip",
  drivers_licence: "Driver's licence",
  passport: "International passport",
  voters_card: "Voter's card",
};

export type SellersParams = {
  page: number;
  limit: number;
  verification?: SellerVerificationStatus | "";
  suspended?: "true" | "false" | "";
  search?: string;
};

const KEY = ["sellers"] as const;

export const useSellers = (params: SellersParams) =>
  useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: () => api.get<Paginated<SellerRow>>("/admin/sellers", params),
    placeholderData: keepPreviousData,
  });

export const useSeller = (id: string) =>
  useQuery({ queryKey: [...KEY, "detail", id], queryFn: () => api.get<SellerDetail>(`/admin/sellers/${id}`) });

/** Both actions answer with the organiser as they now stand. */
function useSellerUpdated(id: string) {
  const client = useQueryClient();
  return (seller: SellerDetail) => {
    client.setQueryData([...KEY, "detail", id], seller);
    void client.invalidateQueries({ queryKey: [...KEY, "list"] });
  };
}

export type SellerDecision = { status: "approved" } | { status: "rejected"; reason: string };

export function useReviewSeller(id: string) {
  const updated = useSellerUpdated(id);
  return useMutation({
    mutationFn: (decision: SellerDecision) => api.post<SellerDetail>(`/admin/sellers/${id}/review`, decision),
    onSuccess: updated,
  });
}

export type SuspensionChange = { suspended: true; reason: string } | { suspended: false; reason?: string };

/** Suspending or lifting pauses or resumes their events, so the events lists go stale too. */
export function useSetSellerSuspension(id: string) {
  const client = useQueryClient();
  const updated = useSellerUpdated(id);
  return useMutation({
    mutationFn: (change: SuspensionChange) => api.post<SellerDetail>(`/admin/sellers/${id}/suspension`, change),
    onSuccess: (seller) => {
      updated(seller);
      void client.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

/**
 * The decrypted image, as raw bytes (not an envelope). A mutation, never a query: the file must
 * not sit in the cache, and each call is logged by the API, so it only runs when asked.
 */
/** The current submission's document, or an earlier one's when `submission` is its id. */
export const useSellerDocument = (id: string, kind: SellerDocument, submission?: string) =>
  useMutation({
    mutationFn: async () =>
      (await http.post<Blob>(`/admin/sellers/${id}/documents/${kind}`, undefined, { responseType: "blob", params: submission ? { submission } : undefined })).data,
  });
