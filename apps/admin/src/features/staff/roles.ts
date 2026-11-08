import type { AdminRole } from "@/stores/auth.store";

export const MIN_PASSWORD = 12;

export const ROLE_INFO: Record<AdminRole, { label: string; does: string }> = {
  super_admin: { label: "Super admin", does: "Everything, including staff and maintenance" },
  finance: { label: "Finance", does: "Money: charges, promotions, giveaways, resolving bills, reports, audit log" },
  support: { label: "Support", does: "Users, requeries, switches, pausing giveaways and event sales" },
  compliance: { label: "Compliance", does: "BVN review" },
};
