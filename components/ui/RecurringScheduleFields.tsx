import { StyleSheet, View } from 'react-native';

import { CalendarField } from '@/components/ui/CalendarField';
import { TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { RECURRING_FREQUENCIES, RecurringFrequency } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { useTheme } from '@/context/ThemeContext';

type RecurringScheduleFieldsProps = {
  frequency: RecurringFrequency | null;
  onFrequencyChange: (frequency: RecurringFrequency) => void;
  frequencyError?: boolean;
  dateLabel: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Earliest date, today. */
  today: string;
  onDateChange: (date: string) => void;
};

/** How often a recurring payment repeats, and when it next runs. */
export function RecurringScheduleFields({
  frequency,
  onFrequencyChange,
  frequencyError,
  dateLabel,
  date,
  today,
  onDateChange,
}: RecurringScheduleFieldsProps) {
  const { colors } = useTheme();
  const t = useT();

  return (
    <>
      <View style={styles.field}>
        <TasaText variant="label" color={colors.inkMuted}>
          {t('recurring.repeat')}
        </TasaText>
        <SelectField
          title={t('recurring.repeat')}
          placeholder={t('recurring.chooseRepeat')}
          value={frequency}
          onChange={(value) => value && onFrequencyChange(value as RecurringFrequency)}
          options={RECURRING_FREQUENCIES.map((value) => ({
            value,
            label: t(`recurring.every.${value}`),
          }))}
        />
        {frequencyError && (
          <TasaText variant="caption" color={colors.danger}>
            {t('recurring.chooseRepeat')}
          </TasaText>
        )}
      </View>

      <View style={styles.field}>
        <TasaText variant="label" color={colors.inkMuted}>
          {dateLabel}
        </TasaText>
        <CalendarField title={dateLabel} value={date} min={today} onChange={onDateChange} />
        {date === today && (
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('recurring.todayHint')}
          </TasaText>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 8,
    marginBottom: theme.spacing.lg,
  },
});
