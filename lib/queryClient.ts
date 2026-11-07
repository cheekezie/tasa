import NetInfo from '@react-native-community/netinfo';
import { MutationCache, QueryCache, QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { ServiceId } from '@/constants/data';
import { hasCode, isApiError } from '@/lib/api/errors';
import { hasInternet } from '@/lib/network';
import { TransactionFilters } from '@/lib/api/services/payments';
import { Kobo } from '@/lib/money';

/** A call refused for maintenance or a switched-off feature means the config we have is out of date. */
function refreshConfigOn(error: unknown) {
  if (hasCode(error, 'MAINTENANCE', 'FEATURE_DISABLED')) queryClient.invalidateQueries({ queryKey: queryKeys.config });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: refreshConfigOn }),
  mutationCache: new MutationCache({ onError: refreshConfigOn }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Worth another try only when the network or server hiccuped; a 4xx will answer the same.
      retry: (failures, error) => failures < 2 && (!isApiError(error) || error.status === 0 || error.status >= 500),
    },
    // Never automatic: a money action is only repeated when the user chooses to. `always` stops
    // writes being held offline and sent on reconnect, long after the user has moved on.
    mutations: { retry: false, networkMode: 'always' },
  },
});

// React Native has no window focus, so coming back to the app is what refreshes stale data.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => subscription.remove();
  });
}

// Reads pause while offline and catch up by themselves on reconnect.
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(hasInternet(state))));

export const queryKeys = {
  config: ['config'] as const,
  me: ['me'] as const,
  wallet: ['wallet'] as const,
  billServices: ['bills', 'services'] as const,
  plans: (serviceId: ServiceId, provider: string) => ['bills', 'plans', serviceId, provider] as const,
  activity: (filters: TransactionFilters = {}) => ['activity', filters] as const,
  activityRoot: ['activity'] as const,
  transaction: (reference: string) => ['transaction', reference] as const,
  insights: (serviceId: ServiceId) => ['insights', serviceId] as const,
  events: (search: string) => ['events', 'list', search] as const,
  event: (id: string) => ['events', 'one', id] as const,
  myEvents: ['events', 'mine'] as const,
  manageEvent: (id: string) => ['events', 'manage', id] as const,
  tickets: ['tickets'] as const,
  ticket: (id: string) => ['tickets', id] as const,
  seller: ['seller'] as const,
  banks: ['banks'] as const,
  ticketFees: (price: Kobo) => ['seller', 'fees', price] as const,
  bankAccount: (bankCode: string, accountNumber: string) => ['banks', bankCode, accountNumber] as const,
  billAccount: (serviceId: string, provider: string, account: string, meterType: string) =>
    ['bills', 'verify', serviceId, provider, account, meterType] as const,
  spending: (period: string) => ['insights', 'spending', period] as const,
  beneficiaries: ['beneficiaries'] as const,
  autoPayTerms: ['beneficiaries', 'terms'] as const,
  recurring: ['recurring'] as const,
  coupons: ['coupons'] as const,
  coupon: (code: string) => ['coupons', code] as const,
  couponBalances: ['coupons', 'balances'] as const,
  giftInbox: ['gifts', 'inbox'] as const,
  giftHistory: (direction: string) => ['gifts', 'history', direction] as const,
  promotions: ['promotions'] as const,
  notifications: ['notifications'] as const,
  points: ['points'] as const,
  pointsHistory: ['points', 'history'] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['groups', id] as const,
  groupMembers: (id: string, filter: string) => ['groups', id, 'members', filter] as const,
  groupWithdrawals: (id: string) => ['groups', id, 'withdrawals'] as const,
  groupMember: (id: string, memberId: string) => ['groups', id, 'member', memberId] as const,
  groupDueReport: (id: string, dueId: string, options: string) => ['groups', id, 'dues', dueId, options] as const,
  groupPreview: (code: string) => ['groups', 'join', code] as const,
  groupReceipts: (id: string) => ['groups', id, 'receipts'] as const,
  studentTerms: ['students', 'terms'] as const,
  studentProfile: ['students', 'me'] as const,
  schools: (search: string) => ['students', 'schools', search] as const,
  faculties: (schoolId: string) => ['students', 'faculties', schoolId] as const,
  departments: (schoolId: string, search: string) => ['students', 'departments', schoolId, search] as const,
  splits: ['splits'] as const,
  split: (id: string) => ['splits', id] as const,
};

/** Anything that moves money changes these, so they refetch after every payment. */
export function invalidateBalances() {
  return Promise.all(
    [
      queryKeys.me,
      queryKeys.wallet,
      queryKeys.activityRoot,
      queryKeys.points,
      queryKeys.coupons,
      ['gifts'],
      ['insights'],
      queryKeys.groups,
      queryKeys.splits,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
