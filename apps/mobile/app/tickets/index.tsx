import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { RefundBadge } from '@/components/ui/EventCard';
import { Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useMyTickets } from '@/hooks/useTickets';
import { Ticket } from '@/lib/api/mappers';
import { formatDateTime } from '@/lib/format';

/** Every ticket they've bought, one entry per event however many times they bought for it. */
export default function MyTicketsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const tickets = useMyTickets();
  // The ticket screen swipes through all of an event's tickets, from every purchase.
  const byEvent = Object.values(
    (tickets.data ?? []).reduce<Record<string, Ticket[]>>((groups, ticket) => {
      (groups[ticket.eventId] ??= []).push(ticket);
      return groups;
    }, {}),
  );

  return (
    <Screen refreshable>
      <QueryState query={tickets} hasData={!!tickets.data} />
      {tickets.data?.length === 0 && <EmptyState message={t('tickets.noTickets')} />}
      {byEvent.map((group) => {
        const live = group.find((item) => item.status === 'valid');
        // Open on one that still gets them in, if any.
        const ticket = live ?? group[0];
        const refundable = group.find((item) => item.canRefund);
        // They were there and haven't said how it was yet.
        const toRate = group.some((item) => item.canRate) && !group.some((item) => item.rating);
        const opens = toRate ? group.find((item) => item.canRate)! : ticket;
        // "2 × Regular, 1 × VIP": purchases of different types add up per type.
        const tiers = Object.entries(
          group.reduce<Record<string, number>>((counts, item) => {
            counts[item.tierName] = (counts[item.tierName] ?? 0) + 1;
            return counts;
          }, {}),
        )
          .map(([name, count]) => (group.length > 1 ? `${count} × ${name}` : name))
          .join(', ');
        return (
          <Pressable
            key={ticket.eventId}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/tickets/[id]', params: { id: opens.id } })}
            style={styles.ticket}>
            <TasaText variant="bodyMedium" color={colors.heading} numberOfLines={1}>
              {ticket.eventTitle}
            </TasaText>
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
              {tiers}
              {ticket.startsAt ? ` · ${formatDateTime(ticket.startsAt)}` : ''}
            </TasaText>
            {live ? (
              <View style={styles.badge}>
                <RefundBadge refundDays={0} until={refundable?.refundableUntil} />
              </View>
            ) : (
              <TasaText variant="caption" color={colors.inkSubtle}>
                {t(`tickets.status.${ticket.status}`)}
              </TasaText>
            )}
            {toRate && (
              <View style={styles.rate}>
                <Icon ios="star.fill" android="star" color={colors.accentHot} size={14} />
                <TasaText variant="caption" color={colors.accentHot}>
                  {ticket.organiser ? t('tickets.rateOrganiser', { name: ticket.organiser }) : t('tickets.rateEvent')}
                </TasaText>
              </View>
            )}
          </Pressable>
        );
      })}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    ticket: {
      gap: 4,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    badge: {
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    rate: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
    },
  }),
);
