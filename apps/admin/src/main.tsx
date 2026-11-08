import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "@/app/router";
import { AskActionProvider } from "@/contexts/AskActionProvider";
import { queryClient } from "@/lib/query-client";
import { Toaster } from "@/shared/ui/sonner";
import { useAuthStore } from "@/stores/auth.store";
import "@/styles/globals.css";

// Who we are is re-read on every load: a role change or deactivation applies at once.
void useAuthStore.getState().hydrate();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AskActionProvider>
        <AppRouter />
      </AskActionProvider>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  </StrictMode>,
);
