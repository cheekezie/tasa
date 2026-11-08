import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ComponentRef, useLayoutEffect, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Button } from '@/components/ui/Button';
import { CallOrganiser, EmailOrganiser, RefundBadge } from '@/components/ui/EventCard';
import { Icon } from '@/components/ui/Icon';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { TicketPass } from '@/components/ui/TicketPass';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useMyTickets, useRateEvent, useRefundTicket } from '@/hooks/useTickets';
import { Ticket } from '@/lib/api/mappers';
import { errorMessage } from '@/lib/api/errors';
import { formatNaira } from '@/lib/format';

/** Every ticket they hold for one event, swiped through at the door: each has its own QR code. */
export default function TicketScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useMyTickets();
  const pageWidth = useWindowDimensions().width - theme.spacing.screen * 2;
  const opened = query.data?.find((ticket) => ticket.id === id);
  const group = (query.data ?? [])
    // Every ticket they hold for this event, from every purchase, oldest first.
    .filter((ticket) => ticket.eventId === opened?.eventId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const [page, setPage] = useState<number | null>(null);
  const index = page ?? Math.max(0, group.findIndex((ticket) => ticket.id === id));
  const active = group[index];
  const rateable = group.find((ticket) => ticket.canRate);
  const refund = useRefundTicket(active?.id ?? id);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const passes = useRef<Record<string, ComponentRef<typeof View> | null>>({});
  const navigation = useNavigation();

  // From a ticket to what else is on, without going back through Home.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/events')} style={styles.headerAction}>
          <TasaText variant="caption" color={colors.brand}>
            {t('tickets.exploreEvents')}
          </TasaText>
        </Pressable>
      ),
    });
  }, [navigation, t, colors.brand, styles.headerAction]);

  const onPageChange = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(nativeEvent.contentOffset.x / pageWidth);
    if (next === index) return;
    setPage(next);
    setConfirming(false);
    refund.reset();
  };

  const save = async () => {
    const pass = passes.current[active.id];
    if (!pass) return;
    setSaving(true);
    try {
      const { granted } = await requestPermissionsAsync(true);
      if (!granted) {
        show(t('tickets.saveDenied'), { tone: 'error' });
        return;
      }
      await Asset.create(await captureRef(pass, { format: 'png', quality: 1 }));
      show(t('tickets.saved'));
    } catch {
      show(t('tickets.saveFailed'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen refreshable>
      <QueryState query={query} hasData={!!query.data} skeleton="detail" />
      {query.data && !active && (
        <TasaText variant="body" color={colors.inkMuted}>
          {t('tickets.notFound')}
        </TasaText>
      )}
      {active && (
        <>
          <FlatList
            horizontal
            pagingEnabled
            data={group}
            keyExtractor={(ticket) => ticket.id}
            extraData={group.length}
            initialScrollIndex={index}
            getItemLayout={(_, item) => ({ length: pageWidth, offset: pageWidth * item, index: item })}
            onMomentumScrollEnd={onPageChange}
            showsHorizontalScrollIndicator={false}
            scrollEnabled={group.length > 1}
            renderItem={({ item, index: position }) => (
              <View style={{ width: pageWidth }}>
                <TicketPass
                  ref={(view) => {
                    passes.current[item.id] = view;
                  }}
                  ticket={item}
                  position={
                    group.length > 1
                      ? t('tickets.position', { current: position + 1, total: group.length })
                      : undefined
                  }
                />
              </View>
            )}
          />

          {group.length > 1 && (
            <>
              <View style={styles.dots}>
                {group.map((ticket, dot) => (
                  <View key={ticket.id} style={[styles.dot, dot === index && styles.dotActive]} />
                ))}
              </View>
              <TasaText variant="caption" color={colors.inkMuted} style={styles.centered}>
                {t('tickets.swipeHint')}
              </TasaText>
            </>
          )}

          {active.status === 'valid' && (
            <View style={styles.badge}>
              <RefundBadge refundDays={0} until={active.canRefund ? active.refundableUntil : null} />
            </View>
          )}

          {(!!active.phone || !!active.email) && (
            <View style={styles.contacts}>
              {!!active.phone && <CallOrganiser phone={active.phone} />}
              {!!active.email && <EmailOrganiser email={active.email} />}
            </View>
          )}

          {/* A rating is for the event, so it shows on every ticket once any of theirs was scanned. */}
          {!!rateable && <RateEvent ticket={rateable} />}

          {active.status === 'valid' && (
            <Button
              label={t('tickets.save')}
              variant="secondary"
              loading={saving}
              style={styles.actions}
              onPress={save}
            />
          )}

          {active.canRefund &&
            (confirming ? (
              <View style={styles.actions}>
                <TasaText variant="body" color={colors.inkMuted}>
                  {t('tickets.refundConfirm', { amount: formatNaira(active.price) })}
                </TasaText>
                <Button
                  label={t('tickets.refundYes')}
                  loading={refund.isPending}
                  onPress={() => refund.mutate(undefined, { onSuccess: () => setConfirming(false) })}
                />
                <Button label={t('tickets.refundNo')} variant="ghost" onPress={() => setConfirming(false)} />
              </View>
            ) : (
              <Button
                label={t('tickets.refund')}
                variant="ghost"
                style={styles.actions}
                onPress={() => setConfirming(true)}
              />
            ))}
          {refund.isError && (
            <TasaText variant="caption" color={colors.danger} style={styles.actions}>
              {errorMessage(refund.error)}
            </TasaText>
          )}
        </>
      )}
    </Screen>
  );
}

/** Once they've been scanned in, the stars count towards the organiser's rating. Tapping again changes it. */
function RateEvent({ ticket }: { ticket: Ticket }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { show } = useSnackbar();
  const rate = useRateEvent(ticket.eventId);
  const stars = rate.isPending ? rate.variables : ticket.rating;
  return (
    <View style={styles.rating}>
      <TasaText variant="bodyMedium" color={colors.heading}>
        {t(ticket.rating ? 'tickets.yourRating' : 'tickets.rateEvent')}
      </TasaText>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={t('tickets.rateStars', { count: value })}
            accessibilityState={{ selected: !!stars && value <= stars }}
            disabled={rate.isPending}
            hitSlop={4}
            onPress={() =>
              rate.mutate(value, {
                onSuccess: () => show(t('tickets.ratingSaved')),
                onError: (error) => show(errorMessage(error), { tone: 'error' }),
              })
            }>
            <Icon
              color={stars && value <= stars ? colors.warning : colors.inkSubtle}
              ios={stars && value <= stars ? 'star.fill' : 'star'}
              android="star"
              size={30}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    headerAction: {
      paddingHorizontal: 6,
    },
    contacts: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    rating: {
      alignItems: 'center',
      gap: theme.spacing.xs,
      marginTop: theme.spacing.lg,
    },
    stars: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    centered: {
      textAlign: 'center',
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xs,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.track,
    },
    dotActive: {
      backgroundColor: colors.brand,
    },
    badge: {
      alignSelf: 'center',
      marginTop: theme.spacing.md,
    },
    actions: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
  }),
);
