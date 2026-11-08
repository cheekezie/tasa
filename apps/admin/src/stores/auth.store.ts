import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, bindTokens } from "@/lib/http";
import { STORAGE_KEYS } from "@/lib/storage-keys";

export const ADMIN_ROLES = ["super_admin", "finance", "support", "compliance"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type Admin = { id: string; name: string; email: string; role: AdminRole };

type Status = "idle" | "authenticating" | "authenticated" | "unauthenticated";

type AuthState = {
  status: Status;
  user: Admin | null;
  accessToken: string | null;
  refreshToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  /** Re-reads who we are on load, so a role change or deactivation applies at once. */
  hydrate: () => Promise<void>;
  clear: () => void;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      status: "idle",
      user: null,
      accessToken: null,
      refreshToken: null,

      async login(email, password) {
        const res = await api.post<{ accessToken: string; refreshToken: string; admin: Admin }>("/auth/admin/login", {
          email,
          password,
        });
        set({ status: "authenticated", user: res.admin, accessToken: res.accessToken, refreshToken: res.refreshToken });
      },

      async hydrate() {
        if (!get().accessToken) {
          set({ status: "unauthenticated", user: null });
          return;
        }
        set({ status: "authenticating" });
        try {
          const me = await api.get<Admin>("/admin/me");
          set({ status: "authenticated", user: me });
        } catch {
          get().clear();
        }
      },

      clear() {
        set({ status: "unauthenticated", user: null, accessToken: null, refreshToken: null });
      },

      async logout() {
        const refreshToken = get().refreshToken;
        get().clear();
        if (refreshToken) await api.post("/auth/logout", { refreshToken }).catch(() => undefined);
      },
    }),
    {
      name: STORAGE_KEYS.AUTH_STORE,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }),
    },
  ),
);

bindTokens({
  access: () => useAuthStore.getState().accessToken,
  refresh: () => useAuthStore.getState().refreshToken,
  save: ({ accessToken, refreshToken }) => useAuthStore.setState({ accessToken, refreshToken }),
  signOut: () => useAuthStore.getState().clear(),
});

/** Mirrors the API: super admins pass every role check. */
export const hasRole = (user: Admin | null, ...roles: AdminRole[]) =>
  !!user && (user.role === "super_admin" || roles.includes(user.role));

/** For components: whether the signed-in admin may do something. Hides what the API would refuse. */
export function useCan(...roles: AdminRole[]) {
  return useAuthStore((s) => hasRole(s.user, ...roles));
}
