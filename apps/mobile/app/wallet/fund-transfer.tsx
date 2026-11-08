import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useCopyToClipboard } from '@/components/ui/Snackbar';
import { ErrorView, SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { Skeleton } from '@/components/ui/Skeleton';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { formatNaira } from '@/lib/format';
import { useAccount } from '@/hooks/useAccount';
import { errorMessage } from '@/lib/api/errors';
import { Funding } from '@/lib/api/mappers';
import { walletService } from '@/lib/api/services/account';
import { paymentsService } from '@/lib/api/services/payments';
import { koboFromParam } from '@/lib/money';
import { invalidateBalances } from '@/lib/queryClient';

const POLL_INTERVAL_MS = 5000;

type Phase = 'creating' | 'awaiting' | 'confirmed' | 'expired' | 'failed';

export default function FundTransferScreenGated() {
  return (
    <FeatureGate feature="funding">
      <FundTransferScreen />
    </FeatureGate>
  );
}

function FundTransferScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { walletBalance } = useAccount();
  const params = useLocalSearchParams<{ amount: string }>();
  const amount = koboFromParam(params.amount);

  const [phase, setPhase] = useState<Phase>('creating');
  const [account, setAccount] = useState<Funding | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Why setting up the transfer failed, when a request failed rather than the transfer itself.
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);

  const createAccount = useCallback(async () => {
    setPhase('creating');
    setNotice(null);
    setFailure(null);
    try {
      const quote = await paymentsService.createQuote({ kind: 'funding', amount });
      setAccount(await walletService.startFunding(quote.id));
      setPhase('awaiting');
    } catch (error) {
      setFailure(errorMessage(error));
      setPhase('failed');
    }
  }, [amount]);

  useEffect(() => {
    createAccount();
  }, [createAccount]);

  const check = useCallback(
    async (manual: boolean) => {
      if (!account || inFlight.current) return;
      inFlight.current = true;
      if (manual) {
        setChecking(true);
        setNotice(null);
      }
      try {
        const { status } = await walletService.getFunding(account.reference);
        if (status === 'success') {
          await invalidateBalances();
          setPhase('confirmed');
        } else if (status === 'expired') {
          setPhase('expired');
        } else if (status === 'failed' || status === 'reversed') {
          setPhase('failed');
        } else if (manual) {
          setNotice(t('fundTransfer.notYet'));
        }
      } catch (error) {
        // Background polls retry on the next tick; only surface failures the user asked for.
        if (manual) setNotice(errorMessage(error));
      } finally {
        inFlight.current = false;
        if (manual) setChecking(false);
      }
    },
    [account, t],
  );

  // Poll only while this screen is focused, and check straight away when the user returns from
  // their banking app.
  useFocusEffect(
    useCallback(() => {
      if (phase !== 'awaiting') return;
      const interval = setInterval(() => check(false), POLL_INTERVAL_MS);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') check(false);
      });
      return () => {
        clearInterval(interval);
        subscription.remove();
      };
    }, [phase, check]),
  );

  useEffect(() => {
    if (phase !== 'awaiting' || !account) return;
    const tick = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= account.expiresAt) setPhase('expired');
    }, 1000);
    return () => clearInterval(tick);
  }, [phase, account]);

  useResultScreen((phase === 'confirmed' && !!account) || phase === 'expired' || phase === 'failed');

  if (phase === 'confirmed' && account) {
    return (
      <>
        <SuccessView
          title={t('fundTransfer.successTitle')}
          message={t('fundTransfer.successMessage', { amount: formatNaira(account.amount) })}
          primaryAction={{ label: t('common.backToHome'), href: '/' }}
          secondaryAction={{ label: t('fundTransfer.viewActivity'), href: '/(tabs)/activity' }}>
          <Card style={styles.receipt}>
            <ReceiptRow label={t('common.amount')} value={formatNaira(account.amount)} />
            <ReceiptRow label={t('fundTransfer.reference')} value={account.reference} />
            <ReceiptRow label={t('fundTransfer.newBalance')} value={formatNaira(walletBalance)} />
          </Card>
        </SuccessView>
      </>
    );
  }

  if (phase === 'expired' || phase === 'failed') {
    const expired = phase === 'expired';
    return (
      <>
        <ErrorView
          title={t(expired ? 'fundTransfer.expiredTitle' : 'fundTransfer.failedTitle')}
          message={expired ? t('fundTransfer.expiredMessage') : (failure ?? t('fundTransfer.failedMessage'))}
          primaryAction={{
            label: expired ? t('fundTransfer.newDetails') : t('common.tryAgain'),
            onPress: createAccount,
          }}
          secondaryAction={{ label: t('common.goBack') }}
        />
      </>
    );
  }

  if (phase === 'creating' || !account) {
    return (
      // The account card's shape while SaySwitch issues the number.
      <View style={styles.skeleton}>
        <TasaText variant="body" color={colors.inkMuted}>
          {t('fundTransfer.generating')}
        </TasaText>
        <Card style={styles.skeletonCard}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="75%" height={30} radius={8} />
          <Skeleton width="55%" height={14} />
        </Card>
        <Skeleton height={64} radius={theme.radius.lg} />
      </View>
    );
  }

  const secondsLeft = Math.max(0, Math.floor((account.expiresAt - now) / 1000));
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <Screen
      footer={
        <Button
          label={t('fundTransfer.madePayment')}
          loading={checking}
          onPress={() => check(true)}
        />
      }>
      <TasaText variant="body" color={colors.inkMuted}>
        {t('fundTransfer.intro')}
      </TasaText>

      <Card style={styles.amountCard}>
        <TasaText variant="label" color={colors.inkMuted}>
          {t('fundTransfer.transferExactly')}
        </TasaText>
        <CopyRow
          value={String(account.total)}
          display={formatNaira(account.total)}
          label={t('common.amount')}
          large
        />
      </Card>

      <Card style={styles.details}>
        <DetailRow label={t('fundTransfer.bank')} value={account.bankName} />
        <View style={styles.divider} />
        <View>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('fundTransfer.accountNumber')}
          </TasaText>
          <CopyRow
            value={account.accountNumber}
            display={account.accountNumber}
            label={t('fundTransfer.accountNumber')}
          />
        </View>
        <View style={styles.divider} />
        <DetailRow label={t('fundTransfer.accountName')} value={account.accountName} />
      </Card>

      <View style={styles.status}>
        <ActivityIndicator color={colors.brand} size="small" />
        <View style={styles.statusCopy}>
          <TasaText variant="bodyMedium">{t('fundTransfer.waiting')}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('fundTransfer.autoCheck', { time: countdown })}
          </TasaText>
        </View>
      </View>

      {notice && (
        <View style={styles.notice}>
          <TasaText variant="caption" color={colors.ink}>
            {notice}
          </TasaText>
        </View>
      )}
    </Screen>
  );
}

