import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, TasaText } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useGroupMembers, useMemberAction } from '@/hooks/useGroups';
import { errorMessage } from '@/lib/api/errors';
import { GroupMemberDto } from '@/lib/api/types';
import { formatNaira } from '@/lib/format';

type Filter = 'all' | 'owing' | 'pending';

export const memberName = (m: Pick<GroupMemberDto, 'user'>, fallback: string) => m.user.name ?? (m.user.username ? `@${m.user.username}` : fallback);

/**
 * Everyone in the group, for executives: who owes and how much, who's waiting to be let in. Tap a
 * member for their statement, period by period.
 */
export function GroupMembersList({ groupId, pending, initialFilter = 'all' }: { groupId: string; pending: number; initialFilter?: Filter }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState('');
  const members = useGroupMembers(groupId, {
    ...(filter === 'pending' ? { status: 'pending' as const } : filter === 'owing' ? { status: 'active' as const, owing: true } : {}),
    ...(search.trim() && { search: search.trim() }),
  });
  const actions = useMemberAction(groupId);
  const fail = (error: unknown) => show(errorMessage(error), { tone: 'error' });

  return (
    <View style={styles.wrap}>
      <SegmentedControl
        options={[
          { value: 'all', label: t('groups.filterAll') },
          { value: 'owing', label: t('groups.filterOwing') },
          { value: 'pending', label: pending ? t('groups.filterPendingCount', { count: pending }) : t('groups.filterPending') },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <View style={styles.gap} />
      <Input label={t('groups.searchMembers')} autoCorrect={false} value={search} onChangeText={setSearch} />
      <QueryState query={members} hasData={!!members.data} skeleton="list" />
      {members.data?.items.length === 0 && (
        <EmptyState message={t(filter === 'pending' ? 'groups.noPending' : filter === 'owing' ? 'groups.noneOwing' : 'groups.noMembers')} />
      )}
      {members.data?.items.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole="button"
          disabled={m.status === 'pending'}
          onPress={() => router.push({ pathname: '/groups/member', params: { group: groupId, member: m.id } })}>
          <Card style={styles.member}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <TasaText variant="bodyMedium" numberOfLines={1}>
                  {memberName(m, t('groups.aMember'))}
                </TasaText>
                {Object.values(m.fields).length > 0 && (
                  <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
                    {Object.values(m.fields).join(' · ')}
                  </TasaText>
                )}
              </View>
              {m.status === 'active' && (
                <View style={styles.owed}>
                  <TasaText variant="caption" color={m.overdue > 0 ? colors.danger : m.amountOwed > 0 ? colors.accentHot : colors.success}>
                    {m.amountOwed > 0 ? formatNaira(m.amountOwed) : t('groups.upToDate')}
                  </TasaText>
                  {m.overdue > 0 && (
                    <TasaText variant="caption" color={colors.inkMuted}>
                      {t('groups.overdueShort', { amount: formatNaira(m.overdue) })}
                    </TasaText>
                  )}
                </View>
              )}
              {m.status === 'active' && <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />}
            </View>
            {m.status === 'pending' && (
              <View style={styles.actions}>
                <Button
                  label={t('groups.letIn')}
                  style={styles.flex}
                  loading={actions.decide.isPending && actions.decide.variables?.memberId === m.id && actions.decide.variables.approve}
                  onPress={() => actions.decide.mutate({ memberId: m.id, approve: true }, { onError: fail })}
                />
                <Button
                  label={t('groups.decline')}
                  variant="secondary"
                  style={styles.flex}
                  onPress={() => actions.decide.mutate({ memberId: m.id, approve: false }, { onError: fail })}
                />
              </View>
            )}
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    wrap: {
      marginTop: theme.spacing.md,
    },
    gap: {
      height: theme.spacing.sm,
    },
    member: {
      gap: 4,
      marginBottom: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    owed: {
      alignItems: 'flex-end',
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    flex: {
      flex: 1,
    },
  }),
);
