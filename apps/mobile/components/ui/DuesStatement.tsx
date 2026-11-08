import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { Card } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { DuePeriodDto, DuePeriodStatus, GroupDueDto, GroupReceiptDto, MemberDueDto } from '@/lib/api/types';
import { formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';

/** Periods picked to pay, by due id. */
export type DuesSelection = Record<string, number[]>;

/** What's owed is picked to start with: tick off anything else, untick what you'd rather leave. */
export function useDuesSelection(dues: MemberDueDto[] | undefined) {
  const [selection, setSelection] = useState<DuesSelection | null>(null);
  const owed: DuesSelection = Object.fromEntries(
    (dues ?? []).map((d) => [d.id, d.periods.filter((p) => p.status === 'due' || p.status === 'overdue').map((p) => p.index)]),
  );
  const current = selection ?? owed;
  const toggle = (dueId: string, index: number) =>
    setSelection(() => {
      const picked = current[dueId] ?? [];
      return { ...current, [dueId]: picked.includes(index) ? picked.filter((k) => k !== index) : [...picked, index] };
    });
  const items = Object.entries(current)
    .filter(([, periods]) => periods.length > 0)
    .map(([dueId, periods]) => ({ dueId, periods: [...periods].sort((a, b) => a - b) }));
  const total = kobo(items.reduce((sum, item) => sum + (dues?.find((d) => d.id === item.dueId)?.amount ?? 0) * item.periods.length, 0));
  const count = items.reduce((n, item) => n + item.periods.length, 0);
  return { selection: current, toggle, items, total, count, reset: () => setSelection(null) };
}

// Periods start at midnight in Lagos: read them there, or 1 Jan shows as 31 Dec elsewhere.
const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'short', timeZone: 'Africa/Lagos' });
const DAY_MONTH = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const LAGOS_PARTS = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Lagos' });

/**
 * "WK1": which week of its year a period starts in, counting Monday-to-Sunday weeks from the
 * year's first Monday, the same weeks the executives' grid uses.
 */
export function weekNumber(start: string) {
  const [y, m, d] = LAGOS_PARTS.format(new Date(start)).split('-').map(Number) as [number, number, number];
  // The Monday of its week decides the week (and the year: 1 Jan on a Thursday is the old year's last week).
  const day = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  const dayOfYear = (monday.getTime() - Date.UTC(monday.getUTCFullYear(), 0, 1)) / 86_400_000 + 1;
  return `WK${Math.ceil(dayOfYear / 7)}`;
}
const YEAR = new Intl.DateTimeFormat('en-NG', { year: 'numeric', timeZone: 'Africa/Lagos' });
const FULL = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const lagosDate = (iso: string) => FULL.format(new Date(iso));

/** A period's short name: the month (week, year) it starts in, the way the executives' grid lines them up. */
export function periodLabel(due: Pick<GroupDueDto, 'kind' | 'period'>, start: string) {
  const date = new Date(start);
  if (due.kind === 'one_off') return { top: '', bottom: '' };
  if (due.period === 'yearly') return { top: YEAR.format(date), bottom: '' };
  if (due.period === 'weekly') return { top: weekNumber(start), bottom: DAY_MONTH.format(date) };
  return { top: MONTH.format(date), bottom: `’${YEAR.format(date).slice(2)}` };
}

/** What a receipt paid, one line per due: "Monthly dues: Jan ’26, Feb ’26". A one-off is just its name. */
export function describePaid(dues: GroupReceiptDto['dues']) {
  return dues.map((d) => {
    const labels = d.periods
      .filter((p) => p.start && d.kind)
      .map((p) => {
        const label = periodLabel({ kind: d.kind!, period: d.period }, p.start!);
        return label.bottom ? `${label.top} ${label.bottom}` : label.top;
      })
      .filter(Boolean);
    return labels.length ? `${d.name}: ${labels.join(', ')}` : d.name;
  });
}

/** The colours of each status, shared with the executives' grid. */
export function useStatusColors() {
  const { colors } = useTheme();
  return {
    paid: colors.success,
    due: colors.accentHot,
    overdue: colors.danger,
    optional: colors.inkMuted,
    upcoming: colors.inkSubtle,
  } satisfies Record<DuePeriodStatus, string>;
}

/** "₦1,000 a month", "₦5,000 once · by 12 Nov". */
export function usePriceLine() {
  const t = useT();
  return (due: GroupDueDto) =>
    due.kind === 'recurring'
      ? t(`groups.every.${due.period!}`, { amount: formatNaira(due.amount) })
      : due.dueAt
        ? t('groups.onceBy', { amount: formatNaira(due.amount), date: lagosDate(due.dueAt) })
        : t('groups.once', { amount: formatNaira(due.amount) });
}

/**
 * A member's dues, each with its periods as a strip of chips: paid, due now, overdue, optional and
 * ahead. With `onToggle` the unpaid ones can be picked to pay; without it, it's read-only (an
 * executive looking at one member).
 */
export function DuesStatement({
  dues,
  selection,
  onToggle,
}: {
  dues: MemberDueDto[];
  selection?: DuesSelection;
  onToggle?: (dueId: string, index: number) => void;
}) {
  return (
    <>
      {dues.map((due) => (
        <DueRow key={due.id} due={due} picked={selection?.[due.id] ?? []} onToggle={onToggle && ((index) => onToggle(due.id, index))} />
      ))}
    </>
  );
}

