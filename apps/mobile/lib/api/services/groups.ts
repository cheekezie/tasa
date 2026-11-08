import { request } from '../client';
import { UPLOAD_TIMEOUT_MS, imageForm } from './account';
import { toActivityItem } from '../mappers';
import {
  CreateGroupInput,
  CreateSplitInput,
  GroupDto,
  DueInput,
  GroupDueReportDto,
  GroupMemberDetailDto,
  GroupMemberDto,
  GroupMembershipDto,
  GroupPreviewDto,
  GroupReceiptDto,
  GroupSummaryDto,
  GroupWithdrawalDto,
  Paginated,
  SplitDto,
  TransactionDto,
} from '../types';

const pay = (path: string, quoteId: string, pin: string) =>
  request<TransactionDto>(path, { method: 'POST', body: { quoteId, pin } }).then(toActivityItem);

export const groupsService = {
  mine: () => request<GroupSummaryDto[]>('/groups'),
  get: (id: string) => request<GroupDto>(`/groups/${id}`),
  create: (input: CreateGroupInput) => request<GroupDto>('/groups', { method: 'POST', body: input }),
  setLogo: async (id: string, uri: string) =>
    request<GroupDto>(`/groups/${id}/logo`, { method: 'POST', body: await imageForm(uri), timeoutMs: UPLOAD_TIMEOUT_MS }),
  update: (id: string, input: Partial<Pick<GroupDto, 'name' | 'about' | 'requireApproval'>>) =>
    request<GroupDto>(`/groups/${id}`, { method: 'PATCH', body: input }),
  /** The terms an invite shows before joining. */
  preview: (code: string) => request<GroupPreviewDto>(`/groups/join/${encodeURIComponent(code.trim())}`),
  join: (input: { code: string; fields: Record<string, string>; acceptTerms: number }) =>
    request<GroupDto>('/groups/join', { method: 'POST', body: input }),
  receipts: (id: string) => request<GroupReceiptDto[]>(`/groups/${id}/receipts`),
  acceptTerms: (id: string, version: number) => request<GroupDto>(`/groups/${id}/terms`, { method: 'POST', body: { acceptTerms: version } }),
  rotateCode: (id: string) => request<GroupDto>(`/groups/${id}/invite-code`, { method: 'POST' }),

  addDue: (id: string, due: DueInput) => request<GroupDto>(`/groups/${id}/dues`, { method: 'POST', body: due }),
  endDue: (id: string, dueId: string) => request<GroupDto>(`/groups/${id}/dues/${dueId}`, { method: 'PATCH', body: { ended: true } }),
  dueReport: (id: string, dueId: string, options: { year?: number; search?: string; page?: number }) => {
    const query = new URLSearchParams({ limit: '100', page: String(options.page ?? 1) });
    if (options.year) query.set('year', String(options.year));
    if (options.search) query.set('search', options.search);
    return request<GroupDueReportDto>(`/groups/${id}/dues/${dueId}/report?${query}`);
  },

  members: (id: string, filter: { status?: 'pending' | 'active'; owing?: boolean; search?: string }) => {
    const query = new URLSearchParams({ limit: '100' });
    if (filter.status) query.set('status', filter.status);
    if (filter.owing !== undefined) query.set('owing', String(filter.owing));
    if (filter.search) query.set('search', filter.search);
    return request<Paginated<GroupMemberDto>>(`/groups/${id}/members?${query}`);
  },
  decide: (id: string, memberId: string, approve: boolean) =>
    request<GroupMembershipDto>(`/groups/${id}/members/${memberId}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }),
  member: (id: string, memberId: string) => request<GroupMemberDetailDto>(`/groups/${id}/members/${memberId}`),
  backfill: (id: string, memberId: string, input: { dueId: string; periods: number; note?: string }) =>
    request<GroupMembershipDto>(`/groups/${id}/members/${memberId}/backfill`, { method: 'POST', body: input }),
  removeMember: (id: string, memberId: string) => request<{ removed: true }>(`/groups/${id}/members/${memberId}`, { method: 'DELETE' }),

  addExecutive: (id: string, username: string) => request<GroupDto>(`/groups/${id}/executives`, { method: 'POST', body: { username } }),
  removeExecutive: (id: string, userId: string) => request<GroupDto>(`/groups/${id}/executives/${userId}`, { method: 'DELETE' }),

  payDues: (id: string, quoteId: string, pin: string) => pay(`/groups/${id}/pay`, quoteId, pin),
  withdraw: (id: string, quoteId: string, pin: string) => pay(`/groups/${id}/withdrawals`, quoteId, pin),
  withdrawals: (id: string) => request<GroupWithdrawalDto[]>(`/groups/${id}/withdrawals`),

  proposePayoutChange: (id: string, input: { bankCode: string; accountNumber: string; cosigners: string[]; pin: string }) =>
    request<GroupDto>(`/groups/${id}/payout-change`, { method: 'POST', body: input }),
  approvePayoutChange: (id: string, pin: string) => request<GroupDto>(`/groups/${id}/payout-change/approve`, { method: 'POST', body: { pin } }),
  objectToPayoutChange: (id: string, reason: string) => request<GroupDto>(`/groups/${id}/payout-change/object`, { method: 'POST', body: { reason } }),
};

export const splitsService = {
  list: () => request<SplitDto[]>('/splits'),
  get: (id: string) => request<SplitDto>(`/splits/${id}`),
  create: (input: CreateSplitInput) => request<SplitDto>('/splits', { method: 'POST', body: input }),
  payShare: (id: string, quoteId: string, pin: string) => pay(`/splits/${id}/shares`, quoteId, pin),
  cancel: (id: string) => request<SplitDto>(`/splits/${id}/cancel`, { method: 'POST' }),
  /** The same bill and people again, as a new split. */
  again: (id: string, hours?: number) => request<SplitDto>(`/splits/${id}/again`, { method: 'POST', body: hours ? { hours } : {} }),
  /** The starter, while it's collecting: a new name, or a deadline `hours` from now. */
  update: (id: string, change: { title?: string; hours?: number }) => request<SplitDto>(`/splits/${id}`, { method: 'PATCH', body: change }),
};
