import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { ActionSheet } from '@/components/ui/ActionSheet';
import { Button, Card } from '@/components/ui/Button';
import { usePriceLine, useStatusColors, weekNumber } from '@/components/ui/DuesStatement';
import { memberName } from '@/components/ui/GroupMembersList';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useDueReport, useEndDue, useGroup } from '@/hooks/useGroups';
import { errorMessage } from '@/lib/api/errors';
import { DuePeriodStatus, GroupDueReportDto } from '@/lib/api/types';
import { formatNaira } from '@/lib/format';
import { exportDueReportExcel, exportDueReportPdf } from '@/lib/groupReport';

const NAME_WIDTH = 128;
const CELL = 44;
const ROW = 44;
/** Tall enough for a slanted label. */
const HEADER = 64;

// Periods start at midnight in Lagos: read them there, or 1 Jan shows as 31 Dec elsewhere.
const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'short', timeZone: 'Africa/Lagos' });
const DAY_MONTH = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const YEAR = new Intl.DateTimeFormat('en-NG', { year: 'numeric', timeZone: 'Africa/Lagos' });

/**
 * Who paid what of one due, for executives: members down the side, every month (week) of the
 * chosen year across, a tick for each period paid. Each member's period sits in the month it
 * starts in, whatever their join day. Yearly dues show every year.
 */
