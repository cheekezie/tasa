import { useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { monthGrid } from '@/lib/calendar';
import { formatDate } from '@/lib/format';
import { useSheetDrag } from '@/hooks/useSheetDrag';
import { SheetHandle } from '@/components/ui/SheetHandle';

// Sundays, so the headings line up with `monthGrid`.
const WEEK = Array.from({ length: 7 }, (_, index) => new Date(2023, 0, 1 + index));

type CalendarFieldProps = {
  title: string;
  /** `YYYY-MM-DD`. */
  value: string;
  /** Earliest day that can be picked. */
  min: string;
  /** Latest day that can be picked, if there's a limit. */
  max?: string;
  onChange: (value: string) => void;
};

/** A date field that opens a month calendar. Days before `min` (or after `max`) can't be chosen. */
export function CalendarField({ title, value, min, max, onChange }: CalendarFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(() => ({
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)) - 1,
  }));

  const first = new Date(shown.year, shown.month, 1);
  // Nothing before `min`'s month can be picked, so there's no reason to go there.
  const atFirstMonth = `${shown.year}-${String(shown.month + 1).padStart(2, '0')}` <= min.slice(0, 7);
  const atLastMonth = !!max && `${shown.year}-${String(shown.month + 1).padStart(2, '0')}` >= max.slice(0, 7);
  const move = (by: number) => {
    const next = new Date(shown.year, shown.month + by, 1);
    setShown({ year: next.getFullYear(), month: next.getMonth() });
  };

  const drag = useSheetDrag(open, () => setOpen(false));
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${formatDate(value)}`} onPress={() => setOpen(true)} style={styles.field}>
        <TasaText variant="bodyMedium" style={styles.fieldText}>
          {value === min ? t('calendar.today') : formatDate(value)}
        </TasaText>
        <Icon color={colors.inkSubtle} ios="calendar" android="calendar_today" size={18} />
      </Pressable>

      <Modal transparent animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel={t('common.cancel')} style={styles.scrim} onPress={() => setOpen(false)} />
        <Animated.View {...drag.handlers} style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.md }, drag.style]}>
          <SheetHandle />
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('calendar.previous')}
              accessibilityState={{ disabled: atFirstMonth }}
              disabled={atFirstMonth}
              hitSlop={10}
              onPress={() => move(-1)}>
              <Icon color={atFirstMonth ? colors.track : colors.brand} ios="chevron.left" android="chevron_left" size={22} />
            </Pressable>
            <TasaText variant="subtitle">{first.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}</TasaText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('calendar.next')}
              accessibilityState={{ disabled: atLastMonth }}
              disabled={atLastMonth}
              hitSlop={10}
              onPress={() => move(1)}>
              <Icon color={atLastMonth ? colors.track : colors.brand} ios="chevron.right" android="chevron_right" size={22} />
            </Pressable>
          </View>

          <View style={styles.grid}>
            {WEEK.map((day) => (
              <View key={day.getDay()} style={styles.cell}>
                <TasaText variant="caption" color={colors.inkSubtle}>
                  {day.toLocaleDateString('en-NG', { weekday: 'narrow' })}
                </TasaText>
              </View>
            ))}
            {monthGrid(shown.year, shown.month).map((day, index) => {
              if (!day) return <View key={`blank-${index}`} style={styles.cell} />;
              const selected = day === value;
              const past = day < min || (!!max && day > max);
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={formatDate(day)}
                  accessibilityState={{ selected, disabled: past }}
                  disabled={past}
                  onPress={() => {
                    onChange(day);
                    setOpen(false);
                  }}
                  style={styles.cell}>
                  <View style={[styles.day, selected && styles.daySelected, day === min && !selected && styles.dayToday]}>
                    <TasaText variant="bodyMedium" color={selected ? '#FFFFFF' : past ? colors.track : colors.ink}>
                      {Number(day.slice(8))}
                    </TasaText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
      minHeight: 52,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    fieldText: {
      flex: 1,
    },
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
      gap: theme.spacing.md,
      paddingTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.screen,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      width: `${100 / 7}%`,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    day: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    daySelected: {
      backgroundColor: colors.brand,
    },
    dayToday: {
      borderWidth: 1,
      borderColor: colors.brand,
    },
  }),
);
