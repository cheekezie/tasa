import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useSnackbar } from '@/components/ui/Snackbar';
import { ReminderBanner } from '@/components/ui/FeatureCards';
import { EmptyState, Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { Icon, ServiceIcon } from '@/components/ui/Icon';
import { getServiceById } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { useAccount } from '@/hooks/useAccount';
import { useRecurringBills, useRemoveRecurring } from '@/hooks/useSaved';
import { errorMessage } from '@/lib/api/errors';
import { formatNaira, formatRelativeDateInline } from '@/lib/format';
import { kobo, maxKobo, subtractKobo } from '@/lib/money';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function RecurringScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { walletBalance, balanceKnown } = useAccount();
  const query = useRecurringBills();
  const recurringBills = (query.data ?? []).filter((bill) => bill.active);
  const removeRecurring = useRemoveRecurring();
  const { show } = useSnackbar();
  const t = useT();

  return (
    <Screen
      refreshable
      footer={<Button label={t('recurring.add')} onPress={() => router.push('/recurring/setup')} />}>
      <TasaText variant="body" color={colors.inkMuted}>
        {t('recurring.intro')}
      </TasaText>

      <SectionHeader title={t('recurring.active')} />
      <QueryState query={query} hasData={!!query.data} />
      {query.data && recurringBills.length === 0 && <EmptyState message={t('recurring.empty')} />}
      {recurringBills.map((bill) => {
        const service = getServiceById(bill.serviceId);
        const shortfall = balanceKnown ? maxKobo(subtractKobo(bill.amount, walletBalance), kobo(0)) : kobo(0);

        return (
          <View key={bill.id} style={styles.block}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t('recurring.editHint')}
              onPress={() => router.push({ pathname: '/recurring/[id]', params: { id: bill.id } })}
              style={styles.row}>
              <View style={styles.icon}>
                <ServiceIcon serviceId={service.id} />
              </View>
              <View style={styles.copy}>
                <TasaText variant="bodyMedium" numberOfLines={1}>{bill.label}</TasaText>
                {bill.accountNumber && (
                  <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
                    {bill.provider ? `${bill.provider} · ` : ''}
                    {t(`services.${bill.serviceId}.account`)} {bill.accountNumber}
                  </TasaText>
                )}
                <TasaText variant="caption" color={colors.inkMuted}>
                  {t('recurring.line', {
                    amount: formatNaira(bill.amount),
                    frequency: t(`home.${bill.frequency}`),
                    date: formatRelativeDateInline(bill.nextDate),
                  })}
                </TasaText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('recurring.remove')}
                disabled={removeRecurring.isPending}
                hitSlop={10}
                onPress={() =>
                  removeRecurring.mutate(bill.id, {
                    onSuccess: () => show(t('recurring.removed')),
                    onError: (error) => show(errorMessage(error), { tone: 'error' }),
                  })
                }>
                <Icon color={colors.danger} ios="trash" android="delete" size={20} />
              </Pressable>
            </Pressable>
            {shortfall > 0 && (
              <ReminderBanner
                amount={bill.amount}
                dueDate={bill.nextDate}
                shortfall={shortfall}
                title={t('cards.topUpBefore', { label: bill.label })}
              />
            )}
          </View>
        );
      })}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: {
      marginBottom: theme.spacing.lg,
      gap: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
