import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ListRows, SkeletonScreen, type SkeletonShape } from '@/components/ui/Skeleton';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';
import { errorMessage, isApiError } from '@/lib/api/errors';

type QueryLike = {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  fetchStatus?: string;
  isFetching?: boolean;
};

/** What went wrong with a load, and the one button that tries it again. Fills its screen. */
export function LoadError({
  error,
  reloading,
  onReload,
  fill,
}: {
  error: unknown;
  reloading?: boolean;
  onReload: () => void;
  /** For a whole screen, rather than inside one that scrolls. */
  fill?: boolean;
}) {
  const { colors } = useTheme();
  const t = useT();
  const unreachable = isApiError(error) && error.status === 0;
  const serverSide = isApiError(error) && error.status >= 500;
  return (
    <View style={[styles.failure, fill && { flex: 1, backgroundColor: colors.surface }]}>
      <Icon
        color={colors.inkSubtle}
        ios={unreachable ? 'wifi.slash' : 'exclamationmark.triangle'}
        android={unreachable ? 'wifi_off' : 'error'}
        size={36}
      />
      <TasaText variant="title" color={colors.heading} style={styles.message}>
        {t(unreachable ? 'loadError.unreachable' : serverSide ? 'loadError.server' : 'loadError.generic')}
      </TasaText>
      <TasaText variant="body" color={colors.inkMuted} style={styles.message}>
        {errorMessage(error)}
      </TasaText>
      <Button label={t('loadError.reload')} loading={reloading} style={styles.reload} onPress={onReload} />
    </View>
  );
}

/**
 * Spinner or error for what a screen is showing. Renders nothing once there's data to show.
 * `quiet` is for anything secondary: if it fails the screen carries on without it, rather
 * than adding a second error and a second button.
 */
/**
 * A load's waiting, offline and failed states. While it loads, a skeleton in the shape of what's
 * coming (`skeleton`); a `quiet` section inside a bigger screen gets just a couple of rows.
 */
export function QueryState({
  query,
  hasData,
  quiet,
  skeleton = 'list',
}: {
  query: QueryLike;
  hasData?: boolean;
  quiet?: boolean;
  skeleton?: SkeletonShape;
}) {
  const { colors } = useTheme();
  const t = useT();
  if (hasData) return null;
  if (query.isError) {
    if (quiet) return null;
    return (
      <LoadError error={query.error} reloading={query.isFetching} onReload={() => query.refetch()} />
    );
  }
  // Paused for lack of internet: it fetches by itself on reconnect, so there's nothing to retry.
  if (query.isPending && query.fetchStatus === 'paused') {
    if (quiet) return null;
    return (
      <View style={styles.root}>
        <TasaText variant="body" color={colors.inkMuted} style={styles.message}>
          {t('network.waiting')}
        </TasaText>
      </View>
    );
  }
  if (query.isPending && query.fetchStatus !== 'idle') {
    return quiet ? <ListRows count={2} /> : <SkeletonScreen shape={skeleton} />;
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
  },
  failure: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    minHeight: 360,
    paddingHorizontal: theme.spacing.md,
  },
  message: {
    textAlign: 'center',
  },
  reload: {
    alignSelf: 'stretch',
    marginTop: theme.spacing.md,
  },
});
