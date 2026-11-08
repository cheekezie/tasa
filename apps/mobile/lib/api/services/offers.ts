import { request } from '../client';
import { toActivityItem, toCoupon, toGiftHistoryItem, toGiftInbox, toPointsEntry, toPointsSummary, toPromotion } from '../mappers';
import {
  CouponCreatedDto,
  CouponDto,
  GiftHistoryItemDto, GiftInboxDto,
  Paginated,
  PointsEntryDto,
  PointsSummaryDto,
  TransactionDto,
} from '../types';

/** On a replayed quote the API returns the original transaction and `coupon: null`. */
const toCreated = ({ transaction, coupon }: CouponCreatedDto) => ({
  transaction: toActivityItem(transaction),
  coupon: coupon && toCoupon(coupon),
});

export const offersService = {
  async getMyCoupons() {
    const { items } = await request<Paginated<CouponDto>>('/coupons', { query: { limit: 100 } });
    return items.map(toCoupon);
  },

  createCoupon: (quoteId: string, pin: string) =>
    request<CouponCreatedDto>('/coupons', { method: 'POST', body: { quoteId, pin } }).then(toCreated),

  getCouponByCode: (code: string) =>
    request<CouponDto>(`/coupons/code/${encodeURIComponent(code)}`).then(toCoupon),

  getCouponBalances: () => request<CouponDto[]>('/coupons/balances').then((items) => items.map(toCoupon)),

  /** Stops new claims and returns the unclaimed money to the wallet. */
  cancelCoupon: (id: string) => request(`/coupons/${id}/cancel`, { method: 'POST' }),

  sendGift: (quoteId: string, pin: string) =>
    request<CouponCreatedDto>('/gifts', { method: 'POST', body: { quoteId, pin } }).then(toCreated),

  getReceivedGifts: () => request<CouponDto[]>('/gifts/received').then((items) => items.map(toCoupon)),

  getGiftInbox: () => request<GiftInboxDto>('/gifts/inbox').then(toGiftInbox),

  async getGiftHistory(direction: 'received' | 'sent', page: number) {
    const result = await request<Paginated<GiftHistoryItemDto>>('/gifts/history', {
      query: { direction, page },
    });
    return { ...result, items: result.items.map(toGiftHistoryItem) };
  },

  markGiftsSeen: (ids?: string[]) =>
    request('/gifts/inbox/seen', { method: 'POST', body: { ids } }),

  getPromotions: () => request<CouponDto[]>('/promotions').then((items) => items.map(toPromotion)),
};

export const pointsService = {
  getSummary: () => request<PointsSummaryDto>('/points').then(toPointsSummary),

  async getHistory(page = 1) {
    const result = await request<Paginated<PointsEntryDto>>('/points/history', { query: { page } });
    return { ...result, items: result.items.map(toPointsEntry) };
  },

  /** The key stays the same across retries of one conversion, so it can only happen once. */
  redeem: (input: { points: number; idempotencyKey: string }) =>
    request<{ transaction: TransactionDto }>('/points/redeem', { method: 'POST', body: input }).then(
      ({ transaction }) => ({ transaction: toActivityItem(transaction) }),
    ),
};
