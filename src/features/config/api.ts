import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export type FeatureState = { enabled: boolean; message: string | null };

/** GET /admin/config: what the app sees, plus a label per feature. Codes are fixed in the API. */
export type AdminConfig = {
  maintenance: { active: boolean; message: string | null; until: string | null };
  features: Record<string, FeatureState>;
  labels: Record<string, string>;
  maintenanceStartedAt: string | null;
  updatedAt: string | null;
};

const KEY = ["config"] as const;

export const useAdminConfig = () => useQuery({ queryKey: KEY, queryFn: () => api.get<AdminConfig>("/admin/config") });

export function useSetFeature() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ code, enabled, message }: { code: string; enabled: boolean; message?: string }) =>
      api.patch<AdminConfig>("/admin/config/features", { [code]: { enabled, ...(message ? { message } : {}) } }),
    onSuccess: (data) => client.setQueryData(KEY, data),
  });
}

export function useSetMaintenance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { active: boolean; message?: string; until?: string }) => api.put<AdminConfig>("/admin/config/maintenance", body),
    onSuccess: (data) => client.setQueryData(KEY, data),
  });
}
