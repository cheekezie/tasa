import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApp } from '@/context/AppContext';
import { offersService, pointsService } from '@/lib/api/services/offers';
import { invalidateBalances, queryKeys } from '@/lib/queryClient';

export function useCoupons() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.coupons,
    queryFn: offersService.getMyCoupons,
    enabled: isSignedIn,
  });
}

/** Coupons this user has started spending, with what's left. Gifts have their own list. */
export function useCouponBalances() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.couponBalances,
    queryFn: offersService.getCouponBalances,
    enabled: isSignedIn,
    select: (coupons) => coupons.filter((coupon) => coupon.kind === 'coupon'),
  });
}

export function useCoupon(code: string) {
  return useQuery({
    queryKey: queryKeys.coupon(code),
    queryFn: () => offersService.getCouponByCode(code),
  });
}

export function useCancelCoupon() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: offersService.cancelCoupon,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.coupons });
      return invalidateBalances();
    },
  });
}

export function useGiftInbox() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.giftInbox,
    queryFn: offersService.getGiftInbox,
    enabled: isSignedIn,
  });
}

export function useGiftHistory(direction: 'received' | 'sent') {
  const { isSignedIn } = useApp();
  const query = useInfiniteQuery({
    queryKey: queryKeys.giftHistory(direction),
    queryFn: ({ pageParam }) => offersService.getGiftHistory(direction, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: isSignedIn,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return { ...query, items };
}

export function useMarkGiftsSeen() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => offersService.markGiftsSeen(),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function usePromotions() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.promotions,
    queryFn: offersService.getPromotions,
    enabled: isSignedIn,
  });
}

export function usePoints() {
  const { isSignedIn } = useApp();
  return useQuery({
    queryKey: queryKeys.points,
    queryFn: pointsService.getSummary,
    enabled: isSignedIn,
  });
}

export function usePointsHistory() {
  const { isSignedIn } = useApp();
  const query = useInfiniteQuery({
    queryKey: queryKeys.pointsHistory,
    queryFn: ({ pageParam }) => pointsService.getHistory(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: isSignedIn,
  });
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  return { ...query, items };
}

export function useRedeemPoints() {
  return useMutation({
    mutationFn: pointsService.redeem,
    onSuccess: () => invalidateBalances(),
  });
}
