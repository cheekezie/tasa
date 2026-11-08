import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { SpendingChart } from '@/components/ui/Actions';
import { Card } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, TasaText } from '@/components/ui/Screen';
import { ServiceIcon } from '@/components/ui/Icon';
import { ServiceId, getServiceById, getServiceColor } from '@/constants/data';
import { fontSize, theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { useInsights } from '@/hooks/usePayments';
import { formatNaira } from '@/lib/format';
import { kobo, roundToNaira } from '@/lib/money';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function BillInsightScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { service } = useLocalSearchParams<{ service: ServiceId }>();
  const query = useInsights(service);
  const t = useT();
  const billService = useMemo(() => getServiceById(service), [service]);
  const color = getServiceColor(service);
  const insight = query.data?.series ?? [];
  const total = query.data?.total ?? kobo(0);
  const average = query.data?.average ?? kobo(0);
  const highest = insight.reduce((max, point) => (point.amount > max.amount ? point : max), {
    month: '',
    amount: kobo(0),
  });

  return (
    <Screen refreshable>
      <View style={[styles.hero, { backgroundColor: `${color}18` }]}>
        <ServiceIcon serviceId={billService.id} size={fontSize(32)} style={styles.heroIcon} />
        <TasaText variant="title">
          {t('insight.title', { service: t(`services.${service}.name`) })}
        </TasaText>
        <TasaText variant="body" color={colors.inkMuted}>
          {t('insight.body')}
        </TasaText>
      </View>

      <QueryState query={query} hasData={!!query.data} skeleton="chart" />

      <View style={styles.statsRow}>
        <Card style={styles.stat}>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('insight.total6')}
          </TasaText>
          <TasaText variant="title" color={color}>
            {formatNaira(total)}
          </TasaText>
        </Card>
        <Card style={styles.stat}>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('insight.average')}
          </TasaText>
          <TasaText variant="title" color={color}>
            {formatNaira(roundToNaira(average))}
          </TasaText>
        </Card>
      </View>

      <Card style={styles.chartCard}>
        <TasaText variant="bodyMedium">{t('insight.trend')}</TasaText>
        <SpendingChart color={color} data={insight} />
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('insight.peak', { month: highest.month, amount: formatNaira(highest.amount) })}
        </TasaText>
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hero: {
      borderRadius: theme.radius.xl,
      padding: theme.spacing.lg,
      gap: 6,
      marginBottom: theme.spacing.lg,
    },
    heroIcon: {
      marginBottom: theme.spacing.sm,
    },
    statsRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: theme.spacing.md,
    },
    stat: {
      flex: 1,
      gap: 6,
    },
    chartCard: {
      gap: 12,
    },
  }),
);
