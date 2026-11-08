import { ServiceId } from '@/constants/data';

import { request } from '../client';
import { toActivityItem, toBillService, toInsights, toPlan, toQuote, toSpending } from '../mappers';
import {
  BillServiceDto,
  CustomerDto,
  InsightsDto,
  Paginated,
  PlanDto,
  QuoteDto,
  QuoteInput,
  SpendingDto,
  TransactionDto,
  TransactionStatus,
} from '../types';

// A vend can take a while at the provider, and giving up early only makes the outcome unknown.
const PURCHASE_TIMEOUT_MS = 60_000;

export type TransactionFilters = {
  kind?: string;
  serviceId?: ServiceId;
  status?: TransactionStatus;
  direction?: 'credit' | 'debit';
  beneficiaryId?: string;
};

export const paymentsService = {
  /** Prices anything that moves money. The returned id is what the action endpoint consumes. */
  createQuote: (input: QuoteInput) => request<QuoteDto>('/quotes', { method: 'POST', body: input }).then(toQuote),

  getBillServices: () => request<BillServiceDto[]>('/bills/services').then((services) => services.map(toBillService)),

  /** Who a meter, smart card or account belongs to, checked with the provider. Nothing is priced. */
  verifyAccount: (input: { serviceId: ServiceId; provider: string; account: string; meterType?: 'prepaid' | 'postpaid' }) =>
    request<{ account: string; customer: CustomerDto | null }>('/bills/verify', { method: 'POST', body: input }),

  getPlans: (serviceId: ServiceId, provider: string) =>
    request<PlanDto[]>(`/bills/services/${serviceId}/providers/${encodeURIComponent(provider)}/plans`).then((plans) => plans.map(toPlan)),

  /**
   * Comes back `pending` while the provider works on it; poll `getTransaction` until it settles.
   * `saveAs` saves the account as a beneficiary, with this label, once the bill succeeds.
   */
  purchaseBill: (quoteId: string, pin: string, saveAs?: string) =>
    request<TransactionDto>('/bills/purchases', {
      method: 'POST',
      body: { quoteId, ...(pin && { pin }), ...(saveAs && { saveBeneficiary: { label: saveAs } }) },
      timeoutMs: PURCHASE_TIMEOUT_MS,
    }).then(toActivityItem),

  sendTransfer: (quoteId: string, pin: string) =>
    request<TransactionDto>('/transfers', { method: 'POST', body: { quoteId, pin } }).then(toActivityItem),

  async getTransactions(page: number, filters: TransactionFilters = {}) {
    const result = await request<Paginated<TransactionDto>>('/transactions', {
      query: { page, ...filters },
    });
    return { ...result, items: result.items.map(toActivityItem) };
  },

  getTransaction: (reference: string) => request<TransactionDto>(`/transactions/${encodeURIComponent(reference)}`).then(toActivityItem),

  getSpending: (period: string) => request<SpendingDto>('/insights', { query: { period } }).then(toSpending),

  getInsights: (serviceId: ServiceId, months = 6) => request<InsightsDto>(`/insights/${serviceId}`, { query: { months } }).then(toInsights),
};
