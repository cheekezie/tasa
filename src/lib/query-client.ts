import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./http";

function toastApiError(error: unknown) {
  // 401s are handled silently by the HTTP interceptor (token refresh → redirect)
  if (error instanceof ApiError && error.status === 401) return;
  const message = error instanceof ApiError ? error.message : "Something went wrong";
  toast.error("Request failed", { description: message });
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Skip — the mutation has its own onError handler
      if (mutation.options.onError) return;
      toastApiError(error);
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
    mutations: {
      retry: false,
    },
  },
});
