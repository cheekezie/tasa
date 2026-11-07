import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SpendingChart } from '@/components/ui/Actions';
import { Card } from '@/components/ui/Button';
import { ConfettiBurst } from '@/components/ui/ConfettiBurst';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { ServiceId, getServiceColor } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { SPENDING_PERIODS, SpendingPeriod, useSpending } from '@/hooks/usePayments';
import { formatDate, formatNaira } from '@/lib/format';
import { Kobo } from '@/lib/money';
import { spendingMood, spendingTips } from '@/lib/spendingTips';

/** Real spending, so people can see what costs them most and plan around it. */
export default function InsightsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [period, setPeriod] = useState<SpendingPeriod>('this_month');
  const query = useSpending(period);
  const report = query.data;
  const empty = !!report && report.transactions === 0;
  const mood = report && !empty ? spendingMood(report) : null;
  // Tapping the banner throws the confetti again.
  const [bursts, setBursts] = useState(0);

  return (
    <View style={styles.root}>
      <Screen refreshable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periods}>
          {SPENDING_PERIODS.map((value) => {
            const selected = value === period;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setPeriod(value)}
                style={[styles.period, selected && styles.periodActive]}
              >
                <TasaText variant="caption" color={selected ? '#FFFFFF' : colors.brand}>
                  {t(`insights.period.${value}`)}
                </TasaText>
              </Pressable>
            );
          })}
        </ScrollView>

        <QueryState query={query} hasData={!!report} skeleton="chart" />

        {report && (
          <>
            <Card style={styles.hero}>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('insights.totalSpent')}
              </TasaText>
              <TasaText variant="display" color={colors.heading}>
                {formatNaira(report.spent)}
              </TasaText>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('insights.transactions', { count: report.transactions })}
              </TasaText>
            </Card>

            {mood && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setBursts((count) => count + 1)}
                style={styles.mood}
              >
                <LinearGradient
                  colors={mood.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.moodFill}
                >
                  <View style={styles.moodCopy}>
                    <TasaText variant="title" color="#FFFFFF">
                      {t(`insights.mood.${mood.key}.title`)}
                    </TasaText>
                    <TasaText variant="body" color="rgba(255,255,255,0.9)">
                      {t(`insights.mood.${mood.key}.body`, { amount: formatNaira(mood.amount) })}
                    </TasaText>
                  </View>
                  <Text style={styles.moodSymbol}>{mood.symbol}</Text>
                </LinearGradient>
              </Pressable>
            )}

            {empty ? (
              <EmptyState message={t('insights.empty')} />
            ) : (
              <>
                <SectionHeader title={t('insights.whatStoodOut')} />
                <View style={styles.tips}>
                  {spendingTips(report, t).map((tip) => (
                    <View key={tip} style={styles.tip}>
                      <View style={styles.tipDot} />
                      <TasaText variant="body" style={styles.tipText}>
                        {tip}
                      </TasaText>
                    </View>
                  ))}
                </View>

                <SectionHeader title={t('insights.whereItWent')} />
                {report.byCategory.map((item) => (
                  <ShareRow
                    key={item.key}
                    label={t(`insights.category.${item.key}`)}
                    amount={item.amount}
                    share={item.share}
                    color={colors.brand}
                  />
                ))}

                {report.byService.length > 0 && (
                  <>
                    <SectionHeader title={t('insights.bills')} />
                    {report.byService.map((item) => (
                      <ShareRow
                        key={item.key}
                        label={t(`services.${item.key as ServiceId}.name`)}
                        amount={item.amount}
                        share={item.share}
                        color={getServiceColor(item.key as ServiceId)}
                      />
                    ))}
                  </>
                )}

                {report.biggest && (
                  <>
                    <SectionHeader title={t('insights.biggest')} />
                    <Card style={styles.biggest}>
                      <TasaText variant="title" color={colors.heading}>
                        {formatNaira(report.biggest.amount)}
                      </TasaText>
                      <TasaText variant="caption" color={colors.inkMuted}>
                        {[
                          report.biggest.serviceId
                            ? t(`services.${report.biggest.serviceId}.name`)
                            : t(`insights.kind.${report.biggest.kind}`),
                          report.biggest.provider,
                          formatDate(report.biggest.date),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </TasaText>
                    </Card>
                  </>
                )}
              </>
            )}

            {(report.received.gifts > 0 || report.received.coupons > 0) && (
            <>
              <SectionHeader title={t('insights.received')} />
              <Card style={styles.received}>
                {report.received.gifts > 0 && (
                  <ReceivedRow label={t('insights.category.gifts')} amount={report.received.gifts} />
                )}
                {report.received.coupons > 0 && (
                  <ReceivedRow label={t('insights.category.coupons')} amount={report.received.coupons} />
                )}
              </Card>
            </>
          )}

          {report.points.earned > 0 && (
            <>
              <SectionHeader title={t('insights.pointsEarned')} />
              <Pressable accessibilityRole="button" onPress={() => router.push('/points')}>
                <Card style={styles.received}>
                  <ReceivedRow
                    label={t('insights.points', { count: report.points.earned })}
                    amount={report.points.value}
                  />
                  <TasaText variant="caption" color={colors.inkMuted}>
                    {t('insights.pointsHint', { amount: formatNaira(report.points.value) })}
                  </TasaText>
                </Card>
              </Pressable>
            </>
          )}

          <SectionHeader title={t('insights.trend')} />
            <Card>
              <SpendingChart color={colors.brand} data={report.trend} />
            </Card>
          </>
        )}
      </Screen>
      {mood && (
        <ConfettiBurst
          key={`${period}-${mood.key}-${bursts}`}
          colors={mood.confetti}
          symbol={mood.symbol}
          fade
          pace={1.5}
        />
      )}
    </View>
  );
}

function ReceivedRow({ label, amount }: { label: string; amount: Kobo }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.shareHeader}>
      <TasaText variant="bodyMedium" style={styles.shareLabel}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" color={colors.success}>
        {formatNaira(amount)}
      </TasaText>
    </View>
  );
}

function ShareRow({
  label,
  amount,
  share,
  color,
}: {
  label: string;
  amount: Kobo;
  share: number;
  color: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.share}>
      <View style={styles.shareHeader}>
        <TasaText variant="bodyMedium" numberOfLines={1} style={styles.shareLabel}>
          {label}
        </TasaText>
        <TasaText variant="bodyMedium">{formatNaira(amount)}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted} style={styles.sharePercent}>
          {Math.round(share * 100)}%
        </TasaText>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    mood: {
      marginTop: theme.spacing.md,
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
    },
    moodFill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.md,
    },
    moodCopy: {
      flex: 1,
      gap: 4,
    },
    moodSymbol: {
      fontSize: 36,
    },
    periods: {
      flexGrow: 0,
      marginBottom: theme.spacing.md,
    },
    period: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginRight: 8,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    periodActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    hero: {
      gap: 4,
    },
    tips: {
      gap: theme.spacing.sm,
    },
    tip: {
      flexDirection: 'row',
      gap: 10,
    },
    tipDot: {
      width: 6,
      height: 6,
      marginTop: 8,
      borderRadius: 3,
      backgroundColor: colors.brand,
    },
    tipText: {
      flex: 1,
    },
    share: {
      gap: 6,
      marginBottom: theme.spacing.md,
    },
    shareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    shareLabel: {
      flex: 1,
    },
    sharePercent: {
      minWidth: 34,
      textAlign: 'right',
    },
    track: {
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: colors.track,
    },
    fill: {
      height: '100%',
    },
    biggest: {
      gap: 4,
    },
    received: {
      gap: theme.spacing.sm,
    },
  }),
);
