import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { AmountInput, Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { RecurringScheduleFields } from '@/components/ui/RecurringScheduleFields';
import { Screen, TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { useSnackbar } from '@/components/ui/Snackbar';
import { RecurringFrequency, planCopy } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { usePlans } from '@/hooks/usePayments';
import { useRecurringBills, useUpdateRecurring } from '@/hooks/useSaved';
import { toIsoDate } from '@/lib/calendar';
import { formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';
import { errorMessage } from '@/lib/api/errors';

/** Changes a schedule. Its account stays: a different meter or number is a new schedule. */
export default function EditRecurringScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useRecurringBills();
  const bill = query.data?.find((item) => item.id === id);
  const updateRecurring = useUpdateRecurring();

  const [today] = useState(() => toIsoDate(new Date()));
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(kobo(0));
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<RecurringFrequency | null>(null);
  const [nextDate, setNextDate] = useState(today);

  const savedDate = bill?.nextDate.slice(0, 10) ?? today;
  // An overdue schedule shows today: the calendar can't go earlier.
  const currentDate = savedDate < today ? today : savedDate;

  useEffect(() => {
    if (!bill) return;
    setLabel(bill.label);
    setAmount(bill.amount);
    setPlanCode(bill.planCode ?? null);
    setFrequency(bill.frequency);
    setNextDate(currentDate);
    // Only when the screen gets its schedule: later refetches mustn't undo their edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill?.id]);

  const planBased = !!bill?.planCode;
  const plans = usePlans(bill?.serviceId ?? 'electricity', bill?.provider ?? null, planBased);

  if (!bill) {
    return (
      <Screen>
        <QueryState query={query} hasData={!!query.data} skeleton="detail" />
        {query.data && <TasaText variant="title">{t('recurring.notFound')}</TasaText>}
      </Screen>
    );
  }

  const newLabel = label.trim();
  const changes = {
    ...(newLabel !== bill.label && { label: newLabel }),
    ...(!planBased && amount !== bill.amount && { amount }),
    ...(planBased && planCode && planCode !== bill.planCode && { planCode }),
    ...(frequency && frequency !== bill.frequency && { frequency }),
    ...(nextDate !== currentDate && { nextDate }),
  };
  const canSave =
    Object.keys(changes).length > 0 && newLabel.length >= 2 && (planBased || amount > 0);

  // No PIN: changing a schedule pays nothing. The API's reason shows if it refuses the change.
  const save = () =>
    updateRecurring.mutate(
      { id: bill.id, changes },
      {
        onSuccess: () => {
          show(t('recurring.updated'));
          router.back();
        },
        onError: (error) => show(errorMessage(error), { tone: 'error' }),
      },
    );

  return (
    <Screen
      footer={
        <Button
          label={t('recurring.saveChanges')}
          disabled={!canSave}
          loading={updateRecurring.isPending}
          onPress={save}
        />
      }>
      <Card style={styles.summary}>
        <TasaText variant="bodyMedium">
          {t(`services.${bill.serviceId}.name`)} · {bill.provider}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t(`services.${bill.serviceId}.account`)} {bill.accountNumber}
        </TasaText>
        <TasaText variant="caption" color={colors.inkSubtle}>
          {t('recurring.accountLocked')}
        </TasaText>
      </Card>

      {planBased ? (
        plans.data && (
          <SelectField
            title={t(planCopy(bill.serviceId).title)}
            placeholder={t(planCopy(bill.serviceId).placeholder)}
            value={planCode}
            onChange={setPlanCode}
            options={plans.data.map((item) => ({
              value: item.code,
              label: item.name,
              detail: formatNaira(item.amount),
            }))}
          />
        )
      ) : (
        <AmountInput
          label={t('common.amount')}
          style={styles.field}
          value={amount}
          onChangeValue={setAmount}
        />
      )}

      <RecurringScheduleFields
        frequency={frequency}
        onFrequencyChange={setFrequency}
        dateLabel={t('recurring.nextPayment')}
        date={nextDate}
        today={today}
        onDateChange={setNextDate}
      />

      <Input
        label={t('recurring.name')}
        last
        maxLength={40}
        style={styles.field}
        value={label}
        onChangeText={setLabel}
      />

    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    summary: {
      gap: 4,
      marginBottom: theme.spacing.lg,
    },
    field: {
      gap: 8,
      marginBottom: theme.spacing.lg,
    },
  }),
);
