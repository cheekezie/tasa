import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { PinSheet } from '@/components/ui/PinSheet';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount } from '@/hooks/useAccount';
import { errorMessage, hasCode } from '@/lib/api/errors';
import { accountService } from '@/lib/api/services/account';
import { formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';

// Things to sort out first, not PIN problems, so they belong on this screen rather than the sheet.
const BLOCKERS = [
  'ACCOUNT_HAS_BALANCE',
  'ACCOUNT_BALANCE_CHANGED',
  'ACCOUNT_HAS_PENDING',
  'ACCOUNT_HAS_COUPONS',
];

/** Under ₦100 a balance can't be transferred out, so closing the account gives it up. */
const MIN_TRANSFER = kobo(10_000);

const POINTS = [
  'deleteAccount.pointData',
  'deleteAccount.pointPayments',
  'deleteAccount.pointPoints',
  'deleteAccount.pointRecords',
  'deleteAccount.pointReturn',
] as const;

/** Closes the account for good. Apple requires this to be reachable inside the app. */
export default function DeleteAccountScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { forgetAccount } = useApp();
  const { walletBalance, balanceKnown, query } = useAccount();
  const [pinOpen, setPinOpen] = useState(false);
  const [blocker, setBlocker] = useState<string | null>(null);
  const hasBalance = balanceKnown && walletBalance >= MIN_TRANSFER;
  const forfeit = balanceKnown && !hasBalance ? walletBalance : kobo(0);

  const confirm = async (pin: string) => {
    try {
      await accountService.closeAccount(pin, forfeit);
    } catch (error) {
      if (!hasCode(error, ...BLOCKERS)) throw error;
      setPinOpen(false);
      setBlocker(errorMessage(error));
      query.refetch();
      return;
    }
    setPinOpen(false);
    await forgetAccount();
    show(t('deleteAccount.done'));
    if (router.canDismiss()) router.dismissAll();
    router.replace('/sign-in');
  };

  return (
    <Screen
      footer={
        <Button
          label={t('deleteAccount.submit')}
          variant="danger"
          disabled={!balanceKnown || hasBalance}
          onPress={() => {
            setBlocker(null);
            setPinOpen(true);
          }}
        />
      }>
      <TasaText variant="display" color={colors.heading}>
        {t('deleteAccount.title')}
      </TasaText>
      <TasaText color={colors.inkMuted} style={styles.intro}>
        {t('deleteAccount.intro')}
      </TasaText>

      <Card style={styles.points}>
        {POINTS.map((point) => (
          <TasaText key={point} variant="body">
            {t(point)}
          </TasaText>
        ))}
      </Card>

      {hasBalance && (
        <View style={styles.notice}>
          <TasaText variant="bodyMedium">
            {t('deleteAccount.balance', { amount: formatNaira(walletBalance) })}
          </TasaText>
          <Button
            label={t('deleteAccount.moveMoney')}
            variant="secondary"
            onPress={() => router.push('/wallet/transfer')}
          />
        </View>
      )}
      {forfeit > 0 && (
        <View style={styles.notice}>
          <TasaText variant="bodyMedium">
            {t('deleteAccount.forfeit', { amount: formatNaira(forfeit) })}
          </TasaText>
        </View>
      )}
      {!!blocker && (
        <View style={styles.notice}>
          <TasaText variant="bodyMedium">{blocker}</TasaText>
        </View>
      )}

      <PinSheet
        visible={pinOpen}
        title={t('deleteAccount.pinTitle')}
        processingTitle={t('processing.deleting')}
        detail={
          forfeit > 0
            ? t('deleteAccount.pinForfeit', { amount: formatNaira(forfeit) })
            : t('deleteAccount.pinDetail')
        }
        onSubmit={confirm}
        onClose={() => setPinOpen(false)}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    intro: {
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.lg,
    },
    points: {
      gap: theme.spacing.sm,
    },
    notice: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.dangerSoftBorder,
      backgroundColor: colors.dangerSoft,
    },
  }),
);
