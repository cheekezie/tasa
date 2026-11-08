import { Image } from 'expo-image';
import { Href, router } from 'expo-router';
import { Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Icon, IconName } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { Event } from '@/lib/api/mappers';
import { OrganiserDto } from '@/lib/api/types';
import { formatDate, formatDateTime, formatNaira } from '@/lib/format';
import { minKobo } from '@/lib/money';

/** One event in a list. `href` is where tapping goes: the buyer's page unless given another. */
export function EventCard({ event, href }: { event: Event; href?: Href }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const from = minKobo(...event.tiers.map((tier) => tier.price));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href ?? `/events/${event.id}`)}
      style={styles.card}>
      {!!event.imageUrl && <Image source={event.imageUrl} contentFit="cover" style={styles.poster} />}
      <TasaText variant="bodyMedium" color={colors.heading} numberOfLines={1}>
        {event.title}
      </TasaText>
      <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
        {formatDateTime(event.startsAt)} · {event.venue}
      </TasaText>
      <OrganiserLine organiser={event.organiser} />
      <View style={styles.footer}>
        <TasaText variant="caption" color={colors.brand}>
          {t('tickets.from', { amount: formatNaira(from) })}
        </TasaText>
        <RefundBadge refundDays={event.refundDays} />
      </View>
    </Pressable>
  );
}

/**
 * An event's poster across the whole screen width. Sized in points: a percentage width with
 * an aspect ratio lets the image shrink to whatever it loads at.
 */
export function EventPoster({ uri }: { uri: string }) {
  const styles = useStyles();
  const width = useWindowDimensions().width - theme.spacing.screen * 2;
  return <Image source={uri} contentFit="cover" style={[styles.heroPoster, { width, height: (width * 9) / 16 }]} />;
}

/** Who runs it, how many events they've run, and what people who went thought of them. */
export function OrganiserLine({ organiser }: { organiser: OrganiserDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.organiser}>
      {!!organiser.logoUrl && <Image source={organiser.logoUrl} contentFit="cover" style={styles.organiserLogo} />}
      <TasaText variant="caption" color={colors.heading} numberOfLines={1} style={styles.organiserName}>
        {organiser.name}
      </TasaText>
      {organiser.verified && <VerifiedTick />}
      <OrganiserStats organiser={organiser} />
    </View>
  );
}

/** A small tick after an organiser's name once Tasa has checked who they are. */
export function VerifiedTick({ size = 12 }: { size?: number }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View accessible accessibilityLabel={t('tickets.verifiedOrganiser')}>
      <Icon color={colors.brand} ios="checkmark.seal.fill" android="verified" size={size} />
    </View>
  );
}

/**
 * Where an organiser stands with Tasa, for their own screens: approved, under review, not
 * approved, not sent yet, or suspended (which outranks the rest).
 */
export function ApprovalStatus({ status, suspended }: { status: 'unsubmitted' | 'pending' | 'approved' | 'rejected'; suspended?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const tone = suspended || status === 'rejected' ? colors.danger : status === 'approved' ? colors.success : status === 'pending' ? colors.warning : colors.inkMuted;
  const label = suspended
    ? t('tickets.statusSuspended')
    : t(
        status === 'approved'
          ? 'tickets.statusApproved'
          : status === 'pending'
            ? 'tickets.statusPending'
            : status === 'rejected'
              ? 'tickets.statusRejected'
              : 'tickets.statusUnsubmitted',
      );
  return (
    <View style={[styles.status, { backgroundColor: `${tone}1F` }]}>
      {status === 'approved' && !suspended && <Icon color={tone} ios="checkmark.seal.fill" android="verified" size={12} />}
      <TasaText variant="caption" color={tone}>
        {label}
      </TasaText>
    </View>
  );
}

/** How many events they've run and their average rating, so buyers know who they're trusting. */
export function OrganiserStats({ organiser }: { organiser: OrganiserDto }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.organiser}>
      <View style={styles.stat}>
        <Icon color={colors.inkMuted} ios="calendar" android="calendar_today" size={12} />
        <TasaText variant="caption" color={colors.inkMuted}>
          {t(organiser.events === 1 ? 'tickets.eventsOne' : 'tickets.eventsMany', { count: organiser.events })}
        </TasaText>
      </View>
      <View style={styles.stat}>
        <Icon color={colors.warning} ios="star.fill" android="star" size={12} />
        <TasaText variant="caption" color={colors.inkMuted}>
          {organiser.rating === null
            ? t('tickets.noRatings')
            : t('tickets.ratingLine', { rating: organiser.rating.toFixed(1), count: organiser.ratings })}
        </TasaText>
      </View>
    </View>
  );
}

/** Rings the organiser, for questions about the event. */
export function CallOrganiser({ phone }: { phone: string }) {
  const t = useT();
  return (
    <ContactLink
      icon={{ ios: 'phone.fill', android: 'call' }}
      label={t('tickets.call', { phone })}
      url={`tel:${phone}`}
    />
  );
}

/** Writes to the organiser, for questions about the event. */
export function EmailOrganiser({ email }: { email: string }) {
  return <ContactLink icon={{ ios: 'envelope.fill', android: 'mail' }} label={email} url={`mailto:${email}`} />;
}

function ContactLink({ icon, label, url }: { icon: IconName; label: string; url: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => Linking.openURL(url)}
      style={styles.call}>
      <Icon {...icon} color={colors.brand} size={14} />
      <TasaText variant="caption" color={colors.brand}>
        {label}
      </TasaText>
    </Pressable>
  );
}

/** Always visible before paying, so nobody buys without knowing whether they can cancel. */
export function RefundBadge({ refundDays, until }: { refundDays: number; until?: string | null }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const refundable = refundDays > 0 || !!until;
  return (
    <View style={[styles.badge, { backgroundColor: refundable ? `${colors.success}22` : colors.overlay }]}>
      <TasaText variant="caption" color={refundable ? colors.success : colors.inkMuted}>
        {until
          ? t('tickets.refundableUntil', { date: formatDate(until) })
          : refundDays > 0
            ? t(refundDays === 1 ? 'tickets.refundableDayOne' : 'tickets.refundableDayMany', { count: refundDays })
            : t('tickets.noRefunds')}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      gap: 4,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    poster: {
      width: '100%',
      aspectRatio: 16 / 9,
      marginBottom: theme.spacing.xs,
      borderRadius: theme.radius.md,
      backgroundColor: colors.track,
    },
    heroPoster: {
      marginBottom: theme.spacing.md,
      borderRadius: theme.radius.lg,
      backgroundColor: colors.track,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
      marginTop: 4,
    },
    organiser: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: theme.spacing.sm,
      rowGap: 2,
    },
    organiserLogo: {
      width: 18,
      height: 18,
      borderRadius: 5,
      backgroundColor: colors.track,
    },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: theme.radius.pill,
    },
    organiserName: {
      flexShrink: 1,
    },
    stat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    call: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      marginTop: theme.spacing.xs,
    },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: theme.radius.pill,
    },
  }),
);
