import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { OrganisationLogo } from '@/components/ui/OrganisationLogo';
import { Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useMyGroups } from '@/hooks/useGroups';
import { formatNaira } from '@/lib/format';
import { GroupSummaryDto } from '@/lib/api/types';

/** The groups they pay dues to and the ones they run. Joining is by invite code; anyone with an ID on file can start one. */
export default function GroupsScreen() {
  const t = useT();
  const styles = useStyles();
  const groups = useMyGroups();

  return (
    <Screen
      refreshable
      footer={
        <View style={styles.footer}>
          <Button label={t('groups.create')} variant="secondary" style={styles.footerButton} onPress={() => router.push('/groups/create')} />
          <Button label={t('groups.join')} style={styles.footerButton} onPress={() => router.push('/groups/join')} />
        </View>
      }>
      <TasaText variant="body" style={styles.intro}>
        {t('groups.intro')}
      </TasaText>
      <QueryState query={groups} hasData={!!groups.data} skeleton="list" />
      {groups.data?.length === 0 && <EmptyState message={t('groups.none')} />}
      {groups.data?.map((group) => (
        <GroupRow key={group.id} group={group} />
      ))}
    </Screen>
  );
}

function GroupRow({ group }: { group: GroupSummaryDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const m = group.membership;
  const line = !m
    ? t('groups.youRunIt')
    : m.status === 'pending'
      ? t('groups.waitingApproval')
      : m.amountOwed > 0
        ? t(m.overdue > 0 ? 'groups.owesOverdue' : 'groups.owes', { amount: formatNaira(m.amountOwed) })
        : group.role
          ? t('groups.youRunIt')
          : t('groups.allPaid');
  const owing = !!m && m.status === 'active' && m.amountOwed > 0;

  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/groups/[id]', params: { id: group.id } })}>
      <Card style={styles.row}>
        {group.logoUrl ? (
          <OrganisationLogo uri={group.logoUrl} size={40} />
        ) : (
          <View style={styles.badge}>
            <TasaText variant="bodyMedium" color={colors.brand}>
              {group.name.charAt(0).toUpperCase()}
            </TasaText>
          </View>
        )}
        <View style={styles.copy}>
          <TasaText variant="bodyMedium" numberOfLines={1}>
            {group.name}
          </TasaText>
          <TasaText variant="caption" color={owing ? colors.danger : colors.inkMuted} numberOfLines={1}>
            {line}
          </TasaText>
        </View>
        {!!group.role && (
          <TasaText variant="caption" color={colors.brand}>
            {t(group.role === 'owner' ? 'groups.owner' : 'groups.executive')}
          </TasaText>
        )}
        <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
      </Card>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    intro: {
      color: colors.inkMuted,
      marginBottom: theme.spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: theme.spacing.sm,
    },
    badge: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 40,
      height: 40,
      borderRadius: theme.radius.md,
      backgroundColor: `${colors.brand}14`,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
    footer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    footerButton: {
      flex: 1,
    },
  }),
);
