import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActivityIcon, Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, ScreenHeader, TasaText } from '@/components/ui/Screen';
import { useSettings } from '@/context/SettingsContext';
import { useActivity } from '@/hooks/usePayments';
import { buyAgainRoute } from '@/lib/buyAgain';
import { formatNaira, formatRelativeDate } from '@/lib/format';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function ActivityScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useSettings();
  const query = useActivity();
  const activity = query.items;

  return (
    <Screen
      refreshable
      header={
        <ScreenHeader
          title={t('activity.title')}
          subtitle={t('activity.subtitle')}
        />
      }>
      <QueryState query={query} hasData={!!query.data} />
      {query.data && activity.length === 0 && <EmptyState message={t('activity.empty')} />}
      {activity.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityHint={t('activity.openHint')}
          onPress={() =>
            router.push({ pathname: '/activity/[id]', params: { id: item.reference ?? item.id } })
          }
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={styles.icon}>
            <ActivityIcon item={item} color={colors.brand} />
          </View>
          <View style={styles.copy}>
            <TasaText variant="bodyMedium" numberOfLines={1}>{item.title}</TasaText>
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
              {item.subtitle}
            </TasaText>
            <TasaText variant="caption" color={colors.inkSubtle}>
              {formatRelativeDate(item.date)}
            </TasaText>
            {buyAgainRoute(item) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('activity.buyAgain')}: ${item.title}`}
                hitSlop={8}
                onPress={() => router.push(buyAgainRoute(item)!)}
                style={styles.buyAgain}>
                <TasaText variant="caption" color={colors.brand}>
                  {t('activity.buyAgain')}
                </TasaText>
              </Pressable>
            )}
          </View>
          <TasaText
            variant="bodyMedium"
            color={item.direction === 'credit' ? colors.success : colors.ink}>
            {item.direction === 'credit' ? '+' : '-'}
            {formatNaira(item.amount)}
          </TasaText>
          <Icon ios="chevron.right" android="chevron_right" color={colors.inkSubtle} size={16} />
        </Pressable>
      ))}
      {query.hasNextPage && (
        <Button
          label={t('activity.loadMore')}
          variant="secondary"
          loading={query.isFetchingNextPage}
          onPress={() => query.fetchNextPage()}
          style={styles.more}
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    more: {
      marginTop: 12,
    },
    buyAgain: {
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    pressed: {
      opacity: 0.6,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
