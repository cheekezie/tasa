import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card } from '@/components/ui/Button';
import { DuesStatement } from '@/components/ui/DuesStatement';
import { memberName } from '@/components/ui/GroupMembersList';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SelectField } from '@/components/ui/SelectField';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useGroup, useGroupMember, useMemberAction } from '@/hooks/useGroups';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatNaira } from '@/lib/format';
import { kobo } from '@/lib/money';

/** One member, for executives: what they told the group and every period of every due. */
export default function GroupMemberScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { group: groupId, member: memberId } = useLocalSearchParams<{ group: string; member: string }>();
  const group = useGroup(groupId).data;
  const query = useGroupMember(groupId, memberId);
  const m = query.data;
  const actions = useMemberAction(groupId);
  const [arrears, setArrears] = useState(false);
  const fail = (error: unknown) => show(errorMessage(error), { tone: 'error' });
  const fields = group?.fields.filter((f) => m?.fields[f.key]) ?? [];

  return (
    <Screen refreshable>
      <QueryState query={query} hasData={!!m} skeleton="detail" />
      {m && (
        <>
          <TasaText variant="title" color={colors.heading}>
            {memberName(m, t('groups.aMember'))}
          </TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('groups.memberSince', { date: formatDate(m.startsAt) })}
          </TasaText>
          {fields.length > 0 && (
            <Card style={styles.card}>
              {fields.map((f) => (
                <View key={f.key} style={styles.row}>
                  <TasaText variant="caption" color={colors.inkMuted} style={styles.flex}>
                    {f.label}
                  </TasaText>
                  <TasaText variant="caption">{m.fields[f.key]}</TasaText>
                </View>
              ))}
            </Card>
          )}

          <Card style={styles.card}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('groups.owesNow')}
            </TasaText>
            <TasaText variant="display" color={m.amountOwed > 0 ? colors.heading : colors.success}>
              {m.amountOwed > 0 ? formatNaira(m.amountOwed) : t('groups.allPaid')}
            </TasaText>
            {m.overdue > 0 && (
              <TasaText variant="caption" color={colors.danger}>
                {t('groups.overdueAmount', { amount: formatNaira(m.overdue) })}
              </TasaText>
            )}
          </Card>

          <SectionHeader
            title={t('groups.statement')}
            action={
              m.status === 'active' ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setArrears(true)}>
                  <TasaText variant="caption" color={colors.brand}>
                    {t('groups.addArrears')}
                  </TasaText>
                </Pressable>
              ) : undefined
            }
          />
          <DuesStatement dues={m.dues ?? []} />
          {m.backfills.length > 0 && (
            <TasaText variant="caption" color={colors.inkMuted}>
              {m.backfills
                .map((b) =>
                  t('groups.arrearsLine', {
                    count: b.periods,
                    due: group?.dues.find((d) => d.id === b.dueId)?.name ?? '',
                    date: formatDate(b.at),
                    note: b.note ? ` · ${b.note}` : '',
                  }),
                )
                .join('\n')}
            </TasaText>
          )}

          {m.status === 'active' && (
            <Button
              label={t('groups.removeMember')}
              variant="ghost"
              style={styles.remove}
              loading={actions.remove.isPending}
              onPress={() =>
                actions.remove.mutate(m.id, {
                  onSuccess: () => {
                    show(t('groups.memberRemoved'));
                    router.back();
                  },
                  onError: fail,
                })
              }
            />
          )}
          {group && (
            <ArrearsSheet
              visible={arrears}
              onClose={() => setArrears(false)}
              dues={group.dues.filter((d) => d.kind === 'recurring' && d.compulsory && !d.endedAt)}
              onSubmit={(input) =>
                actions.backfill.mutate(
                  { memberId: m.id, ...input },
                  {
                    onSuccess: () => {
                      setArrears(false);
                      show(t('groups.arrearsAdded'));
                    },
                    onError: fail,
                  },
                )
              }
              loading={actions.backfill.isPending}
            />
          )}
        </>
      )}
    </Screen>
  );
}

/** Arrears from before Tasa: earlier periods of a compulsory recurring due, owed like any other. */
function ArrearsSheet({
  visible,
  onClose,
  dues,
  onSubmit,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  dues: { id: string; name: string; amount: number; period: string | null }[];
  onSubmit: (input: { dueId: string; periods: number; note?: string }) => void;
  loading: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [dueId, setDueId] = useState<string | null>(null);
  const [periods, setPeriods] = useState('');
  const [note, setNote] = useState('');
  const due = dues.find((d) => d.id === (dueId ?? dues[0]?.id));
  return (
    <BottomSheet visible={visible} title={t('groups.addArrears')} onClose={onClose}>
      {dues.length === 0 ? (
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('groups.noArrearsDue')}
        </TasaText>
      ) : (
        <>
          <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
            {t('groups.arrearsHint')}
          </TasaText>
          {dues.length > 1 && (
            <SelectField
              title={t('groups.due')}
              placeholder={t('groups.due')}
              value={due?.id ?? null}
              onChange={setDueId}
              options={dues.map((d) => ({ value: d.id, label: d.name }))}
            />
          )}
          <Input
            label={t('groups.arrearsPeriods')}
            keyboardType="number-pad"
            maxLength={3}
            value={periods}
            onChangeText={(v) => setPeriods(v.replace(/\D/g, ''))}
          />
          <Input label={t('groups.arrearsNote')} maxLength={200} last value={note} onChangeText={setNote} />
          <Button
            disabled={!Number(periods) || !due}
            label={
              due && Number(periods) ? t('groups.addArrearsFor', { amount: formatNaira(kobo(due.amount * Number(periods))) }) : t('groups.addArrears')
            }
            loading={loading}
            onPress={() => onSubmit({ dueId: due!.id, periods: Number(periods), ...(note.trim() && { note: note.trim() }) })}
          />
        </>
      )}
    </BottomSheet>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    card: {
      gap: 4,
      marginTop: theme.spacing.md,
    },
    row: {
      flexDirection: 'row',
      gap: 12,
    },
    hint: {
      marginBottom: theme.spacing.sm,
    },
    remove: {
      marginTop: theme.spacing.lg,
    },
    flex: {
      flex: 1,
    },
  }),
);
