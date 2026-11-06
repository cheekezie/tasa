import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { RootLayout } from "@/app/RootLayout";
import AuthLayout from "@/features/auth/components/AuthLayout";
import AppLayout from "@/features/dashboard/components/AppLayout";
import { RequireAuth } from "@/routes/guards/RequireAuth";
import { RequireGuest } from "@/routes/guards/RequireGuest";
import { authRoutes, protectedRoutes, systemRoutes, type RouteEntry } from "@/routes/metadata";
import { RequireRole } from "@/routes/guards/RequireRole";

const toRouteObject = ({ id, path, Component, roles }: RouteEntry): RouteObject => ({
  id,
  path,
  element: roles?.length ? (
    <RequireRole roles={roles}>
      <Component />
    </RequireRole>
  ) : (
    <Component />
  ),
});

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <RequireGuest />,
        children: [
          {
            element: <AuthLayout />,
            children: authRoutes.map(toRouteObject),
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: protectedRoutes.map(toRouteObject),
          },
        ],
      },
      ...systemRoutes.map(toRouteObject),
    ],
  },
]);

export const AppRouter = () => <RouterProvider router={router} />;
