import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { CheckoutFailureView } from '@/components/ui/CheckoutFailureView';
import { EventGallery } from '@/components/ui/EventGallery';
import { CallOrganiser, EmailOrganiser, EventPoster, OrganiserStats, RefundBadge } from '@/components/ui/EventCard';
import { Icon, IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PinSheet } from '@/components/ui/PinSheet';
import { QueryState } from '@/components/ui/QueryState';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount } from '@/hooks/useAccount';
import { useCheckout } from '@/hooks/useCheckout';
import { useEvent } from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';
import { ticketsService } from '@/lib/api/services/tickets';
import { formatDateTime, formatNaira } from '@/lib/format';
import { timesKobo } from '@/lib/money';
import { queryClient, queryKeys } from '@/lib/queryClient';
import { FeaturePaused } from '@/components/ui/FeatureGate';
import { useFeature } from '@/hooks/useAppConfig';

const MAX_PER_ORDER = 10;

export default function EventScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useEvent(id);
  const event = query.data;
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tickets.seeAllEvents')}
          hitSlop={8}
          onPress={() => router.push('/events')}
          style={styles.headerAction}>
          <TasaText variant="caption" color={colors.brand}>
            {t('tickets.seeAllEvents')}
          </TasaText>
        </Pressable>
      ),
    });
  }, [navigation, t, colors.brand, styles.headerAction]);
  const [picked, setPicked] = useState<string | null>(null);
  // Ready to buy on arrival: the first ticket type still on sale, until they pick another.
  const tierId =
    picked ?? (event?.sales === 'on_sale' ? (event.tiers.find((item) => item.remaining !== 0)?.id ?? null) : null);
  const [quantity, setQuantity] = useState(1);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  // What they typed per ticket; the first starts as their own name until they change it.
  const [holders, setHolders] = useState<(string | undefined)[]>([]);
  const myName = useAccount().profile.fullName.trim();
  const holderNames = Array.from({ length: quantity }, (_, index) => holders[index] ?? (index === 0 ? myName : ''));
  // Every ticket carries a name; the door checks it.
  const namesReady = holderNames.every((name) => name.trim().length >= 2);
  // Read at payment time, so typing a name doesn't rebuild the checkout.
  const names = useRef(holderNames);
  useEffect(() => {
    names.current = holderNames;
  });
  const confirm = useCallback(async (quoteId: string, pin: string) => {
    const result = await ticketsService.buy(
      quoteId,
      pin,
      names.current.map((name) => name.trim()),
    );
    // The ticket screen reads the list, so it has to hold the new ones before "View ticket" opens it.
    await queryClient.invalidateQueries({ queryKey: queryKeys.tickets });
    return result;
  }, []);
  const checkout = useCheckout(confirm);
  const buying = useFeature('tickets');
  const tier = event?.tiers.find((item) => item.id === tierId);
  const most = Math.min(MAX_PER_ORDER, tier?.remaining ?? MAX_PER_ORDER);

  useResultScreen(!!checkout.result || !!checkout.failure);

  const buy = async () => {
    if (!tier) return;
    setQuoteError(null);
    try {
      await checkout.start({ kind: 'ticket', eventId: id, tierId: tier.id, quantity });
    } catch (error) {
      setQuoteError(errorMessage(error));
    }
  };

  if (checkout.result) {
    const [first] = checkout.result.tickets;
    return (
      <SuccessView
        title={t('tickets.boughtTitle')}
        message={t(checkout.result.tickets.length === 1 ? 'tickets.boughtBodyOne' : 'tickets.boughtBodyMany', {
          count: checkout.result.tickets.length,
        })}
        primaryAction={{
          label: t('tickets.viewTicket'),
          onPress: () => router.replace({ pathname: '/tickets/[id]', params: { id: first.id } }),
        }}
        secondaryAction={{ label: t('common.backToHome'), href: '/' }}
      />
    );
  }

  if (checkout.failure) {
    return <CheckoutFailureView failure={checkout.failure} onRetry={checkout.retry} onEdit={checkout.reset} />;
  }

  return (
    <Screen
      refreshable
      footer={
        event?.sales === 'on_sale' && buying.enabled ? (
          <Button
            disabled={!tier || !namesReady}
            label={
              !tier
                ? t('tickets.pickTicket')
                : namesReady
                  ? t('tickets.buyFor', { amount: formatNaira(timesKobo(tier.price, quantity)) })
                  : t('tickets.namesNeeded')
            }
            loading={checkout.quoting}
            onPress={buy}
          />
        ) : undefined
      }>
      <QueryState query={query} hasData={!!event} skeleton="detail" />
      {event && (
        <>
          {!!event.imageUrl && <EventPoster uri={event.imageUrl} />}
          <View style={styles.hero}>
            <TasaText variant="title" color={colors.heading}>
              {event.title}
            </TasaText>
            <View style={styles.details}>
              <DetailRow
                icon={{ ios: 'calendar', android: 'calendar_today' }}
                label={t('tickets.date')}
                value={formatDateTime(event.startsAt)}
              />
              <DetailRow
                icon={{ ios: 'location.fill', android: 'near_me' }}
                label={t('tickets.venue')}
                value={event.venue}
              />
              <Pressable
                accessibilityRole="link"
                accessibilityHint={t('tickets.aboutOrganiser')}
                onPress={() => router.push({ pathname: '/organisers/[id]', params: { id: event.organiser.id } })}
                style={styles.organiserLink}>
                <DetailRow
                  icon={{ ios: 'person.2.fill', android: 'groups' }}
                  image={event.organiser.logoUrl}
                  label={t('tickets.organiser')}
                  value={event.organiser.name}>
                  <OrganiserStats organiser={event.organiser} />
                  <TasaText variant="caption" color={colors.brand}>
                    {t('tickets.aboutOrganiserLink')}
                  </TasaText>
                </DetailRow>
              </Pressable>
            </View>
            <View style={styles.badge}>
              <RefundBadge refundDays={event.refundDays} />
            </View>
            {(!!event.phone || !!event.email) && (
              <View style={styles.contacts}>
                {!!event.phone && <CallOrganiser phone={event.phone} />}
                {!!event.email && <EmailOrganiser email={event.email} />}
              </View>
            )}
          </View>
          {!!event.description && <TasaText variant="body">{event.description}</TasaText>}

          {event.gallery.length > 0 && (
            <>
              <SectionHeader title={t('tickets.gallery')} />
              <EventGallery items={event.gallery} />
            </>
          )}

          {event.sales !== 'on_sale' && (
            <TasaText variant="bodyMedium" color={colors.danger} style={styles.closed}>
              {t(event.sales === 'paused' ? 'tickets.salesPaused' : 'tickets.salesEnded')}
            </TasaText>
          )}

          <SectionHeader title={t('tickets.chooseTicket')} />
          {!buying.enabled && event.sales === 'on_sale' && <FeaturePaused message={buying.message} />}
          {event.tiers.map((item) => {
            const soldOut = item.remaining === 0;
            const selected = item.id === tierId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: soldOut }}
                disabled={soldOut || event.sales !== 'on_sale'}
                onPress={() => {
                  setPicked(item.id);
                  setQuantity(1);
                }}
                style={[styles.tier, selected && styles.tierActive, soldOut && styles.tierSoldOut]}>
                <View style={styles.tierCopy}>
                  <TasaText variant="bodyMedium">{item.name}</TasaText>
                  {!!item.covers && (
                    <TasaText variant="caption" color={colors.inkMuted}>
                      {t('tickets.includes', { what: item.covers })}
                    </TasaText>
                  )}
                  {item.remaining !== null && (
                    <TasaText variant="caption" color={colors.inkMuted}>
                      {soldOut ? t('tickets.soldOut') : t('tickets.left', { count: item.remaining })}
                    </TasaText>
                  )}
                </View>
                <TasaText variant="bodyMedium" color={colors.heading}>
                  {formatNaira(item.price)}
                </TasaText>
              </Pressable>
            );
          })}

          {tier && (
            <View style={styles.quantity}>
              <TasaText variant="bodyMedium">{t('tickets.quantity')}</TasaText>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('tickets.fewer')}
                  disabled={quantity <= 1}
                  hitSlop={8}
                  onPress={() => setQuantity((count) => count - 1)}>
                  <Icon color={colors.brand} ios="minus.circle" android="remove_circle" size={26} />
                </Pressable>
                <TasaText variant="title">{quantity}</TasaText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('tickets.more')}
                  disabled={quantity >= most}
                  hitSlop={8}
                  onPress={() => setQuantity((count) => count + 1)}>
                  <Icon color={colors.brand} ios="plus.circle" android="add_circle" size={26} />
                </Pressable>
              </View>
            </View>
          )}
          {tier && (
            <>
              <SectionHeader title={t('tickets.whoFor')} />
              <TasaText variant="caption" color={colors.inkMuted} style={styles.namesHint}>
                {t('tickets.whoForHint')}
              </TasaText>
              {Array.from({ length: quantity }, (_, index) => (
                <Input
                  key={index}
                  label={t('tickets.ticketNumber', { number: index + 1 })}
                  autoCapitalize="words"
                  maxLength={60}
                  last={index === quantity - 1}
                  value={holderNames[index]}
                  onChangeText={(name) =>
                    setHolders((current) => {
                      const next = [...current];
                      next[index] = name;
                      return next;
                    })
                  }
                />
              ))}
            </>
          )}
          {!!quoteError && (
            <TasaText variant="caption" color={colors.danger} style={styles.closed}>
              {quoteError}
            </TasaText>
          )}

          <Card style={styles.disclaimer}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('tickets.disclaimer')}
            </TasaText>
          </Card>
        </>
      )}

      <PinSheet
        {...checkout.pinSheet}
        title={t('checkout.pinTitle')}
        processingTitle={t('tickets.buying')}
        detail={
          checkout.quote
            ? [
                t('checkout.total', { amount: formatNaira(checkout.quote.total) }),
                t('tickets.chargeLine', { amount: formatNaira(checkout.quote.fee) }),
              ].join(' · ')
            : undefined
        }
      />
    </Screen>
  );
}

