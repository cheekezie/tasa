import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/stores/auth.store";
import { RouteFallback } from "@/shared/components/RouteFallback";
import appRoutes from "@/routes/appRoutes";

/**
 * Parent route element for authenticated sections of the app.
 *
 * - While the auth store is still hydrating, render the route fallback so the
 *   user never sees a flicker of the protected layout for an unauthenticated
 *   user.
 * - When the user is not authenticated, kick off a redirect to /login while
 *   continuing to render the fallback. Rendering the fallback (instead of
 *   `<Navigate>` which renders null) gives React 18 a non-empty boundary to
 *   hold during the navigation transition, avoiding a blank screen flash.
 */
export const RequireAuth = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { status, user } = useAuthStore(useShallow((s) => ({ status: s.status, user: s.user })));

  const isResolving = status === "idle" || status === "authenticating";
  const isAuthenticated = status === "authenticated" && Boolean(user);

  useEffect(() => {
    if (isResolving || isAuthenticated) return;

    const next = pathname === appRoutes.HOME ? "" : encodeURIComponent(pathname + search);
    const target = `${appRoutes.AUTH.LOGIN}${next ? `?next=${next}` : ""}`;
    navigate(target, { replace: true });
  }, [isResolving, isAuthenticated, pathname, search, navigate]);

  if (isResolving || !isAuthenticated) return <RouteFallback />;

  return <Outlet />;
};
