import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PointsHistoryRow } from '@/components/ui/PointsHistoryRow';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { usePoints, usePointsHistory, useRedeemPoints } from '@/hooks/useOffers';
import { errorMessage } from '@/lib/api/errors';
import { formatNaira } from '@/lib/format';
import { timesKobo } from '@/lib/money';
import { FeaturePaused } from '@/components/ui/FeatureGate';
import { useFeature } from '@/hooks/useAppConfig';

// The rest is on the full history screen.
const HISTORY_PREVIEW = 5;

/** Points earned on bills and transfers, converted to wallet cash. */
export default function PointsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const points = usePoints();
  const history = usePointsHistory();
  const redeem = useRedeemPoints();
  const converting = useFeature('points');
  const [text, setText] = useState('');
  // One key per conversion, kept across retries so a dropped connection can't convert twice.
  const conversionKey = useRef<string | null>(null);

  const summary = points.data;
  const amount = Number(text) || 0;
  const entered = text.length > 0;
  const tooFew = entered && !!summary && amount < summary.minRedeemPoints;
  const tooMany = entered && !!summary && amount > summary.balance;
  const canConvert = converting.enabled && !!summary?.active && entered && !tooFew && !tooMany;

  const convert = () => {
    conversionKey.current ??= Crypto.randomUUID();
    redeem.mutate(
      { points: amount, idempotencyKey: conversionKey.current },
      {
        onSuccess: ({ transaction }) => {
          conversionKey.current = null;
          setText('');
          show(t('points.converted', { amount: formatNaira(transaction.amount) }));
        },
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );
  };

  return (
    <Screen refreshable>
      <QueryState query={points} hasData={!!summary} skeleton="chart" />
      {summary && (
        <>
          <Card style={styles.balance}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('points.balance')}
            </TasaText>
            <TasaText variant="display" color={colors.heading}>
              {summary.balance.toLocaleString('en-NG')}
            </TasaText>
            <TasaText variant="body" color={colors.inkMuted}>
              {t('points.worth', { amount: formatNaira(summary.value) })}
            </TasaText>
          </Card>

          {!summary.active && (
            <TasaText variant="caption" color={colors.danger} style={styles.paused}>
              {t('points.paused')}
            </TasaText>
          )}

          <SectionHeader title={t('points.convert')} />
          <Input
            label={t('points.amount')}
            keyboardType="number-pad"
            placeholder={String(summary.minRedeemPoints)}
            hint={
              canConvert
                ? t('points.youGet', { amount: formatNaira(timesKobo(summary.pointValue, amount)) })
                : t('points.minimum', { points: summary.minRedeemPoints })
            }
            error={tooMany ? t('points.tooMany') : tooFew ? t('points.minimum', { points: summary.minRedeemPoints }) : null}
            value={text}
            onChangeText={(next) => {
              setText(next.replace(/\D/g, '').slice(0, 9));
              // A different amount is a different conversion.
              conversionKey.current = null;
            }}
          />
          {!converting.enabled && <FeaturePaused message={converting.message} />}
          <Button
            label={t('points.convertButton')}
            disabled={!canConvert}
            loading={redeem.isPending}
            onPress={convert}
          />

          <SectionHeader
            title={t('points.history')}
            action={
              history.items.length > 0 && (
                <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.push('/points/history')}>
                  <TasaText variant="bodyMedium" color={colors.brand}>
                    {t('points.seeAll')}
                  </TasaText>
                </Pressable>
              )
            }
          />
          {history.data && history.items.length === 0 && <EmptyState message={t('points.empty')} />}
          {history.items.slice(0, HISTORY_PREVIEW).map((entry) => (
            <PointsHistoryRow key={entry.id} entry={entry} />
          ))}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    balance: {
      gap: 4,
    },
    paused: {
      marginTop: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
