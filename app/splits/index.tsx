import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useSplits } from '@/hooks/useGroups';
import { formatDateTime, formatNaira } from '@/lib/format';

/** Bills they're sharing: what's in the pot, and what's still owed by whom. */
export default function SplitsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const splits = useSplits();

  return (
    <Screen refreshable footer={<Button label={t('splits.new')} onPress={() => router.push('/splits/create')} />}>
      <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
        {t('splits.intro')}
      </TasaText>
      <QueryState query={splits} hasData={!!splits.data} skeleton="list" />
      {splits.data?.length === 0 && <EmptyState message={t('splits.none')} />}
      {splits.data?.map((split) => {
        const owe = split.myShare && !split.myShare.paid && split.status === 'open';
        return (
          <Pressable key={split.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/splits/[id]', params: { id: split.id } })}>
            <Card style={styles.row}>
              <View style={styles.copy}>
                <TasaText variant="bodyMedium" numberOfLines={1}>
                  {split.title}
                </TasaText>
                <TasaText variant="caption" color={owe ? colors.accentHot : colors.inkMuted} numberOfLines={1}>
                  {owe
                    ? t('splits.youOwe', { amount: formatNaira(split.myShare!.amount), date: formatDateTime(split.deadline) })
                    : t(`splits.status.${split.status}`, { collected: formatNaira(split.collected), total: formatNaira(split.total) })}
                </TasaText>
              </View>
              <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const useStyles = makeStyles(() =>
  StyleSheet.create({
    intro: {
      marginBottom: theme.spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: theme.spacing.sm,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
