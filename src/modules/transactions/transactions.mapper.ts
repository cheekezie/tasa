import { formatNaira } from '../../lib/money';
import type { ITransaction } from './models/transaction.model';

const SERVICE_NAMES: Record<string, string> = {
  electricity: 'electricity',
  airtime: 'airtime',
  tv: 'cable TV',
  internet: 'internet',
  water: 'water',
  jamb: 'exam PIN',
};

const who = (t: ITransaction) => (t.counterparty?.username ? `@${t.counterparty.username}` : (t.counterparty?.name ?? 'a Tela user'));

/** Default copy for the activity feed. The app may localise from the structured fields instead. */
function describe(t: ITransaction): { title: string; subtitle: string } {
  const b = t.bill;
  switch (t.kind) {
    case 'funding':
      return { title: 'Wallet funded', subtitle: 'Bank transfer' };
    case 'bill': {
      const what = `${b?.provider ?? ''} ${SERVICE_NAMES[b?.serviceId ?? ''] ?? 'bill'}`.trim();
      const outcome =
        t.status === 'success'
          ? b?.token || b?.pins?.length
            ? b.serviceId === 'electricity'
              ? 'Token delivered'
              : 'PIN delivered'
            : 'Delivered'
          : t.status === 'pending'
            ? 'Processing'
            : t.status === 'failed'
              ? 'Failed · Refunded'
              : t.status;
      const coupon = t.coupon && t.discount > 0 ? ` · ${t.coupon.code} saved ${formatNaira(t.discount)}` : '';
      const title = b?.planName ? `${what} · ${b.planName}` : what;
      if (t.giftTo?.label) return { title: `Gift: ${title}`, subtitle: `For ${t.giftTo.name ?? t.giftTo.label} · ${outcome}${coupon}` };
      return { title, subtitle: `${b?.account ?? ''} · ${outcome}${coupon}` };
    }
    case 'transfer_out':
      return { title: 'Tela transfer', subtitle: `To ${who(t)}` };
    case 'transfer_in':
      return { title: 'Tela transfer', subtitle: `From ${who(t)}` };
    case 'gift':
      return {
        title: 'Gifted utility bill',
        subtitle: `To ${t.counterparty?.name ?? t.counterparty?.username ?? ''} · ${SERVICE_NAMES[b?.serviceId ?? ''] ?? 'any bill'}`,
      };
    case 'coupon_funding':
      return { title: 'Giveaway created', subtitle: t.coupon?.code ?? '' };
    case 'coupon_refund':
      return { title: 'Giveaway refund', subtitle: `${t.coupon?.code ?? ''} · Unused balance returned` };
    case 'points_redemption':
      return { title: 'Points converted', subtitle: t.narration ?? 'Points' };
    case 'balance_forfeited':
      return { title: 'Balance forfeited', subtitle: 'Account closed' };
    case 'beneficiary_collection':
      return { title: 'Received for beneficiary', subtitle: t.narration ?? 'Bank transfer' };
    case 'ticket_purchase':
      return { title: 'Event tickets', subtitle: t.narration ?? '' };
    case 'ticket_refund':
      return { title: 'Ticket refund', subtitle: t.narration ?? '' };
    case 'ticket_withdrawal':
      return { title: 'Ticket sales moved', subtitle: 'To your bill payment wallet' };
    case 'ticket_payout':
      return { title: 'Ticket sales withdrawn', subtitle: t.payout ? `${t.payout.bankName} · ${t.payout.accountNumber}` : 'To your bank' };
    case 'group_dues':
      return {
        title: `${t.group?.name ?? 'Group'} dues`,
        subtitle: t.group?.dues?.length ? t.group.dues.map((d) => (d.periods.length > 1 ? `${d.name} ×${d.periods.length}` : d.name)).join(', ') : `${t.group?.periods ?? ''} periods`,
      };
    case 'group_payout':
      return { title: `${t.group?.name ?? 'Group'} withdrawal`, subtitle: t.payout ? `${t.payout.bankName} · ${t.payout.accountNumber}` : 'To the group account' };
    case 'split_share':
      return { title: `Share: ${t.split?.title ?? 'split bill'}`, subtitle: 'Paid into the split' };
    case 'split_refund':
      return { title: `Refund: ${t.split?.title ?? 'split bill'}`, subtitle: 'The bill wasn\'t paid' };
  }
}

export type TransactionDto = ReturnType<typeof toTransactionDto>;

export function toTransactionDto(t: ITransaction) {
  return {
    id: t._id.toString(),
    reference: t.reference,
    kind: t.kind,
    /** Matches the app's ActivityItem.type. */
    type: (
      {
        funding: 'fund',
        bill: 'payment',
        transfer_out: 'transfer',
        transfer_in: 'transfer',
        gift: 'gift',
        coupon_funding: 'coupon',
        coupon_refund: 'coupon',
        beneficiary_collection: 'fund',
        balance_forfeited: 'transfer',
        points_redemption: 'fund',
        ticket_purchase: 'coupon',
        ticket_refund: 'coupon',
        ticket_withdrawal: 'fund',
        ticket_payout: 'transfer',
        group_dues: 'payment',
        group_payout: 'transfer',
        split_share: 'payment',
        split_refund: 'fund',
      } as const
    )[t.kind],
    direction: t.direction,
    status: t.status,
    ...describe(t),
    amount: t.amount,
    fee: t.fee,
    discount: t.discount,
    total: t.total,
    charges: t.charges,
    serviceId: t.bill?.serviceId ?? null,
    beneficiaryId: t.beneficiary?.toString() ?? null,
    bill: t.bill?.serviceId
      ? {
          provider: t.bill.provider,
          account: t.bill.account,
          product: t.bill.product ?? null,
          meterType: t.bill.meterType ?? null,
          planCode: t.bill.planCode ?? null,
          planName: t.bill.planName ?? null,
          customerName: t.bill.customerName ?? null,
          token: t.bill.token ?? null,
          units: t.bill.units ?? null,
          /** WAEC / Spectranet PINs. */
          pins: t.bill.pins?.length ? t.bill.pins.map((p) => ({ pin: p.pin, serial: p.serial ?? null })) : null,
        }
      : null,
    funding: t.funding?.accountNumber
      ? {
          accountNumber: t.funding.accountNumber,
          bankName: t.funding.bankName,
          accountName: t.funding.accountName,
          expiresAt: t.funding.expiresAt.toISOString(),
          amountReceived: t.funding.amountReceived ?? null,
        }
      : null,
    counterparty: t.counterparty?.username || t.counterparty?.name
      ? { username: t.counterparty.username ?? null, name: t.counterparty.name ?? null }
      : null,
    coupon: t.coupon?.code ? { code: t.coupon.code, kind: t.coupon.kind ?? 'coupon' } : null,
    /** Sender's view of a "pay their bill" gift: only what they typed. */
    giftTo: t.giftTo?.label ? { recipient: t.giftTo.label, name: t.giftTo.name ?? null, message: t.giftTo.message ?? null } : null,
    date: t.createdAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}
