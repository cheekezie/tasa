import type { TransactionKind, TransactionStatus } from "@/features/transactions/api";
import type { StatusVariant } from "@/shared/components/StatusBadge";

/** What operations staff call each kind. */
export const KIND_LABELS: Record<TransactionKind, string> = {
  funding: "Wallet funding",
  bill: "Bill",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  coupon_funding: "Giveaway funding",
  gift: "Gift",
  coupon_refund: "Giveaway refund",
  beneficiary_collection: "Beneficiary collection",
  balance_forfeited: "Balance forfeited",
  points_redemption: "Points converted",
  ticket_purchase: "Ticket purchase",
  ticket_refund: "Ticket refund",
  ticket_withdrawal: "Ticket withdrawal",
  ticket_payout: "Ticket payout",
  group_dues: "Group dues",
  group_payout: "Group withdrawal",
  split_share: "Split bill share",
  split_refund: "Split bill refund",
};

export const STATUS_VARIANTS: Record<TransactionStatus, StatusVariant> = {
  pending: "warning",
  success: "success",
  failed: "error",
  expired: "inactive",
  reversed: "info",
};
