import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useCopyToClipboard, useSnackbar } from '@/components/ui/Snackbar';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useIssueWalletAccount, useWallet } from '@/hooks/useAccount';
import { errorMessage } from '@/lib/api/errors';
import { walletService } from '@/lib/api/services/account';
import { formatNaira } from '@/lib/format';
import { invalidateBalances } from '@/lib/queryClient';

const POLL_INTERVAL_MS = 5000;

/** The user's permanent account number: transfer any amount in from any bank app, any time. */
export default function WalletAccountScreenGated() {
  return (
    <FeatureGate feature="funding">
      <WalletAccountScreen />
    </FeatureGate>
  );
}

function WalletAccountScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const copy = useCopyToClipboard();
  const { show } = useSnackbar();
  const wallet = useWallet();
  const issue = useIssueWalletAccount();
  // Money sent here arrives with no reference, so "I've sent it" polls by time instead.
  const [since, setSince] = useState<string | null>(null);
  const credits = useQuery({
    queryKey: ['wallet', 'credits', since],
    queryFn: async () => {
      const items = await walletService.getAccountCredits(since!);
      if (items.length > 0) await invalidateBalances();
      return items;
    },
    enabled: !!since,
    refetchInterval: ({ state }) => (state.data?.length ? false : POLL_INTERVAL_MS),
  });
  const account = wallet.data?.account;
  const received = credits.data?.[0];

  return (
    <Screen refreshable>
      <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
        {t('walletAccount.intro')}
      </TasaText>
      <QueryState query={wallet} hasData={!!wallet.data} skeleton="detail" />

      {wallet.data && !account && (
        <Button
          label={t('walletAccount.get')}
          loading={issue.isPending}
          onPress={() =>
            issue.mutate(undefined, {
              onError: (error) => show(errorMessage(error), { tone: 'error' }),
            })
          }
        />
      )}

      {account && (
        <>
          <Card style={styles.card}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {account.bankName}
            </TasaText>
            <TasaText variant="display" color={colors.heading}>
              {account.accountNumber}
            </TasaText>
            <TasaText variant="body" color={colors.inkMuted}>
              {account.accountName}
            </TasaText>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => copy(account.accountNumber, t('cards.virtualCopied'))}>
              <TasaText variant="bodyMedium" color={colors.brand}>
                {t('common.copy')}
              </TasaText>
            </Pressable>
          </Card>

          {received ? (
            <TasaText variant="bodyMedium" color={colors.success}>
              {t('fundTransfer.successMessage', { amount: formatNaira(received.amount) })}
            </TasaText>
          ) : since ? (
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.brand} size="small" />
              <TasaText variant="body" color={colors.inkMuted}>
                {t('fundTransfer.waiting')}
              </TasaText>
            </View>
          ) : (
            <Button
              label={t('fundTransfer.madePayment')}
              onPress={() => setSince(new Date().toISOString())}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    intro: {
      marginBottom: theme.spacing.lg,
    },
    card: {
      gap: 6,
      marginBottom: theme.spacing.lg,
    },
    waiting: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
  }),
);
