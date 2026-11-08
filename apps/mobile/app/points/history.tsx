import { StyleSheet } from 'react-native';

import { Button } from '@/components/ui/Button';
import { PointsHistoryRow } from '@/components/ui/PointsHistoryRow';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { usePointsHistory } from '@/hooks/useOffers';

/** Every points change, newest first, a page at a time. */
export default function PointsHistoryScreen() {
  const t = useT();
  const history = usePointsHistory();

  return (
    <Screen refreshable>
      <QueryState query={history} hasData={!!history.data} />
      {history.data && history.items.length === 0 && <EmptyState message={t('points.empty')} />}
      {history.items.map((entry) => (
        <PointsHistoryRow key={entry.id} entry={entry} />
      ))}
      {history.hasNextPage && (
        <Button
          label={t('activity.loadMore')}
          variant="secondary"
          loading={history.isFetchingNextPage}
          onPress={() => history.fetchNextPage()}
          style={styles.more}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  more: {
    marginTop: theme.spacing.md,
  },
});
