import { create } from "zustand";
import { persist, createJSONStorage, devtools } from "zustand/middleware";
import { STORAGE_KEYS } from "@/lib/storage-keys";

type Theme = "light" | "dark" | "system";

type UIState = {
  sidebarCollapsed: boolean;
  navOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setNavOpen: (open: boolean) => void;
  setTheme: (t: Theme) => void;
};

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        sidebarCollapsed: false,
        navOpen: false,
        theme: "system" as Theme,
        toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
        setNavOpen: (navOpen) => set({ navOpen }),
        setTheme: (theme) => set({ theme }),
      }),
      {
        name: STORAGE_KEYS.UI_STORE,
        storage: createJSONStorage(() => localStorage),
        partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, theme: s.theme }),
      },
    ),
    { name: STORAGE_KEYS.UI_STORE },
  ),
);
