import { ArrowLeftRight, BadgeCheck, BadgePercent, BookOpen, Building2, CalendarDays, Coins, FileClock, Gift, Landmark, LayoutDashboard, ListChecks, Receipt, ShieldCheck, ToggleRight, TrendingUp, UserCog, Users, UsersRound, Webhook, type LucideIcon } from "lucide-react";
import appRoutes from "@/routes/appRoutes";
import type { AdminRole } from "@/stores/auth.store";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  to: string;
  exact?: boolean;
  /** Who sees it. Empty = every admin. Super admins always do. Matches the API's own checks. */
  roles?: AdminRole[];
};

export type NavSection = { label: string; items: NavItem[] };

export const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", icon: LayoutDashboard, to: appRoutes.HOME, exact: true }],
  },
  {
    label: "Operations",
    items: [
      { label: "Transactions", icon: ArrowLeftRight, to: appRoutes.TRANSACTIONS },
      { label: "Users", icon: Users, to: appRoutes.USERS },
      { label: "BVN review", icon: ShieldCheck, to: appRoutes.BVN_QUEUE, roles: ["compliance"] },
      { label: "Organisers", icon: BadgeCheck, to: appRoutes.SELLERS, roles: ["compliance", "support", "finance"] },
      { label: "Groups", icon: UsersRound, to: appRoutes.GROUPS, roles: ["compliance", "support", "finance"] },
      { label: "Events", icon: CalendarDays, to: appRoutes.EVENTS, roles: ["support", "finance", "compliance"] },
      { label: "Missed collections", icon: Building2, to: appRoutes.COLLECTIONS, roles: ["finance", "support"] },
      { label: "Webhooks", icon: Webhook, to: appRoutes.WEBHOOKS },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Giveaways & gifts", icon: Gift, to: appRoutes.COUPONS },
      { label: "Promotions", icon: BadgePercent, to: appRoutes.PROMOTIONS },
      { label: "Points", icon: Coins, to: appRoutes.POINTS },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Charges", icon: Receipt, to: appRoutes.CHARGES },
      { label: "Profit & loss", icon: TrendingUp, to: appRoutes.PNL, roles: ["finance"] },
      { label: "Giveaway costs", icon: ListChecks, to: appRoutes.GIVEAWAYS, roles: ["finance"] },
      { label: "Ledger", icon: Landmark, to: appRoutes.LEDGER, roles: ["finance"] },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Switches & maintenance", icon: ToggleRight, to: appRoutes.SWITCHES },
      { label: "Staff", icon: UserCog, to: appRoutes.STAFF, roles: ["super_admin"] },
      { label: "Audit log", icon: FileClock, to: appRoutes.AUDIT, roles: ["finance"] },
    ],
  },
];

export const bottomNavItems: NavItem[] = [{ label: "My account", icon: BookOpen, to: appRoutes.ACCOUNT }];