function DueRow({ due, picked, onToggle }: { due: MemberDueDto; picked: number[]; onToggle?: (index: number) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const price = usePriceLine();
  const scroll = useRef<ScrollViewInstance>(null);
  const overdue = due.periods.filter((p) => p.status === 'overdue').length;
  const lastPaid = [...due.periods].reverse().find((p) => p.status === 'paid');
  // Open on the current period, with what came before just off to the left.
  const currentAt = Math.max(
    0,
    due.periods.findIndex((p) => p.status === 'due' || p.status === 'upcoming'),
  );
  useEffect(() => {
    const id = setTimeout(() => scroll.current?.scrollTo({ x: Math.max(0, (currentAt - 2) * (CHIP + GAP)), animated: false }), 0);
    return () => clearTimeout(id);
  }, [currentAt]);

  const summary =
    due.owed > 0
      ? overdue > 0
        ? t('groups.owedWithOverdue', { amount: formatNaira(due.owed), count: overdue })
        : t('groups.owedNow', { amount: formatNaira(due.owed) })
      : due.kind === 'one_off'
        ? t(due.periods[0]?.status === 'paid' ? 'groups.paid' : 'groups.notPaidOptional')
        : lastPaid?.end
          ? t('groups.paidThrough', { date: lagosDate(new Date(new Date(lastPaid.end).getTime() - 86_400_000).toISOString()) })
          : t(due.compulsory ? 'groups.nothingDue' : 'groups.notPaidOptional');

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <TasaText variant="bodyMedium" numberOfLines={1}>
            {due.name}
          </TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {price(due)}
          </TasaText>
        </View>
        {(!due.compulsory || due.endedAt) && (
          <View style={styles.tag}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t(due.endedAt ? 'groups.ended' : 'groups.optionalTag')}
            </TasaText>
          </View>
        )}
      </View>
      <TasaText variant="caption" color={due.owed > 0 ? (overdue > 0 ? colors.danger : colors.accentHot) : colors.success}>
        {summary}
      </TasaText>

      {due.kind === 'one_off' ? (
        due.periods[0] && (
          <OneOffChip
            period={due.periods[0]}
            picked={picked.includes(0)}
            onPress={onToggle && due.periods[0].status !== 'paid' ? () => onToggle(0) : undefined}
          />
        )
      ) : (
        <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {due.periods.map((p) => (
            <PeriodChip
              key={p.index}
              due={due}
              period={p}
              picked={picked.includes(p.index)}
              onPress={onToggle && p.status !== 'paid' ? () => onToggle(p.index) : undefined}
            />
          ))}
        </ScrollView>
      )}
    </Card>
  );
}

const CHIP = 58;
const GAP = 6;

function PeriodChip({ due, period, picked, onPress }: { due: GroupDueDto; period: DuePeriodDto; picked: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const tone = useStatusColors()[period.status];
  const label = periodLabel(due, period.start);
  return (
    <Pressable
      accessibilityRole={onPress ? 'checkbox' : undefined}
      accessibilityState={onPress ? { checked: picked } : undefined}
      accessibilityLabel={`${label.top} ${label.bottom} ${t(`groups.status.${period.status}`)}`}
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: picked ? colors.brand : period.status === 'paid' ? `${tone}55` : tone, backgroundColor: picked ? colors.brand : `${tone}14` },
        period.status === 'upcoming' && !picked && styles.dashed,
      ]}>
      <TasaText variant="caption" color={picked ? colors.surface : colors.ink} numberOfLines={1}>
        {label.top}
        {label.bottom ? <TasaText variant="caption" color={picked ? colors.surface : colors.inkMuted}>{` ${label.bottom}`}</TasaText> : null}
      </TasaText>
      {period.status === 'paid' ? (
        <Icon ios="checkmark" android="check" color={tone} size={14} />
      ) : (
        <TasaText variant="caption" color={picked ? colors.surface : tone} numberOfLines={1} style={styles.chipStatus}>
          {picked ? '✓' : t(`groups.status.${period.status}`)}
        </TasaText>
      )}
    </Pressable>
  );
}

function OneOffChip({ period, picked, onPress }: { period: DuePeriodDto; picked: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const tone = useStatusColors()[period.status];
  return (
    <Pressable
      accessibilityRole={onPress ? 'checkbox' : undefined}
      accessibilityState={onPress ? { checked: picked } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.oneOff, { borderColor: picked ? colors.brand : tone, backgroundColor: picked ? `${colors.brand}14` : `${tone}10` }]}>
      <Icon
        ios={period.status === 'paid' || picked ? 'checkmark.circle.fill' : 'circle'}
        android={period.status === 'paid' || picked ? 'check_circle' : 'radio_button_unchecked'}
        color={period.status === 'paid' ? tone : picked ? colors.brand : colors.inkSubtle}
        size={18}
      />
      <TasaText variant="caption" color={tone} style={styles.flex}>
        {t(`groups.status.${period.status}`)}
      </TasaText>
      {onPress && (
        <TasaText variant="caption" color={colors.inkMuted}>
          {t(picked ? 'groups.picked' : 'groups.tapToPick')}
        </TasaText>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      gap: 4,
      marginBottom: theme.spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    tag: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: theme.radius.pill,
      backgroundColor: colors.track,
    },
    strip: {
      gap: GAP,
      paddingTop: theme.spacing.sm,
    },
    chip: {
      width: CHIP,
      height: 50,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    dashed: {
      borderStyle: 'dashed',
      backgroundColor: 'transparent',
    },
    chipStatus: {
      fontSize: 10,
    },
    oneOff: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      borderRadius: theme.radius.md,
      borderWidth: 1,
    },
    flex: {
      flex: 1,
    },
  }),
);
