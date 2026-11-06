import { lazy, type ComponentType } from "react";
import appRoutes from "./appRoutes";
import type { AdminRole } from "@/stores/auth.store";

export type RouteEntry = {
  id: string;
  path: string;
  Component: ComponentType;
  /** Who may open it. Empty = every admin; super admins always may. Matches the API. */
  roles?: AdminRole[];
};

const page = (load: () => Promise<{ default: ComponentType }>) => lazy(load);

export const authRoutes: RouteEntry[] = [
  { id: "login", path: appRoutes.AUTH.LOGIN, Component: page(() => import("@/features/auth/pages/LoginPage")) },
];

export const protectedRoutes: RouteEntry[] = [
  { id: "overview", path: appRoutes.HOME, Component: page(() => import("@/features/overview/pages/OverviewPage")) },
  { id: "transactions", path: appRoutes.TRANSACTIONS, Component: page(() => import("@/features/transactions/pages/TransactionsPage")) },
  { id: "transaction", path: appRoutes.TRANSACTION, Component: page(() => import("@/features/transactions/pages/TransactionDetailPage")) },
  { id: "users", path: appRoutes.USERS, Component: page(() => import("@/features/users/pages/UsersPage")) },
  { id: "user", path: appRoutes.USER, Component: page(() => import("@/features/users/pages/UserDetailPage")) },
  { id: "bvn", path: appRoutes.BVN_QUEUE, roles: ["compliance"], Component: page(() => import("@/features/users/pages/BvnQueuePage")) },
  { id: "events", path: appRoutes.EVENTS, roles: ["support", "finance", "compliance"], Component: page(() => import("@/features/events/pages/EventsPage")) },
  { id: "sellers", path: appRoutes.SELLERS, roles: ["compliance", "support", "finance"], Component: page(() => import("@/features/sellers/pages/SellersPage")) },
  { id: "seller", path: appRoutes.SELLER, roles: ["compliance", "support", "finance"], Component: page(() => import("@/features/sellers/pages/SellerDetailPage")) },
  { id: "groups", path: appRoutes.GROUPS, roles: ["compliance", "support", "finance"], Component: page(() => import("@/features/groups/pages/GroupsPage")) },
  { id: "group", path: appRoutes.GROUP, roles: ["compliance", "support", "finance"], Component: page(() => import("@/features/groups/pages/GroupDetailPage")) },
  { id: "coupons", path: appRoutes.COUPONS, Component: page(() => import("@/features/coupons/pages/CouponsPage")) },
  { id: "coupon", path: appRoutes.COUPON, Component: page(() => import("@/features/coupons/pages/CouponDetailPage")) },
  { id: "promotions", path: appRoutes.PROMOTIONS, Component: page(() => import("@/features/promotions/pages/PromotionsPage")) },
  { id: "charges", path: appRoutes.CHARGES, Component: page(() => import("@/features/charges/pages/ChargesPage")) },
  { id: "points", path: appRoutes.POINTS, Component: page(() => import("@/features/points/pages/PointsPage")) },
  { id: "points-users", path: appRoutes.POINTS_USERS, Component: page(() => import("@/features/points/pages/PointsBalancesPage")) },
  { id: "pnl", path: appRoutes.PNL, roles: ["finance"], Component: page(() => import("@/features/reports/pages/PnlPage")) },
  { id: "giveaways", path: appRoutes.GIVEAWAYS, roles: ["finance"], Component: page(() => import("@/features/reports/pages/GiveawaysPage")) },
  { id: "ledger", path: appRoutes.LEDGER, roles: ["finance"], Component: page(() => import("@/features/ledger/pages/LedgerPage")) },
  { id: "collections", path: appRoutes.COLLECTIONS, roles: ["finance", "support"], Component: page(() => import("@/features/collections/pages/CollectionsPage")) },
  { id: "webhooks", path: appRoutes.WEBHOOKS, Component: page(() => import("@/features/webhooks/pages/WebhooksPage")) },
  { id: "webhook", path: appRoutes.WEBHOOK, roles: ["finance"], Component: page(() => import("@/features/webhooks/pages/WebhookDetailPage")) },
  { id: "switches", path: appRoutes.SWITCHES, Component: page(() => import("@/features/config/pages/SwitchesPage")) },
  { id: "staff", path: appRoutes.STAFF, roles: ["super_admin"], Component: page(() => import("@/features/staff/pages/StaffPage")) },
  { id: "audit", path: appRoutes.AUDIT, roles: ["finance"], Component: page(() => import("@/features/audit/pages/AuditPage")) },
  { id: "account", path: appRoutes.ACCOUNT, Component: page(() => import("@/features/account/pages/AccountPage")) },
];

export const systemRoutes: RouteEntry[] = [
  { id: "forbidden", path: appRoutes.FORBIDDEN, Component: page(() => import("@/features/system/pages/ForbiddenPage")) },
  { id: "not-found", path: "*", Component: page(() => import("@/features/system/pages/NotFoundPage")) },
];
