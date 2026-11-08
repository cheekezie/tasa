import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { groupsService, splitsService } from '@/lib/api/services/groups';
import { CreateGroupInput, CreateSplitInput, DueInput, GroupDto } from '@/lib/api/types';
import { queryKeys } from '@/lib/queryClient';

export function useMyGroups() {
  return useQuery({ queryKey: queryKeys.groups, queryFn: groupsService.mine });
}

export function useGroup(id: string) {
  return useQuery({ queryKey: queryKeys.group(id), queryFn: () => groupsService.get(id) });
}

/** Only once there's a code worth asking about; a wrong code answers for good. */
export function useGroupPreview(code: string) {
  const trimmed = code.trim().toUpperCase();
  return useQuery({
    queryKey: queryKeys.groupPreview(trimmed),
    queryFn: () => groupsService.preview(trimmed),
    enabled: trimmed.length >= 6,
    retry: false,
  });
}

export function useGroupReceipts(id: string) {
  return useQuery({ queryKey: queryKeys.groupReceipts(id), queryFn: () => groupsService.receipts(id) });
}

export function useGroupMembers(id: string, filter: { status?: 'pending' | 'active'; owing?: boolean; search?: string }) {
  return useQuery({ queryKey: queryKeys.groupMembers(id, JSON.stringify(filter)), queryFn: () => groupsService.members(id, filter) });
}

export function useGroupMember(id: string, memberId: string) {
  return useQuery({ queryKey: queryKeys.groupMember(id, memberId), queryFn: () => groupsService.member(id, memberId) });
}

export function useDueReport(id: string, dueId: string, options: { year?: number; search?: string }) {
  return useQuery({
    queryKey: queryKeys.groupDueReport(id, dueId, JSON.stringify(options)),
    queryFn: () => groupsService.dueReport(id, dueId, options),
    placeholderData: (previous) => previous,
  });
}

export function useGroupWithdrawals(id: string) {
  return useQuery({ queryKey: queryKeys.groupWithdrawals(id), queryFn: () => groupsService.withdrawals(id) });
}

/** Every change to a group answers with the group; keep it and refresh what depends on it. */
function useGroupMutation<V>(id: string, fn: (variables: V) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      if (result && typeof result === 'object' && 'terms' in result) client.setQueryData(queryKeys.group(id), result as GroupDto);
      client.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });
}

export function useCreateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => groupsService.create(input),
    onSuccess: (group) => {
      client.setQueryData(queryKeys.group(group.id), group);
      client.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });
}

export function useJoinGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: groupsService.join,
    onSuccess: (group) => {
      client.setQueryData(queryKeys.group(group.id), group);
      client.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });
}

export const useUpdateGroup = (id: string) =>
  useGroupMutation(id, (input: { name?: string; about?: string }) => groupsService.update(id, input));
export const useGroupLogo = (id: string) => useGroupMutation(id, (uri: string) => groupsService.setLogo(id, uri));
export const useAddDue = (id: string) => useGroupMutation(id, (due: DueInput) => groupsService.addDue(id, due));
export const useEndDue = (id: string) => useGroupMutation(id, (dueId: string) => groupsService.endDue(id, dueId));
export const useAcceptGroupTerms = (id: string) => useGroupMutation(id, (version: number) => groupsService.acceptTerms(id, version));
export const useRotateInviteCode = (id: string) => useGroupMutation(id, () => groupsService.rotateCode(id));
export const useAddExecutive = (id: string) => useGroupMutation(id, (username: string) => groupsService.addExecutive(id, username));
export const useRemoveExecutive = (id: string) => useGroupMutation(id, (userId: string) => groupsService.removeExecutive(id, userId));
export const useProposePayoutChange = (id: string) =>
  useGroupMutation(id, (input: { bankCode: string; accountNumber: string; cosigners: string[]; pin: string }) =>
    groupsService.proposePayoutChange(id, input),
  );
export const useApprovePayoutChange = (id: string) => useGroupMutation(id, (pin: string) => groupsService.approvePayoutChange(id, pin));
export const useObjectToPayoutChange = (id: string) => useGroupMutation(id, (reason: string) => groupsService.objectToPayoutChange(id, reason));

/** Approving, declining, backfilling or removing: the list and the counts move. */
export function useMemberAction(id: string) {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['groups', id] });
    client.invalidateQueries({ queryKey: queryKeys.groups });
  };
  return {
    decide: useMutation({
      mutationFn: ({ memberId, approve }: { memberId: string; approve: boolean }) => groupsService.decide(id, memberId, approve),
      onSuccess: refresh,
    }),
    backfill: useMutation({
      mutationFn: ({ memberId, ...input }: { memberId: string; dueId: string; periods: number; note?: string }) =>
        groupsService.backfill(id, memberId, input),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (memberId: string) => groupsService.removeMember(id, memberId), onSuccess: refresh }),
  };
}

// ── Split bills ──
export function useSplits() {
  return useQuery({ queryKey: queryKeys.splits, queryFn: splitsService.list });
}

export function useSplit(id: string) {
  return useQuery({
    queryKey: queryKeys.split(id),
    queryFn: () => splitsService.get(id),
    // The bill is bought in the background once the pot is full: keep checking until it settles.
    refetchInterval: (query) => (query.state.data?.status === 'paying' ? 3000 : false),
  });
}

export function useCreateSplit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSplitInput) => splitsService.create(input),
    onSuccess: (split) => {
      client.setQueryData(queryKeys.split(split.id), split);
      client.invalidateQueries({ queryKey: queryKeys.splits });
    },
  });
}

export function useSplitAgain(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (hours?: number) => splitsService.again(id, hours),
    onSuccess: (split) => {
      client.setQueryData(queryKeys.split(split.id), split);
      client.invalidateQueries({ queryKey: queryKeys.splits });
    },
  });
}

export function useUpdateSplit(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: { title?: string; hours?: number }) => splitsService.update(id, change),
    onSuccess: (split) => {
      client.setQueryData(queryKeys.split(id), split);
      client.invalidateQueries({ queryKey: queryKeys.splits });
    },
  });
}

export function useCancelSplit(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => splitsService.cancel(id),
    onSuccess: (split) => {
      client.setQueryData(queryKeys.split(id), split);
      client.invalidateQueries({ queryKey: queryKeys.splits });
    },
  });
}
