import { randomCode } from './crypto';

/** Prefix tells support what a reference is at a glance: TSF-… is a funding, TSB-… a bill. */
const PREFIX = {
  funding: 'TSF',
  bill: 'TSB',
  transfer: 'TST',
  coupon: 'TSC',
  gift: 'TSG',
  refund: 'TSR',
  forfeit: 'TSX',
  points: 'TSP',
  ticket: 'TSK',
  ticket_refund: 'TSQ',
  ticket_payout: 'TSO',
  group_dues: 'TSD',
  group_payout: 'TSN',
  split_share: 'TSS',
  split_refund: 'TSU',
  guest_order: 'TSY',
} as const;

export const newReference = (kind: keyof typeof PREFIX) => `${PREFIX[kind]}${randomCode(14)}`;

/**
 * The same reference as it was written before the rename to Tasa (TS… was TL…). Anything that
 * builds a reference from other data, to catch a repeat, must look for both, or a repeat of
 * something done before the rename would look new.
 */
export const withLegacy = (reference: string) => (reference.startsWith('TS') ? [reference, `TL${reference.slice(2)}`] : [reference]);
