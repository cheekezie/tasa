import { useQuery } from '@tanstack/react-query';

import { configService } from '@/lib/api/services/config';
import { FeatureKey } from '@/lib/api/types';
import { queryKeys } from '@/lib/queryClient';

const ON = { enabled: true, message: null } as const;

/**
 * Maintenance and feature switches. Read at startup, again whenever the app comes back to the
 * front, every minute, and at once when a call answers MAINTENANCE or FEATURE_DISABLED.
 */
export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: configService.get,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

/**
 * Whether a feature is on, and why not. Unknown counts as on: a config that didn't load must
 * never lock people out, and the API refuses a switched-off action anyway.
 */
export function useFeature(key: FeatureKey): { enabled: boolean; message: string | null } {
  const { data } = useAppConfig();
  return data?.features[key] ?? ON;
}
