const appRoutes = {
  HOME: "/",
  AUTH: { LOGIN: "/login" },
  TRANSACTIONS: "/transactions",
  TRANSACTION: "/transactions/:id",
  USERS: "/users",
  USER: "/users/:id",
  BVN_QUEUE: "/bvn",
  EVENTS: "/events",
  SELLERS: "/organisers",
  SELLER: "/organisers/:id",
  GROUPS: "/groups",
  GROUP: "/groups/:id",
  STUDENTS: "/students",
  STUDENT: "/students/:id",
  SCHOOLS: "/schools",
  SCHOOL: "/schools/:id",
  COUPONS: "/coupons",
  COUPON: "/coupons/:id",
  PROMOTIONS: "/promotions",
  CHARGES: "/charges",
  POINTS: "/points",
  POINTS_USERS: "/points/users",
  PNL: "/reports/pnl",
  GIVEAWAYS: "/reports/giveaways",
  LEDGER: "/ledger",
  COLLECTIONS: "/collections",
  WEBHOOKS: "/webhooks",
  WEBHOOK: "/webhooks/:id",
  SWITCHES: "/switches",
  STAFF: "/staff",
  AUDIT: "/audit",
  ACCOUNT: "/account",
  FORBIDDEN: "/forbidden",
} as const;

/** "/users/:id" + { id } → "/users/abc". */
export const toPath = (pattern: string, params: Record<string, string>) =>
  pattern.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ""));

export default appRoutes;
