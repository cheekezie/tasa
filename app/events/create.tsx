import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { CalendarField } from '@/components/ui/CalendarField';
import { FeeLine, MIN_TICKET_PRICE } from '@/components/ui/FeeLine';
import { Icon } from '@/components/ui/Icon';
import { AmountInput, Input } from '@/components/ui/Input';
import { Screen, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCreateEvent, useSeller } from '@/hooks/useTickets';
import { errorMessage } from '@/lib/api/errors';
import { eventsService } from '@/lib/api/services/tickets';
import { toIsoDate } from '@/lib/calendar';
import { formatDateTime, formatNaira } from '@/lib/format';
import { Kobo, kobo } from '@/lib/money';
import { checkAccountNumber, validateEmail } from '@/lib/validation';

type TierForm = { key: number; name: string; covers: string; price: Kobo; limit: string };

const POSTER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [16, 9],
  quality: 0.8,
};

const STEPS = ['tickets.stepAbout', 'tickets.stepWhen', 'tickets.stepTickets', 'tickets.stepRefunds'] as const;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const emptyTier = (key: number): TierForm => ({ key, name: '', covers: '', price: kobo(0), limit: '' });

/** `date` at `time` on this phone. */
function toInstant(date: string, time: string) {
  return new Date(`${date}T${time.padStart(5, '0')}:00`);
}

export default function CreateEventScreenGated() {
  return (
    <FeatureGate feature="ticket_selling">
      <CreateEventScreen />
    </FeatureGate>
  );
}

function CreateEventScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const create = useCreateEvent();
  const { show } = useSnackbar();
  const [step, setStep] = useState(0);
  const [today] = useState(() => toIsoDate(new Date()));
  const [poster, setPoster] = useState<string | null>(null);
  // The content's full width, sized from the screen as on the event page: a percentage doesn't stretch in here.
  const posterWidth = useWindowDimensions().width - theme.spacing.screen * 2;
  const [title, setTitle] = useState('');
  // The profile's contacts fill in until they type their own (null: untouched), so a late-loading
  // profile never overwrites what they wrote, and clearing a field keeps it clear.
  const profile = useSeller().data?.contact;
  const [phoneTyped, setPhone] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [emailTyped, setEmail] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const phone = phoneTyped ?? profile?.phone ?? '';
  const email = emailTyped ?? profile?.email ?? '';
  const phoneFromProfile = phoneTyped === null && !!profile?.phone;
  const emailFromProfile = emailTyped === null && !!profile?.email;
  const [description, setDescription] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('');
  const [refunds, setRefunds] = useState(false);
  const [refundDays, setRefundDays] = useState('3');
  const [tiers, setTiers] = useState<TierForm[]>([emptyTier(0)]);
  const days = refunds ? Number(refundDays) || 0 : 0;
  const phoneCheck = checkAccountNumber('airtime', phone);
  const emailError = validateEmail(email.trim());
  const startsAt = TIME.test(startTime) ? toInstant(date, startTime) : null;

  const stepReady = [
    title.trim().length >= 3 && venue.trim().length >= 3 && !phoneCheck.error && !emailError,
    !!startsAt && startsAt > new Date() && (!endTime || TIME.test(endTime)),
    tiers.every((tier) => tier.name.trim().length >= 2 && tier.price >= MIN_TICKET_PRICE),
    !refunds || (days >= 1 && days <= 30),
  ][step];
  const lastStep = step === STEPS.length - 1;

  const pickPoster = async () => {
    const result = await ImagePicker.launchImageLibraryAsync(POSTER_OPTIONS);
    if (!result.canceled && result.assets[0]) setPoster(result.assets[0].uri);
  };

  const editTier = (key: number, changes: Partial<TierForm>) =>
    setTiers((current) => current.map((tier) => (tier.key === key ? { ...tier, ...changes } : tier)));

  const submit = async () => {
    let endsAt = endTime ? toInstant(date, endTime) : undefined;
    // A finish earlier than the start runs into the next day.
    if (endsAt && endsAt <= startsAt!) endsAt = new Date(endsAt.getTime() + 86_400_000);
    const event = await create.mutateAsync({
      title: title.trim(),
      phone: phoneCheck.value,
      email: email.trim() || undefined,
      description: description.trim() || undefined,
      venue: venue.trim(),
      startsAt: startsAt!.toISOString(),
      endsAt: endsAt?.toISOString(),
      refundDays: days,
      tiers: tiers.map(({ name, covers, price, limit }) => ({
        name: name.trim(),
        covers: covers.trim() || undefined,
        price,
        limit: Number(limit) > 0 ? Number(limit) : null,
      })),
    });
    show(t('tickets.eventCreated'));
    // The event is live either way; the poster can be added again from its page.
    if (poster) {
      await eventsService.setImage(event.id, poster).catch(() => {
        show(t('tickets.posterFailed'), { tone: 'error' });
      });
    }
    router.replace({ pathname: '/events/manage/[id]', params: { id: event.id } });
  };

  const next = () => {
    if (!lastStep) setStep((current) => current + 1);
    else submit().catch((error) => show(errorMessage(error), { tone: 'error' }));
  };

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          {step > 0 && (
            <Button
              label={t('tickets.back')}
              variant="secondary"
              style={styles.footerBack}
              onPress={() => setStep((current) => current - 1)}
            />
          )}
          <Button
            disabled={!stepReady}
            label={lastStep ? t('tickets.publish') : t('common.continue')}
            loading={create.isPending}
            style={styles.footerNext}
            onPress={next}
          />
        </View>
      }
      pinned={
        <>
          <View style={styles.progress}>
            {STEPS.map((key, index) => (
              <View key={key} style={[styles.progressBar, index <= step && styles.progressBarDone]} />
            ))}
          </View>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('tickets.stepOf', { current: step + 1, total: STEPS.length })}
          </TasaText>
          <TasaText variant="title" color={colors.heading}>
            {t(STEPS[step])}
          </TasaText>
        </>
      }>

      {step === 0 && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tickets.poster')}
            onPress={pickPoster}
            style={[styles.poster, { width: posterWidth, height: (posterWidth * 9) / 16 }]}>
            {poster ? (
              <Image source={poster} contentFit="cover" style={styles.posterImage} />
            ) : (
              <>
                <Icon color={colors.accentHot} ios="photo" android="photo_library" size={26} />
                <TasaText variant="bodyMedium">{t('tickets.poster')}</TasaText>
                <TasaText variant="caption" color={colors.inkMuted}>
                  {t('tickets.posterHint')}
                </TasaText>
              </>
            )}
          </Pressable>
          <Input label={t('tickets.eventName')} value={title} onChangeText={setTitle} />
          <Input
            label={t('tickets.callNumber')}
            hint={phoneFromProfile ? t('tickets.fromProfile', { hint: t('tickets.callHint') }) : t('tickets.callHint')}
            keyboardType="phone-pad"
            error={phoneTouched && !!phone ? phoneCheck.error : null}
            value={phone}
            onBlur={() => setPhoneTouched(true)}
            onChangeText={setPhone}
          />
          <Input
            label={t('tickets.contactEmail')}
            hint={emailFromProfile ? t('tickets.fromProfile', { hint: t('tickets.contactEmailHint') }) : t('tickets.contactEmailHint')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={emailTouched ? emailError : null}
            value={email}
            onBlur={() => setEmailTouched(true)}
            onChangeText={setEmail}
          />
          <Input label={t('tickets.venue')} value={venue} onChangeText={setVenue} />
          <Input
            label={t('tickets.description')}
            last
            multiline
            value={description}
            onChangeText={setDescription}
          />
        </>
      )}

      {step === 1 && (
        <>
          <CalendarField title={t('tickets.date')} value={date} min={today} onChange={setDate} />
          <View style={styles.times}>
            <Input
              label={t('tickets.startTime')}
              placeholder="18:00"
              keyboardType="numbers-and-punctuation"
              error={startsAt && startsAt <= new Date() ? t('tickets.startPassed') : null}
              style={styles.time}
              value={startTime}
              onChangeText={setStartTime}
            />
            <Input
              label={t('tickets.endTime')}
              placeholder="23:00"
              keyboardType="numbers-and-punctuation"
              last
              style={styles.time}
              value={endTime}
              onChangeText={setEndTime}
            />
          </View>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('tickets.endHint')}
          </TasaText>
        </>
      )}

      {step === 2 && (
        <>
          {tiers.map((tier, index) => (
            <Card key={tier.key} style={styles.tier}>
              <Input
                label={t('tickets.ticketName')}
                placeholder={index === 0 ? 'Regular' : 'VIP'}
                value={tier.name}
                onChangeText={(name) => editTier(tier.key, { name })}
              />
              <Input
                label={t('tickets.covers')}
                placeholder={t('tickets.coversHint')}
                value={tier.covers}
                onChangeText={(covers) => editTier(tier.key, { covers })}
              />
              <AmountInput
                label={t('tickets.price')}
                value={tier.price}
                onChangeValue={(price) => editTier(tier.key, { price })}
              />
              <FeeLine price={tier.price} />
              <Input
                label={t('tickets.limit')}
                hint={t('tickets.limitHint')}
                keyboardType="number-pad"
                last
                value={tier.limit}
                onChangeText={(limit) => editTier(tier.key, { limit: limit.replace(/\D/g, '') })}
              />
              {tiers.length > 1 && (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setTiers((current) => current.filter((item) => item.key !== tier.key))}>
                  <TasaText variant="caption" color={colors.danger}>
                    {t('tickets.removeTicket')}
                  </TasaText>
                </Pressable>
              )}
            </Card>
          ))}
          <Button
            label={t('tickets.addTicket')}
            variant="secondary"
            onPress={() => setTiers((current) => [...current, emptyTier(Date.now())])}
          />
        </>
      )}

      {step === 3 && (
        <>
          <View style={styles.refundRow}>
            <TasaText variant="bodyMedium">{t('tickets.allowRefunds')}</TasaText>
            <Switch
              accessibilityLabel={t('tickets.allowRefunds')}
              value={refunds}
              onValueChange={setRefunds}
              trackColor={{ true: colors.brand }}
            />
          </View>
          {refunds && (
            <Input
              label={t('tickets.refundDays')}
              keyboardType="number-pad"
              last
              style={styles.refund}
              value={refundDays}
              onChangeText={(text) => setRefundDays(text.replace(/\D/g, ''))}
            />
          )}
          <Card style={styles.note}>
            <TasaText variant="caption" color={colors.inkMuted}>
              {refunds
                ? t(days === 1 ? 'tickets.refundNoteOne' : 'tickets.refundNoteMany', { count: days })
                : t('tickets.noRefundNote')}
            </TasaText>
          </Card>

          <Card style={styles.summary}>
            <TasaText variant="bodyMedium" color={colors.heading}>
              {title.trim()}
            </TasaText>
            {!!startsAt && (
              <TasaText variant="caption" color={colors.inkMuted}>
                {formatDateTime(startsAt.toISOString())} · {venue.trim()}
              </TasaText>
            )}
            {tiers.map((tier) => (
              <TasaText key={tier.key} variant="caption" color={colors.inkMuted}>
                {tier.name.trim()} · {formatNaira(tier.price)}
              </TasaText>
            ))}
          </Card>
          <TasaText variant="caption" color={colors.inkSubtle} style={styles.note}>
            {t('tickets.noCancelNote')}
          </TasaText>
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    footer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    footerBack: {
      flex: 1,
    },
    footerNext: {
      flex: 2,
    },
    progress: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: theme.spacing.sm,
    },
    progressBar: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.track,
    },
    progressBarDone: {
      backgroundColor: colors.brand,
    },
    poster: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      marginBottom: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.warmSoftBorder,
      backgroundColor: colors.warmSoft,
      overflow: 'hidden',
    },
    posterImage: {
      width: '100%',
      height: '100%',
    },
    times: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    time: {
      flex: 1,
    },
    tier: {
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    refundRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    refund: {
      marginTop: theme.spacing.md,
    },
    note: {
      marginTop: theme.spacing.md,
    },
    summary: {
      gap: 4,
      marginTop: theme.spacing.md,
    },
  }),
);
