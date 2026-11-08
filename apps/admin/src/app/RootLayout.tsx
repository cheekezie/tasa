import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { RouteFallback } from "@/shared/components/RouteFallback";
import { RouteNavigationProgress } from "@/shared/components/RouteNavigationProgress";

/**
 * Top-level route element mounted once for the lifetime of the app.
 *
 * Keeping a single `<Suspense>` here (instead of one per route) means that
 * during a navigation, React 18 has a stable boundary it can hold onto while
 * the next route's lazy chunk resolves — preventing the "blank flash" between
 * the old route unmounting and the new route's lazy element committing.
 */
export const RootLayout = () => (
  <ErrorBoundary>
    <RouteNavigationProgress />
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  </ErrorBoundary>
);
