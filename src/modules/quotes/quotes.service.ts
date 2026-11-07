import type { ClientSession, Types } from 'mongoose';
import { env } from '../../config/env';
import { AppError, notFound } from '../../lib/errors';
import { QuoteModel, type IQuote, type QuoteDoc, type QuoteKind } from './models/quote.model';

export type QuoteDto = ReturnType<typeof toQuoteDto>;

export function toQuoteDto(q: IQuote) {
  return {
    id: q._id.toString(),
    kind: q.kind,
    currency: 'NGN' as const,
    /** Face value, kobo. For funding: what lands in the wallet. */
    amount: q.amount,
    charges: q.charges,
    fee: q.fee,
    discount: q.discount,
    /** amount + fee − discount. For funding: what the user must transfer. */
    total: q.total,
    expiresAt: q.expiresAt.toISOString(),
    ...(q.bill?.serviceId && {
      bill: {
        serviceId: q.bill.serviceId,
        provider: q.bill.provider,
        account: q.bill.account,
        product: q.bill.product ?? null,
        meterType: q.bill.meterType ?? null,
        planCode: q.bill.planCode ?? null,
        planName: q.bill.planName ?? null,
        customer: q.bill.customer?.name ? q.bill.customer : null,
      },
    }),
    ...(q.coupon?.code && { coupon: { code: q.coupon.code, kind: q.coupon.kind, fundedBy: q.coupon.fundedBy, title: q.coupon.title, auto: Boolean(q.coupon.auto) } }),
    ...(q.ticket?.event && {
      ticket: { eventTitle: q.ticket.eventTitle, tierName: q.ticket.tierName, quantity: q.ticket.quantity, unitPrice: q.ticket.unitPrice },
    }),
    ...(q.ticketPayout?.accountNumber && { ticketPayout: q.ticketPayout }),
    ...(q.transfer?.recipient && { transfer: { username: q.transfer.username ?? null, name: q.transfer.name } }),
    ...(q.couponCreate?.quantity && {
      couponCreate: {
        title: q.couponCreate.title,
        quantity: q.couponCreate.quantity,
        unitAmount: q.couponCreate.unitAmount,
        services: q.couponCreate.services,
        expiresAt: q.couponCreate.expiresAt.toISOString(),
      },
    }),
    ...(q.giftTo?.label && {
      giftTo: { recipient: q.giftTo.label, name: q.giftTo.name ?? null, onTasa: Boolean(q.giftTo.user), message: q.giftTo.message ?? null },
    }),
    ...(q.gift?.recipientLabel && {
      gift: {
        recipient: q.gift.recipientLabel,
        recipientName: q.gift.recipientName ?? null,
        /** false = not on Tasa yet; the gift goes as an SMS/email invite. */
        onTasa: Boolean(q.gift.recipientUser),
        serviceId: q.gift.serviceId,
        message: q.gift.message ?? null,
      },
    }),
  };
}

export const QuotesService = {
  async create(
    userId: string | Types.ObjectId,
    fields: Omit<IQuote, '_id' | 'user' | 'expiresAt' | 'createdAt' | 'usedAt' | 'discount' | 'total'> & { discount?: number },
  ): Promise<QuoteDoc> {
    const discount = fields.discount ?? 0;
    return QuoteModel.create({
      ...fields,
      user: userId,
      discount,
      total: fields.amount + fields.fee - discount,
      expiresAt: new Date(Date.now() + env.QUOTE_TTL_MINUTES * 60_000),
    });
  },

  /**
   * Marks the quote used inside the caller's transaction. Throws if it's someone else's,
   * the wrong kind, expired or already used — the caller looks up the existing
   * transaction first so a retried request gets the original result instead.
   */
  async consume(id: string, userId: string, kind: QuoteKind, session: ClientSession): Promise<QuoteDoc> {
    const quote = await QuoteModel.findOneAndUpdate(
      { _id: id, user: userId, kind, usedAt: null, expiresAt: { $gt: new Date() } },
      { usedAt: new Date() },
      { session, new: true },
    );
    if (quote) return quote;
    const existing = await QuoteModel.findOne({ _id: id, user: userId }).session(session);
    if (!existing || existing.kind !== kind) throw notFound('Quote not found');
    if (existing.usedAt) throw new AppError(409, 'This quote has already been used', 'QUOTE_USED');
    throw new AppError(410, 'This price has expired. Please review the payment again', 'QUOTE_EXPIRED');
  },
};
