import { request } from '../client';
import { toBeneficiary, toRecurringBill } from '../mappers';
import {
  AutoPayTermsDto,
  BeneficiaryDto,
  BeneficiaryInput,
  NotificationDto,
  Paginated,
  RecurringChanges,
  RecurringDto,
  RecurringInput,
} from '../types';

export const beneficiariesService = {
  list: () =>
    request<BeneficiaryDto[]>('/beneficiaries').then((items) => items.map(toBeneficiary)),

  get: (id: string) => request<BeneficiaryDto>(`/beneficiaries/${id}`).then(toBeneficiary),

  create: (input: BeneficiaryInput) =>
    request<BeneficiaryDto>('/beneficiaries', { method: 'POST', body: input }).then(toBeneficiary),

  update: (id: string, changes: { label?: string; autoPay?: boolean }) =>
    request<BeneficiaryDto>(`/beneficiaries/${id}`, { method: 'PATCH', body: changes }).then(
      toBeneficiary,
    ),

  remove: (id: string) => request(`/beneficiaries/${id}`, { method: 'DELETE' }),

  getAutoPayTerms: () => request<AutoPayTermsDto>('/beneficiaries/auto-pay-terms'),

  /** Accepting the terms issues the account number that buys this bill when money lands in it. */
  optIn: (id: string, termsVersion: string) =>
    request<BeneficiaryDto>(`/beneficiaries/${id}/virtual-account`, {
      method: 'POST',
      body: { acceptTerms: true, termsVersion },
    }).then(toBeneficiary),
};

export const recurringService = {
  list: () => request<RecurringDto[]>('/recurring').then((items) => items.map(toRecurringBill)),

  create: (input: RecurringInput) =>
    request<RecurringDto>('/recurring', {
      method: 'POST',
      body: input,
    }).then(toRecurringBill),

  update: (id: string, changes: RecurringChanges) =>
    request<RecurringDto>(`/recurring/${id}`, {
      method: 'PATCH',
      body: changes,
    }).then(toRecurringBill),

  remove: (id: string) => request(`/recurring/${id}`, { method: 'DELETE' }),
};

export const notificationsService = {
  list: (page = 1) =>
    request<Paginated<NotificationDto> & { unread: number }>('/notifications', { query: { page } }),

  markRead: (ids?: string[]) => request('/notifications/read', { method: 'POST', body: { ids } }),
};
