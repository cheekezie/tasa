import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ServiceId } from '@/constants/data';
import { useApp } from '@/context/AppContext';
import { TransactionFilters, paymentsService } from '@/lib/api/services/payments';
import { queryKeys } from '@/lib/queryClient';

const POLL_INTERVAL_MS = 5000;

export function useBillServices() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.billServices,
    queryFn: paymentsService.getBillServices,
    enabled: isSignedIn,
    staleTime: 60 * 60_000,
  });
}

/**
 * Checks a bill account with the provider once it looks complete, and keeps the answer: the
 * customer's name for a meter or smart card. A wrong number answers for good (no retries).
 */
export function useVerifiedBillAccount(
  serviceId: ServiceId,
  provider: string | null,
  account: string,
  meterType: 'prepaid' | 'postpaid',
  ready: boolean,
) {
  return useQuery({
    queryKey: queryKeys.billAccount(serviceId, provider ?? '', account, serviceId === 'electricity' ? meterType : ''),
    queryFn: () => paymentsService.verifyAccount({ serviceId, provider: provider!, account, ...(serviceId === 'electricity' && { meterType }) }),
    enabled: ready && !!provider,
    retry: false,
    staleTime: 10 * 60_000,
  });
}

export function usePlans(serviceId: ServiceId, provider: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.plans(serviceId, provider ?? ''),
    queryFn: () => paymentsService.getPlans(serviceId, provider!),
    enabled: enabled && !!provider,
    staleTime: 60 * 60_000,
  });
}

export function useActivity(filters: TransactionFilters = {}) {
  const { isSignedIn } = useApp();
  const query = useInfiniteQuery({
    queryKey: queryKeys.activity(filters),
    queryFn: ({ pageParam }) => paymentsService.getTransactions(pageParam, filters),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: isSignedIn,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return { ...query, items };
}

/** One transaction by reference, polling while the provider is still working on it. */
export function useTransaction(reference: string | null) {
  return useQuery({
    queryKey: queryKeys.transaction(reference ?? ''),
    queryFn: () => paymentsService.getTransaction(reference!),
    enabled: !!reference,
    refetchInterval: ({ state }) => (state.data?.status === 'pending' ? POLL_INTERVAL_MS : false),
  });
}

export function useInsights(serviceId: ServiceId) {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.insights(serviceId),
    queryFn: () => paymentsService.getInsights(serviceId),
    enabled: isSignedIn,
  });
}

export const SPENDING_PERIODS = ['this_month', 'last_month', '3_months', '6_months', 'this_year', 'all'] as const;
export type SpendingPeriod = (typeof SPENDING_PERIODS)[number];

export function useSpending(period: SpendingPeriod) {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.spending(period),
    queryFn: () => paymentsService.getSpending(period),
    enabled: isSignedIn,
  });
}