function CopyRow({
  value,
  display,
  label,
  large,
}: {
  value: string;
  display: string;
  label: string;
  large?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const copy = useCopyToClipboard();
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <View style={styles.copyRow}>
      <TasaText variant={large ? 'display' : 'subtitle'} color={large ? colors.heading : colors.ink}>
        {display}
      </TasaText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('common.copy')} ${display}`}
        hitSlop={8}
        onPress={async () => {
          await copy(value, t('fundTransfer.copied', { label }));
          setCopied(true);
        }}
        style={styles.copyButton}>
        <Icon
          color={colors.brand}
          ios={copied ? 'checkmark' : 'doc.on.doc'}
          android={copied ? 'check' : 'content_copy'}
          size={16}
        />
        <TasaText variant="caption" color={colors.brand}>
          {copied ? t('common.copied') : t('common.copy')}
        </TasaText>
      </Pressable>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="subtitle">{value}</TasaText>
    </View>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.receiptRow}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium">{value}</TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    skeleton: {
      flex: 1,
      gap: theme.spacing.md,
      padding: theme.spacing.screen,
      backgroundColor: colors.surface,
    },
    skeletonCard: {
      gap: theme.spacing.sm,
    },
    amountCard: {
      marginTop: theme.spacing.lg,
      gap: 4,
    },
    details: {
      marginTop: theme.spacing.md,
      gap: 12,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    copyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    copyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: colors.overlay,
    },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: theme.spacing.lg,
    },
    statusCopy: {
      flex: 1,
      gap: 2,
    },
    notice: {
      marginTop: theme.spacing.md,
      padding: 12,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      backgroundColor: colors.warmSoft,
      borderColor: colors.warmSoftBorder,
    },
    receipt: {
      gap: 10,
    },
    receiptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
  }),
);
