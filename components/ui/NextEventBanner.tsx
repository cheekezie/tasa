import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useMyTickets } from '@/hooks/useTickets';
import { formatDateTime } from '@/lib/format';

/** On Home, the next event they hold a ticket for. Nothing at all when there isn't one. */
export function NextEventBanner() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { data: tickets = [] } = useMyTickets();
  const now = new Date().toISOString();
  const next = tickets
    .filter((ticket) => ticket.status === 'valid' && !!ticket.startsAt && ticket.startsAt > now)
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!))[0];
  if (!next) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('home.nextEvent')}: ${next.eventTitle}. ${t('home.showTicket')}`}
      onPress={() => router.push({ pathname: '/tickets/[id]', params: { id: next.id } })}
      style={styles.card}>
      <DateTile date={next.startsAt!} />
      <View style={styles.copy}>
        <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
          {t('home.nextEvent')}
        </TasaText>
        <TasaText variant="bodyMedium" color={colors.heading} numberOfLines={1}>
          {next.eventTitle}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
          {formatDateTime(next.startsAt!)}
        </TasaText>
      </View>
      <TasaText variant="caption" color={colors.accentHot} numberOfLines={1}>
        {t('home.showTicket')}
      </TasaText>
      <Icon color={colors.inkMuted} ios="chevron.right" android="chevron_right" size={16} />
    </Pressable>
  );
}

/** The day an event happens, like a page torn off a calendar. */
function DateTile({ date }: { date: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const when = new Date(date);
  return (
    <View style={styles.tile}>
      <TasaText variant="caption" color={colors.accentHot}>
        {new Intl.DateTimeFormat('en-NG', { month: 'short' }).format(when).toUpperCase()}
      </TasaText>
      <TasaText variant="title" color={colors.heading}>
        {when.getDate()}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginTop: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.warmSoftBorder,
      backgroundColor: colors.warmSoft,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
    tile: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 50,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.warmSoftBorder,
      backgroundColor: colors.surfaceElevated,
    },
  }),
);
