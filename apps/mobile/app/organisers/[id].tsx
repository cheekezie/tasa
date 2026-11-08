import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { CallOrganiser, EmailOrganiser, EventCard, OrganiserStats, VerifiedTick } from '@/components/ui/EventCard';
import { Icon, IconName } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useOrganiser } from '@/hooks/useTickets';
import { formatDate } from '@/lib/format';

/**
 * Who's behind an event: their logo and story, how to reach them, their record, and what else they're running.
 * Opened by the organiser themselves it reads as theirs: the same page, with ways to change it.
 */
export default function OrganiserScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useOrganiser(id);
  const organiser = query.data;
  const contact = organiser?.contact;
  const mine = !!organiser?.mine;
  const hasContact = !!(contact?.phone || contact?.email || contact?.website || contact?.instagram);

  return (
    <Screen refreshable>
      <QueryState query={query} hasData={!!organiser} skeleton="detail" />
      {organiser && (
        <>
          {mine && <YourPage />}
          <View style={styles.hero}>
            {organiser.logoUrl ? (
              <Image source={organiser.logoUrl} contentFit="cover" style={styles.logo} />
            ) : (
              <View style={[styles.logo, styles.logoEmpty]}>
                <TasaText variant="display" color={colors.brand}>
                  {organiser.name.charAt(0).toUpperCase()}
                </TasaText>
              </View>
            )}
            <TasaText variant="title" color={colors.heading} style={styles.centered}>
              {organiser.name}
            </TasaText>
            {organiser.verified && (
              <View style={styles.verified}>
                <VerifiedTick size={14} />
                <TasaText variant="caption" color={colors.brand}>
                  {t('tickets.verifiedOrganiser')}
                </TasaText>
              </View>
            )}
            <OrganiserStats organiser={organiser} />
            <TasaText variant="caption" color={colors.inkSubtle}>
              {t('tickets.sellingSince', { date: formatDate(organiser.since) })}
            </TasaText>
          </View>

          {!!organiser.about && (
            <>
              <SectionHeader title={t(mine ? 'tickets.aboutYou' : 'tickets.aboutOrganiser')} />
              <TasaText variant="body">{organiser.about}</TasaText>
            </>
          )}
          {mine && !organiser.about && <AddPrompt title={t(mine ? 'tickets.aboutYou' : 'tickets.aboutOrganiser')} message={t('tickets.aboutAdd')} />}

          {mine && !hasContact && <AddPrompt title={t('tickets.contactYours')} message={t('tickets.contactAdd')} />}
          {hasContact && (
            <>
              <SectionHeader title={t(mine ? 'tickets.contactYours' : 'tickets.contactOrganiser')} />
              <Card style={styles.contacts}>
                {!!contact.phone && <CallOrganiser phone={contact.phone} />}
                {!!contact.email && <EmailOrganiser email={contact.email} />}
                {!!contact.website && (
                  <ContactRow
                    icon={{ ios: 'globe', android: 'language' }}
                    label={contact.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                    url={contact.website}
                  />
                )}
                {!!contact.instagram && (
                  <ContactRow
                    icon={{ ios: 'camera', android: 'photo_camera' }}
                    label={`@${contact.instagram}`}
                    url={`https://instagram.com/${contact.instagram}`}
                  />
                )}
              </Card>
            </>
          )}

          <SectionHeader title={t(mine ? 'tickets.yourUpcoming' : 'tickets.organiserEvents')} />
          {organiser.upcoming.length === 0 &&
            (mine ? (
              <Card style={styles.prompt}>
                <TasaText variant="caption" color={colors.inkMuted}>
                  {t('tickets.noYourEvents')}
                </TasaText>
                <Button label={t('tickets.createEvent')} onPress={() => router.push('/events/create')} />
              </Card>
            ) : (
              <EmptyState message={t('tickets.noOrganiserEvents')} />
            ))}
          {organiser.upcoming.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </>
      )}
    </Screen>
  );
}

/** At the top of their own page: whose it is, and where to change it. */
function YourPage() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <Card style={styles.yours}>
      <View style={styles.yoursHeading}>
        <Icon ios="person.crop.circle.badge.checkmark" android="badge" color={colors.brand} size={18} />
        <TasaText variant="bodyMedium" color={colors.heading}>
          {t('tickets.yourPage')}
        </TasaText>
      </View>
      <TasaText variant="caption" color={colors.inkMuted}>
        {t('tickets.yourPageBody')}
      </TasaText>
      <View style={styles.yoursActions}>
        <Button label={t('tickets.editProfile')} variant="secondary" onPress={() => router.push('/events/profile')} style={styles.yoursAction} />
        <Button label={t('tickets.manageEvents')} onPress={() => router.push('/events/selling')} style={styles.yoursAction} />
      </View>
    </Card>
  );
}

/** Something buyers would see that they haven't filled in yet, with a way to add it. */
function AddPrompt({ title, message }: { title: string; message: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <>
      <SectionHeader title={title} />
      <Pressable accessibilityRole="button" onPress={() => router.push('/events/profile')} style={styles.addPrompt}>
        <Icon ios="plus.circle" android="add_circle" color={colors.brand} size={16} />
        <TasaText variant="caption" color={colors.inkMuted} style={styles.addPromptText}>
          {message}
        </TasaText>
        <TasaText variant="caption" color={colors.brand}>
          {t('tickets.editProfile')}
        </TasaText>
      </Pressable>
    </>
  );
}

function ContactRow({ icon, label, url }: { icon: IconName; label: string; url: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} hitSlop={8} onPress={() => Linking.openURL(url)} style={styles.contact}>
      <Icon {...icon} color={colors.brand} size={14} />
      <TasaText variant="caption" color={colors.brand}>
        {label}
      </TasaText>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hero: {
      alignItems: 'center',
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    logo: {
      width: 96,
      height: 96,
      borderRadius: theme.radius.lg,
      backgroundColor: colors.track,
      marginBottom: theme.spacing.xs,
    },
    logoEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.brand}14`,
    },
    centered: {
      textAlign: 'center',
    },
    verified: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    contacts: {
      gap: theme.spacing.xs,
    },
    yours: {
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.md,
      borderColor: `${colors.brand}33`,
      backgroundColor: `${colors.brand}0D`,
    },
    yoursHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    yoursActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    yoursAction: {
      flex: 1,
    },
    addPrompt: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
    },
    addPromptText: {
      flex: 1,
    },
    prompt: {
      gap: theme.spacing.sm,
    },
    contact: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      marginTop: theme.spacing.xs,
    },
  }),
);
