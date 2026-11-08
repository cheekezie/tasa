import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { CalendarField } from '@/components/ui/CalendarField';
import { AmountInput, Input } from '@/components/ui/Input';
import { TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { DueInput, GroupPeriod } from '@/lib/api/types';
import { toIsoDate } from '@/lib/calendar';
import { Kobo, kobo } from '@/lib/money';

/** Matches the API. */
export const DUES_MIN = 10_000;

export type DueForm = { name: string; kind: DueInput['kind']; period: GroupPeriod; amount: Kobo; compulsory: boolean; deadline: string | null };

export const emptyDue = (name = ''): DueForm => ({ name, kind: 'recurring', period: 'monthly', amount: kobo(0), compulsory: true, deadline: null });

export const dueReady = (d: DueForm) => d.name.trim().length >= 2 && d.amount >= DUES_MIN;

/** What the API takes. A deadline is the end of that day in Lagos. */
export const toDueInput = (d: DueForm): DueInput => ({
  name: d.name.trim(),
  kind: d.kind,
  amount: d.amount,
  compulsory: d.compulsory,
  ...(d.kind === 'recurring' ? { period: d.period } : d.deadline ? { dueAt: `${d.deadline}T23:59:59+01:00` } : {}),
});

/** One due's fields: what it's called, how often, how much, and whether everyone must pay it. */
export function DueFields({ value, onChange }: { value: DueForm; onChange: (changes: Partial<DueForm>) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [tomorrow] = useState(() => toIsoDate(new Date(Date.now() + 86_400_000)));
  return (
    <>
      <Input
        label={t('groups.dueName')}
        placeholder={t('groups.dueNamePlaceholder')}
        maxLength={40}
        value={value.name}
        onChangeText={(name) => onChange({ name })}
      />
      <View style={styles.switchRow}>
        <Switch value={value.kind === 'recurring'} onValueChange={(on) => onChange({ kind: on ? 'recurring' : 'one_off' })} />
        <View style={styles.flex}>
          <TasaText variant="caption">{t('groups.kind.recurring')}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t(value.kind === 'recurring' ? 'groups.repeatsHint' : 'groups.oneOffSwitchHint')}
          </TasaText>
        </View>
      </View>
      {value.kind === 'recurring' && (
        <SelectField
          title={t('groups.howOften')}
          placeholder={t('groups.howOften')}
          value={value.period}
          onChange={(period) => onChange({ period: period as GroupPeriod })}
          options={(['weekly', 'monthly', 'yearly'] as const).map((p) => ({ value: p, label: t(`groups.period.${p}`) }))}
        />
      )}
      <AmountInput label={t('groups.amount')} value={value.amount} onChangeValue={(amount) => onChange({ amount })} />
      <View style={styles.switchRow}>
        <Switch value={value.compulsory} onValueChange={(compulsory) => onChange({ compulsory })} />
        <View style={styles.flex}>
          <TasaText variant="caption">{t('groups.compulsory')}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t(value.compulsory ? 'groups.compulsoryHint' : 'groups.optionalHint')}
          </TasaText>
        </View>
      </View>
      {value.kind === 'one_off' && (
        <>
          <View style={styles.switchRow}>
            <Switch value={!!value.deadline} onValueChange={(on) => onChange({ deadline: on ? tomorrow : null })} />
            <TasaText variant="caption" style={styles.flex}>
              {t('groups.setDeadline')}
            </TasaText>
          </View>
          {value.deadline && (
            <CalendarField title={t('groups.deadline')} value={value.deadline} min={tomorrow} onChange={(deadline) => onChange({ deadline })} />
          )}
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('groups.oneOffHint')}
          </TasaText>
        </>
      )}
    </>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginVertical: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
  }),
);