export default function DueReportScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const price = usePriceLine();
  const { group, due: dueId } = useLocalSearchParams<{ group: string; due: string }>();
  const [year, setYear] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const query = useDueReport(group, dueId, { ...(year && { year }), ...(search.trim() && { search: search.trim() }) });
  const report = query.data;
  const end = useEndDue(group);
  const [ending, setEnding] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const groupName = useGroup(group).data?.name ?? '';
  const due = report?.due;
  // What's on screen goes in the file: the same year and search.
  const runExport = async (kind: 'pdf' | 'excel') => {
    setExporting(kind);
    try {
      const options = { ...(report?.year && { year: report.year }), ...(search.trim() && { search: search.trim() }) };
      const shared = await (kind === 'pdf' ? exportDueReportPdf : exportDueReportExcel)(group, groupName, dueId, options);
      if (!shared) show(t('groups.exportUnavailable'), { tone: 'error' });
    } catch (error) {
      show(errorMessage(error), { tone: 'error' });
    } finally {
      setExporting(null);
    }
  };

  return (
    <Screen
      refreshable
      footer={
        report && !report.due.endedAt ? <Button label={t('groups.endDue')} variant="destructive" onPress={() => setEnding(true)} /> : undefined
      }>
      <QueryState query={query} hasData={!!report} skeleton="detail" />
      {report && due && (
        <>
          <View style={styles.titleRow}>
            <TasaText variant="title" color={colors.heading} style={styles.flex}>
              {due.name}
            </TasaText>
            <Pressable accessibilityRole="button" hitSlop={8} disabled={!!exporting} onPress={() => setExportMenu(true)} style={styles.row}>
              {exporting ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Icon ios="square.and.arrow.up" android="ios_share" color={colors.brand} size={16} />
              )}
              <TasaText variant="caption" color={colors.brand}>
                {t(exporting ? 'groups.exporting' : 'groups.export')}
              </TasaText>
            </Pressable>
          </View>
          <TasaText variant="caption" color={colors.inkMuted}>
            {price(due)} · {t(due.compulsory ? 'groups.compulsory' : 'groups.optionalTag')}
            {due.endedAt ? ` · ${t('groups.ended')}` : ''}
          </TasaText>

          <View style={styles.stats}>
            <Stat label={t('groups.collected')} value={formatNaira(report.totals.collected)} />
            <Stat
              label={t('groups.outstanding')}
              value={formatNaira(report.totals.outstanding)}
              tone={report.totals.outstanding > 0 ? colors.accentHot : undefined}
            />
            <Stat label={t('groups.owing')} value={t('groups.ofMembers', { count: report.totals.owing, total: report.totals.members })} />
          </View>

          {report.year !== null && report.years.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.years}>
              {report.years.map((y) => {
                const on = y === report.year;
                return (
                  <Pressable
                    key={y}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setYear(y)}
                    style={[styles.year, on && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
                    <TasaText variant="caption" color={on ? colors.surface : colors.ink}>
                      {String(y)}
                    </TasaText>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <Input label={t('groups.searchMembers')} autoCorrect={false} value={search} onChangeText={setSearch} />

          {report.items.length === 0 ? (
            <EmptyState message={t(search.trim() ? 'groups.noMatches' : 'groups.noMembers')} />
          ) : (
            <Grid key={report.year ?? 'all'} report={report} groupId={group} />
          )}
          <GridLegend />

          <ActionSheet
            visible={exportMenu}
            title={t('groups.exportTitle')}
            message={t('groups.exportHint')}
            cancelLabel={t('common.cancel')}
            onClose={() => setExportMenu(false)}
            options={[
              { label: t('groups.exportPdf'), icon: { ios: 'doc.richtext', android: 'picture_as_pdf' }, onPress: () => runExport('pdf') },
              { label: t('groups.exportExcel'), icon: { ios: 'tablecells', android: 'table_view' }, onPress: () => runExport('excel') },
            ]}
          />
          <ActionSheet
            visible={ending}
            title={t('groups.endDueTitle', { name: due.name })}
            message={t(due.compulsory ? 'groups.endDueBody' : 'groups.endOptionalBody')}
            cancelLabel={t('common.cancel')}
            onClose={() => setEnding(false)}
            options={[
              {
                label: t('groups.endDue'),
                destructive: true,
                onPress: () =>
                  end.mutate(due.id, {
                    onSuccess: () => {
                      show(t('groups.dueEnded'));
                      query.refetch();
                    },
                    onError: (error) => show(errorMessage(error), { tone: 'error' }),
                  }),
              },
            ]}
          />
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Card style={styles.stat}>
      <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" color={tone ?? colors.heading} numberOfLines={1}>
        {value}
      </TasaText>
    </Card>
  );
}

/** A column's name: the month, the week's Monday, or the year. */
function columnLabel(report: GroupDueReportDto, start: string, fallback: string) {
  const date = new Date(start);
  if (report.due.kind === 'one_off') return fallback;
  if (report.due.period === 'yearly') return YEAR.format(date);
  return MONTH.format(date);
}

/** Names stay put on the left; the periods scroll sideways, opening on the current one. */
function Grid({ report, groupId }: { report: GroupDueReportDto; groupId: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const scroll = useRef<ScrollViewInstance>(null);
  const oneOff = report.due.kind === 'one_off';
  const weekly = report.due.period === 'weekly';
  const [now] = useState(() => Date.now());
  const current = report.columns.findIndex((c) => new Date(c.start).getTime() <= now && (!c.end || now < new Date(c.end).getTime()));
  const open = (memberId: string) => router.push({ pathname: '/groups/member', params: { group: groupId, member: memberId } });

  return (
    <Card style={styles.grid}>
      <View style={styles.names}>
        <View style={styles.headerCorner} />
        {report.items.map((row, index) => (
          <Pressable key={row.id} accessibilityRole="button" onPress={() => open(row.id)} style={[styles.nameCell, index % 2 === 1 && styles.zebra]}>
            <TasaText variant="caption" numberOfLines={1}>
              {memberName(row, t('groups.aMember'))}
            </TasaText>
            {row.owed > 0 && (
              <TasaText variant="caption" color={colors.danger} numberOfLines={1} style={styles.small}>
                {formatNaira(row.owed)}
              </TasaText>
            )}
          </Pressable>
        ))}
      </View>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.flex}
        contentContainerStyle={oneOff ? styles.flex : undefined}
        onContentSizeChange={() => {
          if (current > 2) scroll.current?.scrollTo({ x: (current - 2) * CELL, animated: false });
        }}>
        <View style={oneOff ? styles.flex : undefined}>
          <View style={styles.headerRow}>
            {report.columns.map((c, i) => (
              <View key={c.start} style={[styles.headerCell, oneOff ? styles.wide : styles.cell]}>
                {weekly ? (
                  // Two short straight lines read better than one long slanted one.
                  <>
                    <TasaText variant="caption" color={i === current ? colors.brand : colors.heading} numberOfLines={1}>
                      {weekNumber(c.start)}
                    </TasaText>
                    <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1} style={styles.small}>
                      {DAY_MONTH.format(new Date(c.start))}
                    </TasaText>
                  </>
                ) : (
                  <TasaText
                    variant="caption"
                    color={i === current ? colors.brand : colors.heading}
                    numberOfLines={1}
                    style={oneOff ? undefined : styles.slant}>
                    {columnLabel(report, c.start, t('groups.status.paid'))}
                  </TasaText>
                )}
              </View>
            ))}
          </View>
          {report.items.map((row, index) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              onPress={() => open(row.id)}
              style={[styles.headerRow, index % 2 === 1 && styles.zebra]}>
              {row.cells.map((status, i) => (
                <View key={i} style={[styles.rowCell, oneOff ? styles.wide : styles.cell, i === current && styles.currentColumn]}>
                  <Cell status={status} />
                </View>
              ))}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Card>
  );
}

/** A tick when paid; otherwise a mark for what's owed, and nothing much for the rest. */
function Cell({ status }: { status: DuePeriodStatus | null }) {
  const styles = useStyles();
  const tone = useStatusColors();
  if (!status) return <View style={styles.none} />;
  const color = tone[status];
  if (status === 'paid') {
    return (
      <View style={[styles.mark, { backgroundColor: color, borderColor: color }]}>
        <Icon ios="checkmark" android="check" color="#fff" size={12} />
      </View>
    );
  }
  return (
    <View style={[styles.mark, { borderColor: color }, (status === 'upcoming' || status === 'optional') && styles.dashed]}>
      {status === 'overdue' && (
        <TasaText variant="caption" color={color} style={styles.bang}>
          !
        </TasaText>
      )}
    </View>
  );
}

function GridLegend() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.legend}>
      {(['paid', 'due', 'overdue', 'optional', 'upcoming'] as const).map((status) => (
        <View key={status} style={styles.row}>
          <Cell status={status} />
          <TasaText variant="caption" color={colors.inkMuted}>
            {t(`groups.status.${status}`)}
          </TasaText>
        </View>
      ))}
      <View style={styles.row}>
        <Cell status={null} />
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('groups.notMemberYet')}
        </TasaText>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    stats: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.md,
    },
    stat: {
      flex: 1,
      gap: 2,
      paddingHorizontal: theme.spacing.sm,
    },
    years: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    year: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    grid: {
      flexDirection: 'row',
      padding: 0,
      overflow: 'hidden',
    },
    names: {
      width: NAME_WIDTH,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
    },
    headerCorner: {
      height: HEADER,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
    },
    headerCell: {
      height: HEADER,
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    slant: {
      width: CELL + 16,
      textAlign: 'center',
      transform: [{ rotate: '-45deg' }],
    },
    nameCell: {
      height: ROW,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
    },
    rowCell: {
      height: ROW,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cell: {
      width: CELL,
    },
    wide: {
      flex: 1,
      minWidth: CELL * 2,
    },
    currentColumn: {
      backgroundColor: `${colors.brand}0D`,
    },
    zebra: {
      backgroundColor: `${colors.track}66`,
    },
    mark: {
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dashed: {
      borderStyle: 'dashed',
    },
    none: {
      width: 14,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.border,
    },
    bang: {
      fontSize: 11,
      lineHeight: 13,
    },
    small: {
      fontSize: 10,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    flex: {
      flex: 1,
    },
  }),
);
