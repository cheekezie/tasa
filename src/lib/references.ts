import { randomCode } from './crypto';

/** Prefix tells support what a reference is at a glance: TLF-… is a funding, TLB-… a bill. */
const PREFIX = {
  funding: 'TLF',
  bill: 'TLB',
  transfer: 'TLT',
  coupon: 'TLC',
  gift: 'TLG',
  refund: 'TLR',
  forfeit: 'TLX',
  points: 'TLP',
  ticket: 'TLK',
  ticket_refund: 'TLQ',
  ticket_payout: 'TLO',
  group_dues: 'TLD',
  group_payout: 'TLN',
  split_share: 'TLS',
  split_refund: 'TLU',
  guest_order: 'TLY',
} as const;

export const newReference = (kind: keyof typeof PREFIX) => `${PREFIX[kind]}${randomCode(14)}`;
