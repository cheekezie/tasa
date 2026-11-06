import type { ReactNode } from "react";
import ForbiddenPage from "@/features/system/pages/ForbiddenPage";
import { useCan } from "@/stores";
import type { AdminRole } from "@/stores/auth.store";

/** A page only some roles may open. The API refuses the rest anyway; this just says so up front. */
export const RequireRole = ({ roles, children }: { roles: AdminRole[]; children: ReactNode }) => {
  const allowed = useCan(...roles);
  return allowed ? <>{children}</> : <ForbiddenPage />;
};
