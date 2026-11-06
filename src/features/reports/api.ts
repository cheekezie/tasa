import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

type Range = { from: string; to: string };

/** A promo or giveaway's cost in the period. `code`/`title`/`kind` are null if the coupon is gone. */
export type CampaignCost = { id: string; code: string | null; title: string | null; kind: "coupon" | "gift" | "promo" | null; amount: number };

/** GET /admin/reports/pnl. Kobo; income already flipped positive. */
export type Pnl = {
  from: string;
  to: string;
  revenue: {
    charges: { total: number; byScope: Record<string, { total: number; byService?: Record<string, number> }> };
    commission: { total: number; byService: Record<string, number> };
    total: number;
  };
  costs: {
    /** SaySwitch fees Tela absorbs, by source: funding, collection, payout, topup. */
    fundingFees: { total: number; bySource: Record<string, number>; unreportedCount: number };
    promotions: { total: number; byCampaign: CampaignCost[] };
    giveaways: { total: number; byCampaign: CampaignCost[] };
    points: { total: number };
    total: number;
  };
  net: number;
  /** What the figures can't see yet. */
  caveats: {
    /** Costs higher than shown: SaySwitch gave no fee. */
    fundingsWithoutFee: number;
    payoutsWithoutFee: number;
    /** Revenue lower than shown: VTpass gave no cost, so no commission was booked. */
    billsWithoutCost: number;
    /** Already counted as revenue; reverses if those bills fail. Any period. */
    pendingBillCharges: { amount: number; count: number };
  };
  /** Lagos days with any revenue or cost; quiet days are missing. */
  series: { day: string; revenue: number; costs: number; net: number }[];
};

/** GET /admin/reports/giveaways: a plain array of every Tela coupon, gift and promo. */
export type GiveawayRow = {
  id: string;
  code: string;
  title: string;
  kind: "coupon" | "gift" | "promo";
  status: "active" | "paused" | "expired" | "cancelled";
  startsAt: string;
  expiresAt: string;
  uses: number;
  people: number;
  costInPeriod: number;
  costToDate: number;
  /** Promo budget, or quantity × amount for a giveaway. */
  maxCost: number;
  exposureLeft: number;
};

export type Giveaways = {
  from: string;
  to: string;
  totals: { costInPeriod: number; promotionsInPeriod: number; giveawaysInPeriod: number; costToDate: number; exposureLeft: number };
  items: GiveawayRow[];
};

export const usePnl = (range: Range) => useQuery({ queryKey: ["reports", "pnl", range], queryFn: () => api.get<Pnl>("/admin/reports/pnl", range) });

export const useGiveaways = (range: Range) =>
  useQuery({ queryKey: ["reports", "giveaways", range], queryFn: () => api.get<Giveaways>("/admin/reports/giveaways", range) });
