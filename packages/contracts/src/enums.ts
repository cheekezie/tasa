// Domain enums shared by the API (Mongoose enums, Zod schemas) and the clients (types, labels).
// Add a value here and every app sees it.

/** Data bundles are `airtime` with `product: 'data'`. */
export const SERVICE_IDS = ['electricity', 'airtime', 'tv', 'water', 'internet', 'jamb'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const TRANSACTION_KINDS = [
  'funding',
  'bill',
  'transfer_out',
  'transfer_in',
  /** Wallet → a coupon pool the user created. */
  'coupon_funding',
  /** Wallet → a gift for someone else. */
  'gift',
  /** Unredeemed coupon/gift money back to its creator. */
  'coupon_refund',
  /** A bank transfer into a beneficiary's virtual account. */
  'beneficiary_collection',
  /** A balance too small to transfer out, given up when closing the account. */
  'balance_forfeited',
  /** Points converted to wallet cash. */
  'points_redemption',
  /** Wallet → an organiser's ticket wallet. */
  'ticket_purchase',
  /** Back to the buyer inside the refund window. */
  'ticket_refund',
  /** An organiser's ticket wallet → their bill payment wallet. Can't be undone. */
  'ticket_withdrawal',
  /** An organiser's ticket wallet → their bank account, through SaySwitch. */
  'ticket_payout',
  /** A member's wallet → their group's balance, for one or more periods. */
  'group_dues',
  /** A group's balance → its locked payout account, through SaySwitch. */
  'group_payout',
  /** A wallet → a split bill's pot. */
  'split_share',
  /** A share back from a split that didn't get paid. */
  'split_refund',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/**
 * pending → success | failed | expired. `reversed` = succeeded, then undone (e.g. a vend
 * the provider later reported as failed).
 */
export const TRANSACTION_STATUSES = ['pending', 'success', 'failed', 'expired', 'reversed'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const COUPON_KINDS = ['coupon', 'gift', 'promo'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];
