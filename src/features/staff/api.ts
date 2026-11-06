import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { AdminRole } from "@/stores/auth.store";

/** GET /admin/staff rows (`toDto` in admins.service). The API returns every admin, oldest first, unpaginated. */
export type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type NewStaff = { name: string; email: string; role: AdminRole; password: string };
export type StaffChanges = Partial<{ name: string; role: AdminRole; isActive: boolean }>;

const KEY = ["staff"] as const;

/** Super admins only; pass `enabled: false` for anyone else so it isn't refused. */
export const useStaff = (enabled = true) => useQuery({ queryKey: KEY, queryFn: () => api.get<StaffMember[]>("/admin/staff"), enabled });

export function useCreateStaff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: NewStaff) => api.post<StaffMember>("/admin/staff", body),
    onSuccess: (created) => client.setQueryData<StaffMember[]>(KEY, (old) => (old ? [...old, created] : old)),
  });
}

export function useUpdateStaff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: StaffChanges }) => api.patch<StaffMember>(`/admin/staff/${id}`, changes),
    onSuccess: (updated) => client.setQueryData<StaffMember[]>(KEY, (old) => old?.map((s) => (s.id === updated.id ? updated : s))),
  });
}

/** Signs them out everywhere. */
export const useResetStaffPassword = () =>
  useMutation({ mutationFn: ({ id, password }: { id: string; password: string }) => api.post<{ reset: true }>(`/admin/staff/${id}/password`, { password }) });
