import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useGiftHistory } from '@/hooks/useOffers';
import { GiftHistoryItem } from '@/lib/api/mappers';
import { formatDate, formatNaira } from '@/lib/format';

type Direction = 'received' | 'sent';

/** Every gift, in any state: unlike the Gifts tab, spent and expired ones stay here. */
export default function GiftHistoryScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ direction?: Direction }>();
  const [direction, setDirection] = useState<Direction>(params.direction ?? 'received');
  const query = useGiftHistory(direction);

  return (
    <Screen refreshable>
      <SegmentedControl
        options={[
          { value: 'received', label: t('giftHistory.received') },
          { value: 'sent', label: t('giftHistory.sent') },
        ]}
        value={direction}
        onChange={setDirection}
      />
      <QueryState query={query} hasData={!!query.data} />
      {query.data && query.items.length === 0 && (
        <EmptyState message={t(direction === 'received' ? 'giftHistory.noneReceived' : 'giftHistory.noneSent')} />
      )}
      {query.items.map((gift) => (
        <GiftHistoryCard key={gift.id} gift={gift} direction={direction} />
      ))}
      {query.hasNextPage && (
        <Button
          label={t('activity.loadMore')}
          variant="secondary"
          loading={query.isFetchingNextPage}
          onPress={() => query.fetchNextPage()}
        />
      )}
    </Screen>
  );
}

function GiftHistoryCard({ gift, direction }: { gift: GiftHistoryItem; direction: Direction }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const live = gift.state === 'active' || gift.state === 'delivered';
  const stateColor = gift.state === 'failed' ? colors.danger : live ? colors.success : colors.inkMuted;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <TasaText variant="bodyMedium" numberOfLines={1} style={styles.person}>
          {t(direction === 'received' ? 'gifts.from' : 'giftHistory.to', { from: gift.person })}
        </TasaText>
        <TasaText variant="caption" color={stateColor}>
          {t(`giftHistory.state.${gift.state}`)}
        </TasaText>
      </View>
      <TasaText variant="title" color={colors.heading}>
        {formatNaira(gift.amount)}
      </TasaText>
      <TasaText variant="caption" color={colors.inkSubtle}>
        {formatDate(gift.date)}
      </TasaText>
      {!!gift.message && (
        <TasaText variant="caption" color={colors.inkMuted}>
          “{gift.message}”
        </TasaText>
      )}

      {gift.type === 'bill' ? (
        <HistoryRow
          label={t(`services.${gift.serviceId}.name`)}
          value={`${gift.provider} · ${gift.account}`}
        />
      ) : (
        <>
          <HistoryRow label={t('gifts.used')} value={formatNaira(gift.used)} />
          {gift.state === 'active' && (
            <HistoryRow label={t('gifts.balance')} value={formatNaira(gift.left)} />
          )}
          <HistoryRow
            label={t('gifts.appliesTo')}
            value={
              gift.services === 'all'
                ? t('gifts.anyBill')
                : gift.services.map((id) => t(`services.${id}.name`)).join(', ')
            }
          />
          <HistoryRow label={t('gifts.expires')} value={formatDate(gift.expiresAt)} />
          {gift.spentOn.length > 0 && (
            <View style={styles.spent}>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('giftHistory.spentOn')}
              </TasaText>
              {gift.spentOn.map((use) => (
                <HistoryRow
                  key={use.reference}
                  label={[
                    use.serviceId ? t(`services.${use.serviceId}.name`) : null,
                    formatDate(use.date),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={formatNaira(use.amount)}
                />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function HistoryRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <TasaText variant="caption" color={colors.inkMuted} style={styles.rowLabel}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" style={styles.rowValue}>
        {value}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      gap: 4,
      marginTop: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    person: {
      flex: 1,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    rowLabel: {
      flexShrink: 1,
    },
    rowValue: {
      flexShrink: 1,
      textAlign: 'right',
    },
    spent: {
      gap: 4,
      marginTop: theme.spacing.xs,
      paddingTop: theme.spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  }),
);
