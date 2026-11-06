import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

/** GET /admin/reports/overview. Kobo throughout. */
export type Overview = {
  from: string;
  to: string;
  users: { total: number; new: number };
  /** What Tela owes users right now: every wallet balance. */
  walletLiability: number;
  funding: { count: number; amount: number };
  bills: { count: number; amount: number; failed: number; successRate: number | null };
  transfers: { count: number; amount: number };
  attention: { pendingBills: number; needsReview: number; failedWebhooks: number; pendingBvn: number; pendingSellers: number };
  pnl: { revenue: number; costs: number; net: number };
};

/** For one of the app's periods, so the cards and the charts below them agree. */
export const useOverview = (period: IncomePeriod) =>
  useQuery({ queryKey: ["reports", "overview", period], queryFn: () => api.get<Overview>("/admin/reports/overview", { period }) });

/** The app's insight periods, in Lagos time. */
export const INCOME_PERIODS = ["this_month", "last_month", "3_months", "6_months", "this_year", "all"] as const;
export type IncomePeriod = (typeof INCOME_PERIODS)[number];

export const PERIOD_LABELS: Record<IncomePeriod, string> = {
  this_month: "This month",
  last_month: "Last month",
  "3_months": "3 months",
  "6_months": "6 months",
  this_year: "This year",
  all: "All time",
};

/** GET /admin/reports/income. Kobo. */
export type Income = {
  period: IncomePeriod;
  from: string;
  to: string;
  /** Everything Tela earned, and the part from bills (our charges plus VTpass commission). */
  income: number;
  billIncome: number;
  previous: { income: number; billIncome: number } | null;
  changePercent: number | null;
  /**
   * One bar per month (`key` YYYY-MM). A one-month period comes with the five months before it,
   * `inPeriod: false`, like the app's trend; `upcoming` months haven't happened yet. Quiet ones are zero.
   */
  series: { key: string; income: number; bills: number; inPeriod: boolean; upcoming: boolean }[];
  byCategory: {
    serviceId: string;
    name: string;
    charges: number;
    commission: number;
    income: number;
    bills: number;
    volume: number;
    share: number;
  }[];
};

export const useIncome = (period: IncomePeriod) =>
  useQuery({ queryKey: ["reports", "income", period], queryFn: () => api.get<Income>("/admin/reports/income", { period }) });
