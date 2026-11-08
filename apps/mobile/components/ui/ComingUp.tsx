import { Href, router } from 'expo-router';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, ServiceIcon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, SectionHeader, TasaText } from '@/components/ui/Screen';
import { getServiceById } from '@/constants/data';
import { useSettings } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useMyGroups, useSplits } from '@/hooks/useGroups';
import { useRecurringBills } from '@/hooks/useSaved';
import { formatNaira, formatRelativeDateInline } from '@/lib/format';

const SHOWN = 4;

type Item = { key: string; date: string; overdue: boolean; icon: ReactNode; title: string; line: string; tone?: string; href: Href };

/**
 * What needs paying soon, wherever it comes from: recurring bills, group dues (owed now, then up
 * one period ahead) and splits still waiting on your share. Overdue first, then soonest.
 */
export function ComingUp() {
  const { colors } = useTheme();
  const { t } = useSettings();
  const styles = useStyles();
  const recurring = useRecurringBills();
  const groups = useMyGroups();
  const splits = useSplits();

  const icon = (ios: Parameters<typeof Icon>[0]['ios'], android: Parameters<typeof Icon>[0]['android'], color: string) => (
    <Icon ios={ios} android={android} color={color} size={20} />
  );

  const items: Item[] = [
    ...(recurring.data ?? [])
      .filter((bill) => bill.active)
      .map((bill) => ({
        key: `bill-${bill.id}`,
        date: bill.nextDate,
        overdue: false,
        icon: <ServiceIcon serviceId={getServiceById(bill.serviceId).id} />,
        title: bill.label,
        line: t('recurring.line', {
          amount: formatNaira(bill.amount),
          frequency: t(`home.${bill.frequency}`),
          date: formatRelativeDateInline(bill.nextDate),
        }),
        href: '/recurring' as Href,
      })),
    ...(groups.data ?? []).flatMap((group) =>
      (group.membership?.upcoming ?? []).map((u) => ({
        key: `due-${group.id}-${u.dueId}-${u.date}`,
        date: u.date,
        overdue: u.status === 'overdue',
        icon: icon('person.3.fill', 'groups', u.status === 'overdue' ? colors.danger : colors.accentHot),
        title: `${u.name} · ${group.name}`,
        line:
          u.status === 'overdue'
            ? t('home.dueOverdue', { amount: formatNaira(u.amount) })
            : u.status === 'due'
              ? t('home.dueNow', { amount: formatNaira(u.amount) })
              : t('home.dueOn', { amount: formatNaira(u.amount), date: formatRelativeDateInline(u.date) }),
        tone: u.status === 'overdue' ? colors.danger : u.status === 'due' ? colors.accentHot : undefined,
        href: { pathname: '/groups/[id]', params: { id: group.id } } as Href,
      })),
    ),
    ...(splits.data ?? [])
      .filter((split) => split.status === 'open' && split.myShare && !split.myShare.paid)
      .map((split) => ({
        key: `split-${split.id}`,
        date: split.deadline,
        overdue: false,
        icon: icon('divide.circle.fill', 'call_split', colors.brand),
        title: split.title,
        line: t('home.splitShare', { amount: formatNaira(split.myShare!.amount), date: formatRelativeDateInline(split.deadline) }),
        tone: colors.accentHot,
        href: { pathname: '/splits/[id]', params: { id: split.id } } as Href,
      })),
  ]
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date))
    .slice(0, SHOWN);

  const loaded = !!recurring.data || !!groups.data || !!splits.data;
  if (recurring.isError && groups.isError && splits.isError) return null;

  return (
    <>
      <SectionHeader title={t('home.comingUp')} />
      <QueryState query={recurring} hasData={loaded} quiet />
      {loaded && items.length === 0 && <EmptyState message={t('home.nothingComingUp')} />}
      {items.map((item) => (
        <Pressable key={item.key} accessibilityRole="button" onPress={() => router.push(item.href)} style={styles.row}>
          <View style={styles.icon}>{item.icon}</View>
          <View style={styles.copy}>
            <TasaText variant="bodyMedium" numberOfLines={1}>
              {item.title}
            </TasaText>
            <TasaText variant="caption" color={item.tone ?? colors.inkMuted} numberOfLines={1}>
              {item.line}
            </TasaText>
          </View>
          <Icon ios="chevron.right" android="chevron_right" color={colors.inkSubtle} size={16} />
        </Pressable>
      ))}
    </>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
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
