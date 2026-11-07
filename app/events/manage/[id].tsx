import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { EventPoster, RefundBadge } from '@/components/ui/EventCard';
import { EventGallery } from '@/components/ui/EventGallery';
import { PurchaseRow, TierProgress } from '@/components/ui/EventSales';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useEventGallery, useEventImage, useEventSales, useEventStaff, useManagedEvent, useUpdateEvent } from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';
import { OwnerEvent } from '@/lib/api/mappers';
import { formatDateTime, formatNaira } from '@/lib/format';

/** Matches the API's limit. */
const GALLERY_MAX = 12;
/** Purchases shown here; the rest are on the sales page. */
const RECENT = 3;

export default function ManageEventScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useManagedEvent(id);
  const update = useUpdateEvent(id);
  const staff = useEventStaff(id);
  const poster = useEventImage(id);
  const gallery = useEventGallery(id);
  const { show } = useSnackbar();
  const [username, setUsername] = useState('');
  const event = query.data;

  const pickPoster = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    poster.mutate(result.assets[0].uri, {
      onSuccess: () => show(t('tickets.posterSaved')),
      onError: (error) => show(errorMessage(error), { tone: 'error' }),
    });
  };

  const pickMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8, videoMaxDuration: 120 });
    if (result.canceled || !result.assets[0]) return;
    gallery.add.mutate(result.assets[0].uri, {
      onSuccess: () => show(t('tickets.mediaAdded')),
      onError: (error) => show(errorMessage(error), { tone: 'error' }),
    });
  };

  const share = () =>
    event &&
    Share.share({
      message: t('tickets.shareMessage', {
        title: event.title,
        date: formatDateTime(event.startsAt),
        code: event.code,
      }),
    });

  return (
    <Screen refreshable>
      <QueryState query={query} hasData={!!event} skeleton="detail" />
      {event && (
        <>
          {!!event.imageUrl && <EventPoster uri={event.imageUrl} />}
          <TasaText variant="title" color={colors.heading}>
            {event.title}
          </TasaText>
          <TasaText variant="body" color={colors.inkMuted}>
            {formatDateTime(event.startsAt)} · {event.venue}
          </TasaText>
          <View style={styles.badge}>
            <RefundBadge refundDays={event.refundDays} />
          </View>

          <Card style={styles.stats}>
            <Stat label={t('tickets.sold')} value={String(event.sold)} />
            <Stat label={t('tickets.gross')} value={formatNaira(event.gross)} />
            <Stat label={t('tickets.checkedIn')} value={String(event.checkedIn)} />
          </Card>

          <Button
            label={t('tickets.scanTickets')}
            onPress={() => router.push({ pathname: '/events/scan/[id]', params: { id } })}
          />
          <Button label={t('tickets.share')} variant="secondary" style={styles.gap} onPress={share} />
          <Button
            label={t(event.imageUrl ? 'tickets.changePoster' : 'tickets.addPoster')}
            variant="secondary"
            loading={poster.isPending}
            style={styles.gap}
            onPress={pickPoster}
          />

          <SectionHeader title={t('tickets.activityTitle')} />
          <SalesActivity eventId={id} />

          <SectionHeader title={t('tickets.gallery')} />
          <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
            {t('tickets.galleryManageHint', { count: GALLERY_MAX })}
          </TasaText>
          <EventGallery
            items={event.gallery}
            onRemove={(item) =>
              gallery.remove.mutate(item.id, { onError: (error) => show(errorMessage(error), { tone: 'error' }) })
            }
          />
          {event.gallery.length < GALLERY_MAX && (
            <Button
              label={gallery.add.isPending ? t('tickets.uploadingMedia') : t('tickets.addMedia')}
              variant="secondary"
              loading={gallery.add.isPending}
              style={styles.gap}
              onPress={pickMedia}
            />
          )}

          <SectionHeader title={t('tickets.salesTitle')} />
          {event.adminPaused ? (
            <TasaText variant="body" color={colors.danger}>
              {t('tickets.adminPaused')}
            </TasaText>
          ) : (
            <Button
              label={event.salesPaused ? t('tickets.resumeSales') : t('tickets.pauseSales')}
              variant="secondary"
              loading={update.isPending}
              onPress={() => update.mutate({ salesPaused: !event.salesPaused })}
            />
          )}
          {event.tiers.map((tier) => (
            <TierRow key={tier.id} tier={tier} eventId={id} />
          ))}

          <SectionHeader title={t('tickets.doorStaff')} />
          <TasaText variant="caption" color={colors.inkMuted} style={styles.hint}>
            {t('tickets.doorStaffHint')}
          </TasaText>
          {event.staff.map((person) => (
            <View key={person.id} style={styles.row}>
              <TasaText variant="bodyMedium" style={styles.flex}>
                {person.username ? `@${person.username}` : person.name}
              </TasaText>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => staff.remove.mutate(person.id)}>
                <TasaText variant="caption" color={colors.danger}>
                  {t('tickets.remove')}
                </TasaText>
              </Pressable>
            </View>
          ))}
          <Input
            label={t('tickets.staffUsername')}
            autoCapitalize="none"
            autoCorrect={false}
            last
            error={staff.add.isError ? errorMessage(staff.add.error) : null}
            value={username}
            onChangeText={setUsername}
          />
          <Button
            disabled={username.trim().length < 2}
            label={t('tickets.addStaff')}
            variant="secondary"
            loading={staff.add.isPending}
            onPress={() => staff.add.mutate(username.trim(), { onSuccess: () => setUsername('') })}
          />
        </>
      )}
    </Screen>
  );
}

