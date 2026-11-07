import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActivityIcon, Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { PointsEntry } from '@/lib/api/mappers';
import { formatNaira, formatRelativeDate } from '@/lib/format';

const ENTRY_ICONS = {
  earn: { ios: 'star.fill', android: 'star' },
  redeem: { ios: 'arrow.down.circle', android: 'arrow_circle_down' },
  forfeit: { ios: 'minus.circle', android: 'remove_circle' },
} as const;

/** One points change: what caused it, when, and how many points. Opens the payment's receipt. */
export function PointsHistoryRow({ entry }: { entry: PointsEntry }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const source = entry.transaction;
  const kind = t(`points.entry.${entry.type}`);
  const earned = entry.points > 0;
  const reference = source?.reference ?? source?.id;

  return (
    <Pressable
      accessibilityRole={reference ? 'button' : undefined}
      disabled={!reference}
      onPress={() => reference && router.push({ pathname: '/activity/[id]', params: { id: reference } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.icon}>
        {source ? (
          <ActivityIcon item={source} color={colors.brand} />
        ) : (
          <Icon {...ENTRY_ICONS[entry.type]} color={colors.brand} />
        )}
      </View>
      <View style={styles.copy}>
        <TasaText variant="bodyMedium" numberOfLines={1}>
          {source?.title ?? kind}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
          {source && entry.type === 'earn'
            ? t('points.earnedOn', { amount: formatNaira(source.amount) })
            : kind}
          {' · '}
          {formatRelativeDate(entry.date)}
        </TasaText>
      </View>
      <TasaText variant="bodyMedium" color={earned ? colors.success : colors.ink}>
        {earned ? '+' : ''}
        {entry.points.toLocaleString('en-NG')}
      </TasaText>
      {reference && <Icon ios="chevron.right" android="chevron_right" color={colors.inkSubtle} size={14} />}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pressed: {
      opacity: 0.6,
    },
    icon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
