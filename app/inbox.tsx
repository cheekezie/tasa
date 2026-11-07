import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useMarkNotificationsRead, useNotificationFeed } from '@/hooks/useSaved';
import { formatRelativeDate } from '@/lib/format';

/** The in-app notification feed. Opening it marks everything read. */
export default function InboxScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const query = useNotificationFeed();
  const { mutate: markRead } = useMarkNotificationsRead();
  const unread = query.data?.unread ?? 0;
  const items = query.data?.items ?? [];

  useEffect(() => {
    if (unread > 0) markRead(undefined);
  }, [unread, markRead]);

  return (
    <Screen refreshable>
      <QueryState query={query} hasData={!!query.data} />
      {query.data && items.length === 0 && <EmptyState message={t('inbox.empty')} />}
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <TasaText variant="bodyMedium">{item.title}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {item.body}
          </TasaText>
          <TasaText variant="caption" color={colors.inkSubtle}>
            {formatRelativeDate(item.createdAt)}
          </TasaText>
        </View>
      ))}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: {
      gap: 2,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
  }),
);
