import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Button';
import { EventCard } from '@/components/ui/EventCard';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useEvents, useMyEvents, useMyTickets, useSeller } from '@/hooks/useTickets';
import { Seller, Ticket } from '@/lib/api/mappers';
import { formatDateTime, formatNaira } from '@/lib/format';

/**
 * Tickets, from Home: the next event they're going to, their own events if they organise (or
 * the way in if they don't), then everything on sale to discover. Their tickets have their own page.
 */
export default function EventsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const navigation = useNavigation();
  const [search, setSearch] = useState('');
  const events = useEvents(search.trim());
  const { data: seller } = useSeller();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/tickets')} style={styles.headerAction}>
          <TasaText variant="caption" color={colors.brand}>
            {t('tickets.myTickets')}
          </TasaText>
        </Pressable>
      ),
    });
  }, [navigation, t, colors.brand, styles.headerAction]);

  return (
    <Screen refreshable>
      <NextEvent />
      {seller?.optedIn ? <YourSelling seller={seller} /> : seller && <BecomeOrganiser />}

      <SectionHeader title={t('tickets.discover')} />
      <Input label={t('tickets.search')} placeholder={t('tickets.searchHint')} autoCorrect={false} value={search} onChangeText={setSearch} />
      <QueryState query={events} hasData={!!events.data} skeleton="cards" />
      {events.data?.length === 0 && <EmptyState message={t('tickets.noEvents')} />}
      {events.data?.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </Screen>
  );
}

/** Tickets that still get them in to something ahead, one group per event, soonest first. */
function upcomingByEvent(tickets: Ticket[]) {
  const now = new Date().toISOString();
  const groups = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    if (ticket.status !== 'valid' || !ticket.startsAt || ticket.startsAt <= now) continue;
    groups.set(ticket.eventId, [...(groups.get(ticket.eventId) ?? []), ticket]);
  }
  return [...groups.values()].sort((a, b) => a[0].startsAt!.localeCompare(b[0].startsAt!));
}

/** The event they're going to next, front and centre. Nothing when there's none. */
function NextEvent() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { data: tickets = [] } = useMyTickets();
  const [next, ...later] = upcomingByEvent(tickets);
  if (!next) return null;
  const [ticket] = next;
  const when = new Date(ticket.startsAt!);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('tickets.yourNextEvent')}: ${ticket.eventTitle}. ${t('tickets.showTicket')}`}
        onPress={() => router.push({ pathname: '/tickets/[id]', params: { id: ticket.id } })}>
        <LinearGradient colors={['#C2410C', '#F97316']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.next}>
          <View style={styles.nextRow}>
            <View style={styles.dateTile}>
              <TasaText variant="caption" color="#FFFFFF">
                {new Intl.DateTimeFormat('en-NG', { month: 'short' }).format(when).toUpperCase()}
              </TasaText>
              <TasaText variant="title" color="#FFFFFF">
                {when.getDate()}
              </TasaText>
            </View>
            <View style={styles.nextCopy}>
              <TasaText variant="caption" color="rgba(255,255,255,0.8)">
                {t('tickets.yourNextEvent')}
              </TasaText>
              <TasaText variant="subtitle" color="#FFFFFF" numberOfLines={2}>
                {ticket.eventTitle}
              </TasaText>
              <TasaText variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>
                {[formatDateTime(ticket.startsAt!), ticket.venue].filter(Boolean).join(' · ')}
              </TasaText>
            </View>
          </View>
          <View style={styles.nextFooter}>
            <TasaText variant="caption" color="rgba(255,255,255,0.8)">
              {next.length > 1 ? t('tickets.ticketCount', { count: next.length }) : ticket.tierName}
            </TasaText>
            <View style={styles.nextAction}>
              <TasaText variant="bodyMedium" color="#FFFFFF">
                {t('tickets.showTicket')}
              </TasaText>
              <Icon ios="arrow.right" android="arrow_forward" color="#FFFFFF" size={14} />
            </View>
          </View>
        </LinearGradient>
      </Pressable>
      {later.length > 0 && (
        <Pressable accessibilityRole="link" hitSlop={4} onPress={() => router.push('/tickets')} style={styles.more}>
          <TasaText variant="caption" color={colors.brand}>
            {t('tickets.moreUpcoming', { count: later.length })}
          </TasaText>
        </Pressable>
      )}
    </View>
  );
}

/** For organisers: where their events and money are, at a glance. */
function YourSelling({ seller }: { seller: Seller }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { data } = useMyEvents();
  const count = data?.owned.length;
  const summary = [
    seller.wallet && t('tickets.toWithdraw', { amount: formatNaira(seller.wallet.available) }),
    count !== undefined && t('tickets.eventCount', { count }),
  ].filter(Boolean);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/events/selling')}>
      <Card style={styles.row}>
        <View style={styles.rowIcon}>
          <Icon ios="chart.line.uptrend.xyaxis" android="trending_up" color={colors.accentHot} size={20} />
        </View>
        <View style={styles.rowCopy}>
          <TasaText variant="bodyMedium">{t('tickets.manageSelling')}</TasaText>
          {summary.length > 0 && (
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
              {summary.join(' · ')}
            </TasaText>
          )}
        </View>
        <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
      </Card>
    </Pressable>
  );
}

/** For everyone else: the way into selling tickets. */
function BecomeOrganiser() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/events/selling')}>
      <Card style={styles.row}>
        <View style={styles.rowIcon}>
          <Icon ios="megaphone.fill" android="campaign" color={colors.accentHot} size={20} />
        </View>
        <View style={styles.rowCopy}>
          <TasaText variant="bodyMedium">{t('tickets.becomeOrganiser')}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('tickets.bannerBody')}
          </TasaText>
        </View>
        <Icon ios="chevron.right" android="chevron_right" color={colors.inkMuted} size={16} />
      </Card>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    headerAction: {
      paddingHorizontal: 6,
    },
    next: {
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
    },
    nextRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    dateTile: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 54,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: theme.radius.md,
      backgroundColor: 'rgba(255,255,255,0.16)',
    },
    nextCopy: {
      flex: 1,
      gap: 2,
    },
    nextFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.3)',
    },
    nextAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    more: {
      alignSelf: 'flex-start',
      paddingTop: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: theme.spacing.md,
    },
    rowIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: `${colors.accentHot}1A`,
    },
    rowCopy: {
      flex: 1,
      gap: 2,
    },
  }),
);
