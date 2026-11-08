import { useEffect, useMemo } from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/stores/auth.store";
import { RouteFallback } from "@/shared/components/RouteFallback";
import appRoutes from "@/routes/appRoutes";

/**
 * Parent route element for "guest only" sections (login, password reset, …).
 *
 * When an already-authenticated user lands here we redirect them to either the
 * URL captured in `?next=` or to the app home. We render `RouteFallback`
 * (instead of `<Navigate>`, which renders null) so the screen never goes blank
 * between unmounting `AuthLayout` and the destination route's lazy chunk
 * committing.
 */
export const RequireGuest = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { status, user } = useAuthStore(useShallow((s) => ({ status: s.status, user: s.user })));

  const isResolving = status === "idle" || status === "authenticating";
  const isAuthenticated = status === "authenticated" && Boolean(user);

  const redirectTarget = useMemo(() => {
    const next = searchParams.get("next");
    return next ? decodeURIComponent(next) : appRoutes.HOME;
  }, [searchParams]);

  useEffect(() => {
    if (!isAuthenticated) return;
    navigate(redirectTarget, { replace: true });
  }, [isAuthenticated, redirectTarget, navigate]);

  if (isResolving || isAuthenticated) return <RouteFallback />;

  return <Outlet />;
};
