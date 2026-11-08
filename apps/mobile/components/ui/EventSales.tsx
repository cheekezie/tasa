import { StyleSheet, View } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { EventSalesDto } from '@/lib/api/types';
import { formatDateTime, formatNaira } from '@/lib/format';

type Purchase = EventSalesDto['purchases'][number];

/** How far each ticket type has sold, with a bar where there's a limit. */
export function TierProgress({ tiers }: { tiers: EventSalesDto['byTier'] }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.tiers}>
      {tiers.map((tier) => (
        <View key={tier.id} style={styles.tier}>
          <View style={styles.row}>
            <TasaText variant="bodyMedium" style={styles.flex} numberOfLines={1}>
              {tier.name}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('tickets.soldOf', { sold: tier.sold, total: tier.limit ?? '∞' })} · {formatNaira(tier.gross)}
            </TasaText>
          </View>
          {tier.limit !== null && (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (tier.sold / tier.limit) * 100)}%` }]} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** One purchase: who, how many of what, when, and whether they've arrived or cancelled. */
export function PurchaseRow({ row }: { row: Purchase }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const refunded = row.refunded === row.quantity;
  return (
    <View style={styles.purchase}>
      <View style={styles.flex}>
        <TasaText variant="bodyMedium" numberOfLines={1}>
          {row.buyer}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
          {row.quantity} × {row.tierName} · {formatDateTime(row.at)}
        </TasaText>
      </View>
      <View style={styles.right}>
        <TasaText variant="bodyMedium" color={colors.heading}>
          {formatNaira(row.amount)}
        </TasaText>
        <TasaText variant="caption" color={refunded ? colors.danger : row.checkedIn > 0 ? colors.success : colors.inkSubtle}>
          {refunded
            ? t('tickets.status.refunded')
            : row.checkedIn > 0
              ? t('tickets.arrived', { count: row.checkedIn, total: row.quantity })
              : t('tickets.notArrived')}
        </TasaText>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    tiers: {
      gap: theme.spacing.md,
    },
    tier: {
      gap: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    flex: {
      flex: 1,
    },
    track: {
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: colors.track,
    },
    fill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: colors.brand,
    },
    purchase: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    right: {
      alignItems: 'flex-end',
      gap: 1,
    },
  }),
);
