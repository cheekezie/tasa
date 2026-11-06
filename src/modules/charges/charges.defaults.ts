import type { RuleShape } from './charges.calc';

/**
 * Launch charges, seeded on an empty database and then managed by admins at
 * /api/admin/charges. Kobo: 10_000 = ₦100.
 *
 * Business rule: funding looks free — Tela absorbs SaySwitch's fee (booked to
 * expense:provider_fees) — and every transaction carries a charge instead.
 * PLACEHOLDER FIGURES: set the real ones in the admin before launch.
 */
const rule = (r: Partial<RuleShape> & Pick<RuleShape, 'scope' | 'label'>): RuleShape => ({
  serviceId: null,
  provider: null,
  code: 'service_charge',
  rateBps: 0,
  fixed: 0,
  min: 0,
  max: null,
  active: true,
  ...r,
});

export const DEFAULT_CHARGE_RULES: RuleShape[] = [
  // Free to the user. Kept as an inactive rule so finance can switch a charge on later.
  rule({ scope: 'funding', label: 'Funding charge', active: false }),

  rule({ scope: 'bill', label: 'Service charge', fixed: 2_000 }), // ₦20 — any bill without its own rule
  rule({ scope: 'bill', serviceId: 'airtime', label: 'Service charge', fixed: 2_000 }),
  rule({ scope: 'bill', serviceId: 'electricity', label: 'Service charge', fixed: 10_000 }),
  rule({ scope: 'bill', serviceId: 'tv', label: 'Service charge', fixed: 5_000 }),
  rule({ scope: 'bill', serviceId: 'internet', label: 'Service charge', fixed: 5_000 }),
  rule({ scope: 'bill', serviceId: 'water', label: 'Service charge', fixed: 5_000 }),
  rule({ scope: 'bill', serviceId: 'jamb', label: 'Service charge', fixed: 15_000 }),

  rule({ scope: 'transfer', label: 'Transfer charge', fixed: 1_000 }), // ₦10
  rule({ scope: 'gift', label: 'Gift charge', fixed: 2_000 }), // ₦20
  rule({ scope: 'ticket', label: 'Service charge', fixed: 5_000 }), // ₦50, paid by the buyer
  rule({ scope: 'ticket_sale', label: 'Selling fee', rateBps: 200, min: 2_000 }), // 2%, at least ₦20, per ticket, paid by the organiser
  rule({ scope: 'ticket_payout', label: 'Bank withdrawal fee', fixed: 5_000 }), // ₦50 per withdrawal of ticket sales to a bank
  rule({ scope: 'coupon', label: 'Giveaway charge', rateBps: 100, min: 5_000, max: 100_000 }), // 1%, ₦50–₦1,000
  // Free to members; kept so finance can switch a charge on later.
  rule({ scope: 'group_dues', label: 'Service charge', active: false }),
  rule({ scope: 'group_fee', label: 'Collection fee', rateBps: 100, min: 2_000, max: 50_000 }), // 1%, ₦20–₦500 per payment, paid by the group
  rule({ scope: 'group_payout', label: 'Bank withdrawal fee', fixed: 5_000 }), // ₦50 per withdrawal to the group's account
  rule({ scope: 'split', label: 'Service charge', active: false }), // free per share; the bill's own charge is split
];