/**
 * Who's bought what, kept to a fixed size however busy the event gets: how far each ticket type
 * has sold and the latest few purchases. Everything else is on the sales page.
 */
function SalesActivity({ eventId }: { eventId: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const sales = useEventSales(eventId);
  const data = sales.data;

  return (
    <>
      <QueryState query={sales} hasData={!!data} quiet />
      {data && (
        <Card style={styles.activity}>
          <TierProgress tiers={data.byTier} />
          {data.purchases.length === 0 ? (
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('tickets.noPurchases')}
            </TasaText>
          ) : (
            <View style={styles.purchases}>
              {data.purchases.slice(0, RECENT).map((row) => (
                <PurchaseRow key={row.id} row={row} />
              ))}
              {data.purchases.length > RECENT && (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => router.push({ pathname: '/events/sales/[id]', params: { id: eventId } })}
                  style={styles.seeAll}>
                  <TasaText variant="caption" color={colors.brand}>
                    {t('tickets.showAllPurchases', { count: data.purchases.length })}
                  </TasaText>
                  <Icon ios="chevron.right" android="chevron_right" color={colors.brand} size={14} />
                </Pressable>
              )}
            </View>
          )}
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <TasaText variant="subtitle" color={colors.heading} numberOfLines={1}>
        {value}
      </TasaText>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
    </View>
  );
}

/** How many of a ticket have sold, and the optional limit on how many can. */
function TierRow({ tier, eventId }: { tier: OwnerEvent['tiers'][number]; eventId: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const update = useUpdateEvent(eventId);
  const [limit, setLimit] = useState(tier.limit === null ? '' : String(tier.limit));
  const next = Number(limit) > 0 ? Number(limit) : null;
  return (
    <Card style={styles.tier}>
      <View style={styles.row}>
        <TasaText variant="bodyMedium" style={styles.flex}>
          {tier.name} · {formatNaira(tier.price)}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('tickets.soldOf', { sold: tier.sold, total: tier.limit ?? '∞' })}
        </TasaText>
      </View>
      {!!tier.covers && (
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('tickets.includes', { what: tier.covers })}
        </TasaText>
      )}
      <Input
        label={t('tickets.limit')}
        hint={t('tickets.limitHint')}
        keyboardType="number-pad"
        last
        error={update.isError ? errorMessage(update.error) : null}
        value={limit}
        onChangeText={(text) => setLimit(text.replace(/\D/g, ''))}
      />
      {next !== tier.limit && (
        <Button
          label={t('tickets.saveLimit')}
          variant="secondary"
          loading={update.isPending}
          onPress={() => update.mutate({ limits: [{ tierId: tier.id, limit: next }] })}
        />
      )}
    </Card>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    badge: {
      alignSelf: 'flex-start',
      marginTop: theme.spacing.xs,
    },
    stats: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.md,
    },
    stat: {
      flex: 1,
      gap: 2,
    },
    gap: {
      marginTop: theme.spacing.sm,
    },
    hint: {
      marginBottom: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    flex: {
      flex: 1,
    },
    tier: {
      gap: theme.spacing.xs,
      marginTop: theme.spacing.sm,
    },
    activity: {
      gap: theme.spacing.md,
    },
    seeAll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
    },
    purchases: {
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  }),
);
