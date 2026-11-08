import { Kobo } from '@/lib/money';

import { request } from '../client';
import { UPLOAD_TIMEOUT_MS, appendImage, imageForm } from './account';
import { toActivityItem, toEvent, toOwnerEvent, toQuote, toSeller, toTicket, toTicketFees } from '../mappers';
import {
  BankAccountInput,
  CreateEventInput,
  EventDto,
  EventSalesDto,
  OptInInput,
  OrganiserPageDto,
  OrganiserProfileInput,
  OwnerEventDto,
  ProfileDto,
  QuoteDto,
  SellerDto,
  SellerIdType,
  TicketDto,
  TicketFeesDto,
  TransactionDto,
  VerifiedBankAccountDto,
} from '../types';

export const eventsService = {
  list: (search: string) =>
    request<EventDto[]>('/events', { query: { search: search || undefined } }).then((items) =>
      items.map(toEvent),
    ),

  get: (id: string) => request<EventDto>(`/events/${id}`).then(toEvent),

  async mine() {
    const { owned, staffed } = await request<{ owned: OwnerEventDto[]; staffed: EventDto[] }>('/events/mine');
    return { owned: owned.map(toOwnerEvent), staffed: staffed.map(toEvent) };
  },

  manage: (id: string) => request<OwnerEventDto>(`/events/${id}/manage`).then(toOwnerEvent),

  create: (input: CreateEventInput) =>
    request<OwnerEventDto>('/events', {
      method: 'POST',
      body: input,
    }).then(toOwnerEvent),

  /** There's no cancelling an event: `salesPaused` stops sales, and limits cap them. */
  update: (
    id: string,
    changes: { salesPaused?: boolean; limits?: { tierId: string; limit: number | null }[] },
  ) => request<OwnerEventDto>(`/events/${id}`, { method: 'PATCH', body: changes }).then(toOwnerEvent),

  async setImage(id: string, uri: string) {
    const body = await imageForm(uri);
    return request<OwnerEventDto>(`/events/${id}/image`, {
      method: 'POST',
      body,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }).then(toOwnerEvent);
  },

  /** A photo or video for the event page. Videos can take a while on a slow connection. */
  async addMedia(id: string, uri: string) {
    const body = await imageForm(uri);
    return request<OwnerEventDto>(`/events/${id}/gallery`, { method: 'POST', body, timeoutMs: UPLOAD_TIMEOUT_MS * 4 }).then(
      toOwnerEvent,
    );
  },

  removeMedia: (id: string, mediaId: string) =>
    request<OwnerEventDto>(`/events/${id}/gallery/${mediaId}`, { method: 'DELETE' }).then(toOwnerEvent),

  /** Who bought what. Organiser only. */
  sales: (id: string) =>
    request<EventSalesDto>(`/events/${id}/sales`),

  addStaff: (id: string, username: string) =>
    request<OwnerEventDto>(`/events/${id}/staff`, { method: 'POST', body: { username } }).then(toOwnerEvent),

  removeStaff: (id: string, userId: string) =>
    request<OwnerEventDto>(`/events/${id}/staff/${userId}`, { method: 'DELETE' }).then(toOwnerEvent),

  /** Only with a scanned ticket. Rating again replaces the earlier one. */
  rate: (id: string, stars: number) =>
    request<{ stars: number; event: EventDto }>(`/events/${id}/rating`, { method: 'PUT', body: { stars } }),

  scan: (id: string, code: string) =>
    request<{ ticket: TicketDto }>(`/events/${id}/scan`, {
      method: 'POST',
      body: { code },
    }).then(({ ticket }) => toTicket(ticket)),
};

export const organisersService = {
  get: (id: string) =>
    request<OrganiserPageDto>(`/organisers/${id}`).then((page) => ({ ...page, upcoming: page.upcoming.map(toEvent) })),
};

export const ticketsService = {
  list: () => request<TicketDto[]>('/tickets').then((items) => items.map(toTicket)),

  get: (id: string) => request<TicketDto>(`/tickets/${id}`).then(toTicket),

  /** `holders`: who each ticket is for. A blank name means the buyer. */
  buy: (quoteId: string, pin: string, holders: string[]) =>
    request<{ transaction: TransactionDto; tickets: TicketDto[] }>('/tickets/purchases', {
      method: 'POST',
      body: { quoteId, pin, holders },
    }).then(({ transaction, tickets }) => ({
      transaction: toActivityItem(transaction),
      tickets: tickets.map(toTicket),
    })),

  /** Only inside the window the seller chose. Nobody has to approve it. */
  refund: (id: string) => request<TicketDto>(`/tickets/${id}/refund`, { method: 'POST' }).then(toTicket),
};

export const sellerService = {
  get: () => request<SellerDto>('/seller').then(toSeller),

  /** No PIN: this sets up who they are and where sales go; no money moves. */
  optIn: (input: OptInInput) => request<SellerDto>('/seller', { method: 'POST', body: input }).then(toSeller),

  update: (changes: OrganiserProfileInput & { acceptTerms?: string }) =>
    request<SellerDto>('/seller', { method: 'PATCH', body: changes }).then(toSeller),

  /** Who they are, for Tasa's compliance team: a photo of them and of their ID. */
  async submitVerification(idType: SellerIdType, photoUri: string, idUri: string) {
    const body = new FormData();
    body.append('idType', idType);
    await appendImage(body, 'photo', photoUri);
    await appendImage(body, 'id', idUri);
    return request<SellerDto['verification']>('/seller/verification', { method: 'POST', body, timeoutMs: UPLOAD_TIMEOUT_MS * 2 });
  },

  async setLogo(uri: string) {
    const body = await imageForm(uri);
    return request<SellerDto>('/seller/logo', { method: 'POST', body, timeoutMs: UPLOAD_TIMEOUT_MS }).then(toSeller);
  },

  setNin: (nin: string) => request<ProfileDto>('/me/nin', { method: 'POST', body: { nin } }),

  /** What a ticket at this price costs each side, from the live charge rules. */
  getFees: (price: Kobo) =>
    request<TicketFeesDto>('/seller/fees', { query: { price } }).then(toTicketFees),

  getBanks: () => request<{ code: string; name: string }[]>('/seller/banks'),

  /** Asks the bank who holds this account. */
  verifyBankAccount: (account: BankAccountInput) =>
    request<VerifiedBankAccountDto>('/seller/bank-account/verify', { method: 'POST', body: account }),

  setBankAccount: (account: BankAccountInput) =>
    request<SellerDto>('/seller/bank-account', { method: 'PUT', body: account }).then(toSeller),

  /** What a bank withdrawal of `amount` costs. Needs a saved bank account. */
  quotePayout: (amount: Kobo) =>
    request<QuoteDto>('/quotes', { method: 'POST', body: { kind: 'ticket_payout', amount } }).then(toQuote),

  /** Starts pending: the money is on its way once SaySwitch confirms. A retry with the same quote is the same payout. */
  payout: (quoteId: string, pin: string) =>
    request<TransactionDto>('/seller/payouts', { method: 'POST', body: { quoteId, pin } }).then(toActivityItem),

  /** To the bill payment wallet, for good. The key stays the same across retries, so it can only happen once. */
  withdraw: (amount: Kobo, pin: string, idempotencyKey: string) =>
    request<TransactionDto>('/seller/withdrawals', {
      method: 'POST',
      body: { amount, pin, idempotencyKey },
    }).then(toActivityItem),
};
