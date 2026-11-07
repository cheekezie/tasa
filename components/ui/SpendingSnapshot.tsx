import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { MiniBars } from '@/components/ui/Actions';
import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useSpending } from '@/hooks/usePayments';
import { formatNaira } from '@/lib/format';
import { spendingMood, spendingTopName } from '@/lib/spendingTips';

/** This month at a glance on Home: what went out, on what, and how it compares by month. */
export function SpendingSnapshot() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { data: report } = useSpending('this_month');
  const mood = report && report.transactions > 0 ? spendingMood(report) : null;
  // The trend covers past months too, so early in a month there's still a picture to show.
  const trend = report?.trend ?? [];
  const hasHistory = trend.some((point) => point.amount > 0);

  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/insights')} style={styles.card}>
      <View style={styles.copy}>
        {report && mood ? (
          <>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('home.spentThisMonth')}
            </TasaText>
            <TasaText variant="title" color={colors.heading} numberOfLines={1}>
              {formatNaira(report.spent)}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
              {t('home.mostlyOn', { name: spendingTopName(mood.key, t) })}
            </TasaText>
          </>
        ) : (
          <>
            <TasaText variant="bodyMedium">{t('home.spendingTitle')}</TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t(hasHistory ? 'home.spendingNoneYet' : 'home.spendingBody')}
            </TasaText>
          </>
        )}
      </View>

      {hasHistory && <MiniBars color={colors.brand} data={trend} />}
      <Icon color={colors.inkMuted} ios="chevron.right" android="chevron_right" size={16} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginTop: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
