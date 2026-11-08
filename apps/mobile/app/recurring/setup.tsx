import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { AmountInput, Input } from '@/components/ui/Input';
import { ProviderPicker } from '@/components/ui/ProviderPicker';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { Icon, ServiceIcon } from '@/components/ui/Icon';
import { RecurringScheduleFields } from '@/components/ui/RecurringScheduleFields';
import { SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useSnackbar } from '@/components/ui/Snackbar';
import {
  RecurringBill,
  RecurringFrequency,
  ServiceId,
  utilityServices,
} from '@/constants/data';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { useNetworkDetection } from '@/hooks/useNetworkDetection';
import { useBillServices } from '@/hooks/usePayments';
import { useBeneficiaries, useCreateRecurring } from '@/hooks/useSaved';
import { toIsoDate } from '@/lib/calendar';
import { formatDate, formatNaira } from '@/lib/format';
import { kobo, koboFromParam } from '@/lib/money';
import { accountRule, checkAccountNumber } from '@/lib/validation';
import { errorMessage } from '@/lib/api/errors';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function SetupRecurringScreenGated() {
  return (
    <FeatureGate feature="recurring">
      <SetupRecurringScreen />
    </FeatureGate>
  );
}

function SetupRecurringScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { data: beneficiaries = [] } = useBeneficiaries();
  const { data: services } = useBillServices();
  const createRecurring = useCreateRecurring();
  const t = useT();
  const { show } = useSnackbar();
  // Prefilled when arriving from a bill payment.
  const params = useLocalSearchParams<{
    service?: ServiceId;
    provider?: string;
    account?: string;
    amount?: string;
    planCode?: string;
    product?: 'airtime' | 'data';
    meterType?: 'prepaid' | 'postpaid';
    beneficiaryId?: string;
    /** Set after paying a bill: it's already chosen, so only the schedule is asked for. */
    fromBill?: string;
  }>();

  const [serviceId, setServiceId] = useState<ServiceId>(params.service ?? 'electricity');
  const [provider, setProvider] = useState<string | null>(params.provider || null);
  const [account, setAccount] = useState(params.account ?? '');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(koboFromParam(params.amount));
  const [beneficiaryId, setBeneficiaryId] = useState<string | null>(params.beneficiaryId || null);
  const [accountTouched, setAccountTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [editingAmount, setEditingAmount] = useState(false);
  const [saved, setSaved] = useState<RecurringBill | null>(null);
  // No default: how often money leaves their wallet is theirs to choose.
  const [frequency, setFrequency] = useState<RecurringFrequency | null>(null);
  const [today] = useState(() => toIsoDate(new Date()));
  const [firstPayment, setFirstPayment] = useState(today);

  const providers = services?.find((item) => item.id === serviceId)?.providers ?? [];
  const selectProvider = useCallback((code: string) => {
    setProvider(code);
    setBeneficiaryId(null);
  }, []);
  const network = useNetworkDetection(serviceId, providers, selectProvider);
  const accountLabel = t(`services.${serviceId}.account`);
  const serviceName = t(`services.${serviceId}.name`);
  const rule = accountRule(serviceId);
  const accountCheck = checkAccountNumber(serviceId, account);
  const matchingBeneficiaries = beneficiaries.filter((item) => item.serviceId === serviceId);

  const accountComplete = !!rule.limit && accountCheck.value.length >= 11;
  const showAccountError = (accountTouched || submitted || accountComplete) && !!accountCheck.error;
  const showProviderError = submitted && !provider;
  const minAmount = providers.find((item) => item.code === provider)?.minAmount ?? kobo(0);
  const belowMinimum = !params.planCode && amount > 0 && amount < minAmount;
  const showAmountError = submitted && amount <= 0;
  const amountError = belowMinimum
    ? t('bill.minAmount', { amount: formatNaira(minAmount) })
    : showAmountError
      ? t('recurring.enterAmount')
      : null;
  const showFrequencyError = submitted && !frequency;
  const defaultLabel = provider ? `${provider} ${serviceName.toLowerCase()}` : serviceName;


  const selectService = (id: ServiceId) => {
    if (id === serviceId) return;
    setServiceId(id);
    setProvider(null);
    setAccount('');
    setBeneficiaryId(null);
    setAccountTouched(false);
    network.reset();
  };

  // No PIN: nothing is paid now. Each run is a payment, checked when it happens.
  const save = () => {
    setSubmitted(true);
    if (!provider || accountCheck.error || amount <= 0 || belowMinimum || !frequency) return;
    createRecurring.mutate(
      {
      serviceId,
      provider: provider!,
      account: accountCheck.value,
      label: label.trim() || defaultLabel,
      amount,
      frequency: frequency!,
      startDate: firstPayment,
      beneficiaryId: beneficiaryId ?? undefined,
      planCode: params.planCode || undefined,
      product: params.product,
      meterType: params.meterType,
      },
      {
        onSuccess: setSaved,
        // e.g. a schedule for this account already exists: the API says so.
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );
  };

  useResultScreen(!!saved);

  if (saved) {
    return (
      <SuccessView
        title={t('recurring.savedTitle')}
        message={t('recurring.savedMessage')}
        primaryAction={{ label: t('recurring.viewAll'), href: '/recurring' }}
        secondaryAction={{ label: t('common.done') }}>
        <Card style={styles.receipt}>
          <Row label={t('recurring.receiptName')} value={saved.label} />
          <Row label={t('recurring.receiptService')} value={`${serviceName} · ${saved.provider}`} />
          <Row label={accountLabel} value={saved.accountNumber ?? ''} />
          <Row
            label={t('common.amount')}
            value={t('recurring.amountEvery', {
              amount: formatNaira(saved.amount),
              frequency: t(`home.${saved.frequency}`),
            })}
          />
          <Row label={t('recurring.receiptFirst')} value={formatDate(saved.nextDate)} />
        </Card>
      </SuccessView>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label={
            amount > 0
              ? t('recurring.schedule', { amount: formatNaira(amount) })
              : t('recurring.scheduleEmpty')
          }
          loading={createRecurring.isPending}
          onPress={save}
        />
      }>
      {params.fromBill ? (
        <>
          <SectionHeader title={t('recurring.thisBill')} />
          <View style={styles.field}>
            <Card style={styles.receipt}>
              <Row label={t('recurring.receiptService')} value={`${serviceName} · ${provider}`} />
              <Row label={accountLabel} value={accountCheck.value} />
              {!editingAmount && (
                <View style={styles.receiptRow}>
                  <TasaText variant="caption" color={colors.inkMuted}>
                    {t('common.amount')}
                  </TasaText>
                  <View style={styles.amountValue}>
                    <TasaText variant="bodyMedium">{formatNaira(amount)}</TasaText>
                    {/* A plan's price is the plan's, so only open amounts can change. */}
                    {!params.planCode && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('recurring.editAmount')}
                        hitSlop={10}
                        onPress={() => setEditingAmount(true)}>
                        <Icon color={colors.brand} ios="square.and.pencil" android="edit_note" size={22} />
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
            </Card>
          </View>
          {editingAmount && (
            <AmountInput
              label={t('common.amount')}
              error={amountError}
              style={styles.field}
              value={amount}
              onChangeValue={setAmount}
            />
          )}
        </>
      ) : (
        <>
            <SectionHeader title={t('recurring.chooseService')} />
            <View style={styles.grid}>
              {utilityServices.map((item) => {
                const selected = serviceId === item.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => selectService(item.id)}
                    style={[styles.serviceChip, selected && styles.chipActive]}>
                    <ServiceIcon serviceId={item.id} color={selected ? '#FFFFFF' : undefined} />
                    <TasaText variant="caption" color={selected ? '#FFFFFF' : colors.ink}>
                      {t(`services.${item.id}.name`)}
                    </TasaText>
                  </Pressable>
                );
              })}
            </View>

            {matchingBeneficiaries.length > 0 && (
              <View style={styles.field}>
                <TasaText variant="label" color={colors.inkMuted}>
                  {t('recurring.useBeneficiary')}
                </TasaText>
                <View style={styles.row}>
                  {matchingBeneficiaries.map((beneficiary) => {
                    const selected = beneficiaryId === beneficiary.id;
                    return (
                      <Pressable
                        key={beneficiary.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          if (selected) {
                            setBeneficiaryId(null);
                            return;
                          }
                          setBeneficiaryId(beneficiary.id);
                          setProvider(beneficiary.provider);
                          setAccount(beneficiary.accountNumber);
                          network.reset();
                          if (!label) setLabel(beneficiary.label);
                        }}
                        style={[styles.pill, selected && styles.chipActive]}>
                        <TasaText variant="caption" color={selected ? '#FFFFFF' : colors.ink} numberOfLines={1}>
                          {beneficiary.label}
                        </TasaText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.field}>
              <TasaText variant="label" color={colors.inkMuted}>
                {t('recurring.provider')}
              </TasaText>
              <ProviderPicker
                label={t('recurring.provider')}
                providers={providers}
                value={provider}
                onChange={(code) => {
                  selectProvider(code);
                  network.onManualPick();
                }}
              />
              {showProviderError && <FieldError message={t('recurring.chooseProvider')} />}
            </View>

            <Input
              label={accountLabel}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType={rule.keyboardType}
              placeholder={rule.placeholder}
              error={showAccountError ? accountCheck.error : null}
              hint={
                network.detectedName
                  ? t('bill.networkDetected', { network: network.detectedName })
                  : undefined
              }
              style={styles.field}
              value={account}
              onBlur={() => setAccountTouched(true)}
              onChangeText={(text) => {
                setAccount(rule.limit?.(text) ?? text);
                setBeneficiaryId(null);
                network.onType(text);
              }}
            />

            <AmountInput
              label={t('common.amount')}
              error={amountError}
              style={styles.field}
              value={amount}
              onChangeValue={setAmount}
            />
        </>
      )}

      <RecurringScheduleFields
        frequency={frequency}
        onFrequencyChange={setFrequency}
        frequencyError={showFrequencyError}
        dateLabel={t('recurring.receiptFirst')}
        date={firstPayment}
        today={today}
        onDateChange={setFirstPayment}
      />

      <Input
        label={t('recurring.name')}
        last
        placeholder={defaultLabel}
        style={styles.field}
        value={label}
        onChangeText={setLabel}
      />

    </Screen>
  );
}

function FieldError({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <TasaText variant="caption" color={colors.danger}>
      {message}
    </TasaText>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.receiptRow}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" style={styles.receiptValue}>
        {value}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: theme.spacing.lg,
    },
    serviceChip: {
      width: '31%',
      minHeight: 72,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      backgroundColor: colors.surfaceElevated,
    },
    chipActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    pill: {
      paddingHorizontal: 14,
      maxWidth: 200,
      paddingVertical: 10,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    field: {
      gap: 8,
      marginBottom: theme.spacing.lg,
    },
    receipt: {
      gap: 10,
    },
    amountValue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    receiptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    receiptValue: {
      flexShrink: 1,
      textAlign: 'right',
    },
  }),
);
