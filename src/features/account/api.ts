import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { AdminRole } from "@/stores/auth.store";

/** GET /admin/me: the same record staff management shows. */
export type Me = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/admin/me") });

/** Revokes every session of yours, this one included: the caller signs out after it succeeds. */
export const useChangePassword = () =>
  useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post<{ changed: true }>("/admin/me/password", body),
  });
