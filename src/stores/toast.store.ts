import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type ToastVariant = "default" | "success" | "error" | "warning";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastState = {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
};

export const useToastStore = create<ToastState>()(
  devtools(
    (set) => ({
      toasts: [],
      addToast: (toast) =>
        set((s) => ({ toasts: [...s.toasts, { ...toast, id: crypto.randomUUID() }] })),
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      clearToasts: () => set({ toasts: [] }),
    }),
    { name: "toast" },
  ),
);