/** One fact about the event: a matching icon, what it is, then the detail. They wrap side by side. */
function DetailRow({
  icon,
  image,
  label,
  value,
  children,
}: {
  icon: IconName;
  /** Shown instead of the icon when there is one, like the organiser's logo. */
  image?: string | null;
  label: string;
  value: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.detail}>
      {image ? (
        <Image source={image} contentFit="cover" style={styles.detailIcon} />
      ) : (
        <View style={styles.detailIcon}>
          <Icon {...icon} color={colors.brand} size={18} />
        </View>
      )}
      <View style={styles.detailCopy}>
        <TasaText variant="caption" color={colors.inkMuted}>
          {label}
        </TasaText>
        <TasaText variant="bodyMedium" color={colors.heading}>
          {value}
        </TasaText>
        {children}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    headerAction: {
      paddingHorizontal: 6,
    },
    details: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: theme.spacing.lg,
      rowGap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    detail: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      maxWidth: '100%',
    },
    detailIcon: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.md,
      backgroundColor: `${colors.brand}14`,
    },
    detailCopy: {
      flexShrink: 1,
      gap: 1,
    },
    organiserLink: {
      maxWidth: '100%',
    },
    contacts: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: theme.spacing.md,
    },
    namesHint: {
      marginBottom: theme.spacing.sm,
    },
    hero: {
      gap: 4,
      marginBottom: theme.spacing.md,
    },
    badge: {
      alignSelf: 'flex-start',
      marginTop: theme.spacing.xs,
    },
    closed: {
      marginTop: theme.spacing.sm,
    },
    tier: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    tierActive: {
      borderColor: colors.brand,
      borderWidth: 2,
    },
    tierSoldOut: {
      opacity: 0.5,
    },
    tierCopy: {
      flex: 1,
      gap: 2,
    },
    quantity: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: theme.spacing.sm,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    disclaimer: {
      marginTop: theme.spacing.md,
    },
  }),
);
