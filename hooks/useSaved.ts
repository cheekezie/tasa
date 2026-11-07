import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApp } from '@/context/AppContext';
import { beneficiariesService, notificationsService, recurringService } from '@/lib/api/services/saved';
import { RecurringChanges } from '@/lib/api/types';
import { queryKeys } from '@/lib/queryClient';

export function useBeneficiaries() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.beneficiaries,
    queryFn: beneficiariesService.list,
    enabled: isSignedIn,
  });
}

export function useCreateBeneficiary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: beneficiariesService.create,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.beneficiaries }),
  });
}

export function useRemoveBeneficiary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: beneficiariesService.remove,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.beneficiaries }),
  });
}

export function useAutoPayOptIn(id: string) {
  const client = useQueryClient();
  return useMutation({
    // Fetched at the moment of accepting, so a stale version can't be sent (TERMS_OUTDATED).
    mutationFn: async () => {
      const { version } = await beneficiariesService.getAutoPayTerms();
      return beneficiariesService.optIn(id, version);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.beneficiaries }),
  });
}

export function useAutoPayTerms() {
  return useQuery({
    queryKey: queryKeys.autoPayTerms,
    queryFn: beneficiariesService.getAutoPayTerms,
  });
}

export function useRecurringBills() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.recurring,
    queryFn: recurringService.list,
    enabled: isSignedIn,
  });
}

export function useCreateRecurring() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: recurringService.create,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useUpdateRecurring() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: RecurringChanges }) =>
      recurringService.update(id, changes),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useRemoveRecurring() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: recurringService.remove,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.recurring }),
  });
}

export function useNotificationFeed() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => notificationsService.list(),
    enabled: isSignedIn,
  });
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: notificationsService.markRead,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}
