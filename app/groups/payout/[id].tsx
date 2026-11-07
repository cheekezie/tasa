import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PinSheet } from '@/components/ui/PinSheet';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useGroup, useProposePayoutChange } from '@/hooks/useGroups';
import { useBanks, useVerifiedBankAccount } from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';

/** Matches the API. */
const MIN_COSIGNERS = 2;

/**
 * The owner proposes a new payout account. Nothing changes until every co-signer they pick
 * approves with their PIN and the cooling-off passes with no executive objecting.
 */
export default function ChangePayoutScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useGroup(id);
  const group = query.data;
  const banks = useBanks();
  const propose = useProposePayoutChange(id);
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const verified = useVerifiedBankAccount(bankCode, accountNumber);
  const [cosigners, setCosigners] = useState<string[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const executives = group?.executives.filter((e) => e.role === 'executive') ?? [];
  const ready = !!verified.data && !verified.isFetching && cosigners.length >= MIN_COSIGNERS;
  const toggle = (userId: string) =>
    setCosigners((current) => (current.includes(userId) ? current.filter((c) => c !== userId) : [...current, userId]));

  return (
    <Screen footer={group ? <Button disabled={!ready} label={t('groups.sendForApproval')} onPress={() => setPinOpen(true)} /> : undefined}>
      <QueryState query={query} hasData={!!group} skeleton="detail" />
      {group && (
        <>
          <Card style={styles.current}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('groups.currentAccount')}
            </TasaText>
            <TasaText variant="bodyMedium">{group.payout?.accountName}</TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {group.payout?.bankName} · {group.payout?.accountNumber}
            </TasaText>
          </Card>
          <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
            {t('groups.changeRules')}
          </TasaText>

          <SectionHeader title={t('groups.newAccount')} />
          <SelectField
            title={t('tickets.bankName')}
            placeholder={t('tickets.chooseBank')}
            value={bankCode}
            onChange={setBankCode}
            options={(banks.data ?? []).map((bank) => ({ value: bank.code, label: bank.name }))}
          />
          <Input
            label={t('tickets.accountNumber')}
            keyboardType="number-pad"
            maxLength={10}
            last
            error={verified.isError ? errorMessage(verified.error) : null}
            value={accountNumber}
            onChangeText={(text) => setAccountNumber(text.replace(/\D/g, ''))}
          />
          {verified.isFetching && <ActivityIndicator color={colors.brand} />}
          {verified.data && !verified.isFetching && (
            <TasaText variant="bodyMedium" color={colors.success}>
              {verified.data.accountName}
            </TasaText>
          )}

          <SectionHeader title={t('groups.cosigners')} />
          <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
            {executives.length < MIN_COSIGNERS
              ? t('groups.needExecutives', { count: MIN_COSIGNERS })
              : t('groups.cosignersHint', { count: MIN_COSIGNERS })}
          </TasaText>
          {executives.map((e) => {
            const on = cosigners.includes(e.id);
            return (
              <Pressable
                key={e.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(e.id)}
                style={[styles.person, on && styles.personOn]}>
                <Icon
                  ios={on ? 'checkmark.square.fill' : 'square'}
                  android={on ? 'check_box' : 'check_box_outline_blank'}
                  color={on ? colors.brand : colors.inkMuted}
                  size={20}
                />
                <View style={styles.flex}>
                  <TasaText variant="bodyMedium">{e.name ?? `@${e.username}`}</TasaText>
                  {!!e.username && (
                    <TasaText variant="caption" color={colors.inkMuted}>
                      @{e.username}
                    </TasaText>
                  )}
                </View>
              </Pressable>
            );
          })}

          <PinSheet
            visible={pinOpen}
            title={t('groups.confirmProposal')}
            processingTitle={t('groups.sending')}
            detail={verified.data ? `${verified.data.accountName} · ${accountNumber}` : undefined}
            onClose={() => setPinOpen(false)}
            onSubmit={async (pin) => {
              await propose.mutateAsync({ bankCode: bankCode!, accountNumber, cosigners, pin });
              setPinOpen(false);
              show(t('groups.proposalSent'));
              router.back();
            }}
          />
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    current: {
      gap: 2,
    },
    hint: {
      marginVertical: theme.spacing.sm,
    },
    person: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    personOn: {
      borderColor: colors.brand,
    },
    flex: {
      flex: 1,
    },
  }),
);
