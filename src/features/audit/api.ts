import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Paginated } from "@/lib/http";

/**
 * GET /admin/audit rows: every back-office change, refused attempts included. `adminName` is
 * null if that admin no longer exists. `details` holds allow-listed body fields (never passwords); `route` is the pattern, with
 * the values in `params`.
 */
export type AuditEntry = {
  id: string;
  admin: string;
  adminName: string | null;
  role?: string;
  method: string;
  route: string;
  params: Record<string, string>;
  details: Record<string, unknown>;
  statusCode: number;
  ip?: string;
  createdAt: string;
};

export type AuditParams = { page: number; limit: number; admin?: string };

export const useAudit = (params: AuditParams) =>
  useQuery({
    queryKey: ["audit", params],
    queryFn: () => api.get<Paginated<AuditEntry>>("/admin/audit", params),
    placeholderData: keepPreviousData,
  });
