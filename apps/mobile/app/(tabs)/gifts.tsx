import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CouponCard } from '@/components/ui/FeatureCards';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, Screen, ScreenHeader, SectionHeader, TasaText } from '@/components/ui/Screen';
import { QueryState } from '@/components/ui/QueryState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ServiceId } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useSettings } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCouponBalances, useCoupons, useGiftHistory, useGiftInbox, useMarkGiftsSeen } from '@/hooks/useOffers';
import { GiftHistoryItem, GiftInboxItem } from '@/lib/api/mappers';
import { formatDate, formatNaira } from '@/lib/format';
import { Translate } from '@/lib/i18n';
import { Kobo } from '@/lib/money';

// One bill per visit, so the card doesn't read as electricity-only.
const GIFT_TITLES = [
  'gifts.giftTitleLight',
  'gifts.giftTitleAirtime',
  'gifts.giftTitleData',
  'gifts.giftTitleTv',
] as const;

// Reads on the white button whichever gradient is behind it, in either theme.
const BANNER_INK = '#1F1147';

const withCount = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);

export default function GiftsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useSettings();
  const couponsQuery = useCoupons();
  const coupons = couponsQuery.data ?? [];
  const { data: claimed = [] } = useCouponBalances();
  const sent = useGiftHistory('sent').items;
  const inbox = useGiftInbox();
  const { mutate: markSeen } = useMarkGiftsSeen();
  const unseen = inbox.data?.unseen ?? 0;
  const items = inbox.data?.items ?? [];
  const gifts = allGifts(items, sent, t);
  // Until they choose, open whichever has something in it.
  const [section, setSection] = useState<'gifts' | 'coupons' | null>(null);
  const couponCount = coupons.length + claimed.length;
  const shown = section ?? (gifts.length === 0 && couponCount > 0 ? 'coupons' : 'gifts');
  const [giftTitle] = useState(() => GIFT_TITLES[Math.floor(Math.random() * GIFT_TITLES.length)]);

  useEffect(() => {
    if (unseen > 0) markSeen();
  }, [unseen, markSeen]);

  return (
    <Screen
      refreshable
      header={
        <ScreenHeader
          title={t('gifts.title')}
          subtitle={t('gifts.subtitle')}
        />
      }>
      <View style={styles.switcher}>
        <SegmentedControl
          options={[
            { value: 'gifts', label: withCount(t('gifts.tabGifts'), gifts.length) },
            { value: 'coupons', label: withCount(t('gifts.tabCoupons'), couponCount) },
          ]}
          value={shown}
          onChange={setSection}
        />
      </View>

      {shown === 'gifts' ? (
        <>
          <ActionBanner
            gradient={['#7B2FF7', '#F107A3']}
            title={t(giftTitle)}
            body={t('gifts.giftBody')}
            action={t('gifts.giftAction')}
            onPress={() => router.push('/gift/create')}
          />
          {gifts.length === 0 && inbox.data && <EmptyState message={t('gifts.noGifts')} />}
          {gifts.map((gift) =>
            gift.kind === 'bill' ? (
              <BillGiftCard key={gift.key} gift={gift} />
            ) : (
              <BalanceCard
                key={gift.key}
                heading={gift.heading}
                amount={gift.amount}
                used={gift.used}
                left={gift.left}
                services={gift.services}
                expiresAt={gift.expiresAt}
                message={gift.message}
                status={gift.status}
                autoApplied={gift.autoApplied}
              />
            ),
          )}

          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push('/gift/history')}
            style={styles.historyLink}>
            <TasaText variant="bodyMedium" color={colors.brand}>
              {t('gifts.history')}
            </TasaText>
          </Pressable>
        </>
      ) : (
        <>
          <ActionBanner
            gradient={['#FF6B6B', '#FFB347']}
            title={t('gifts.couponTitle')}
            body={t('gifts.couponBody')}
            action={t('gifts.couponAction')}
            onPress={() => router.push('/coupons/create')}
          />
          {claimed.length > 0 && (
            <>
              <SectionHeader title={t('gifts.couponBalances')} />
              {claimed.map((coupon) => (
                <BalanceCard
                  key={coupon.id}
                  heading={`${coupon.title} · ${coupon.code}`}
                  amount={coupon.myBalance!.amount}
                  used={coupon.myBalance!.used}
                  left={coupon.myBalance!.left}
                  services={coupon.services}
                  expiresAt={coupon.expiresAt}
                />
              ))}
              <SectionHeader title={t('gifts.yourCoupons')} />
            </>
          )}
          <QueryState query={couponsQuery} hasData={!!couponsQuery.data} />
          {couponsQuery.data && coupons.length === 0 && <EmptyState message={t('gifts.noCoupons')} />}
          {coupons.map((coupon) => (
            <Pressable key={coupon.id} onPress={() => router.push(`/coupons/${coupon.code}`)}>
              <CouponCard coupon={coupon} />
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  );
}

/** The way to create something: a real button beside the copy, with the user's list right below. */
function ActionBanner({
  gradient,
  title,
  body,
  action,
  onPress,
}: {
  gradient: [string, string];
  title: string;
  body: string;
  action: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onPress} style={styles.banner}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bannerFill}>
        <View style={styles.bannerCopy}>
          <TasaText variant="bodyMedium" color="#FFFFFF" numberOfLines={1}>
            {title}
          </TasaText>
          <TasaText variant="caption" color="rgba(255,255,255,0.82)" numberOfLines={2}>
            {body}
          </TasaText>
        </View>
        <View style={styles.bannerButton}>
          <Icon color={BANNER_INK} ios="plus" android="add" size={14} />
          <TasaText variant="caption" color={BANNER_INK}>
            {action}
          </TasaText>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

type GiftCardBase = { key: string; date: string; heading: string; message: string | null; amount: Kobo; status?: string };
type BillGift = GiftCardBase & {
  kind: 'bill';
  serviceId: ServiceId;
  token?: string | null;
  pins?: { pin: string; serial: string | null }[] | null;
};
type BalanceGift = GiftCardBase & {
  kind: 'balance';
  used: Kobo;
  left: Kobo;
  services: ServiceId[] | 'all';
  expiresAt: string;
  autoApplied: boolean;
};

/** Received and sent together, newest first; From and To tell them apart. */
function allGifts(received: GiftInboxItem[], sent: GiftHistoryItem[], t: Translate) {
  const gifts: (BillGift | BalanceGift)[] = [
    ...received.map((item): BillGift | BalanceGift => {
      const base = {
        key: `in-${item.id}`,
        date: item.createdAt,
        heading: t('gifts.from', { from: item.from }),
        message: item.message,
      };
      return item.type === 'balance'
        ? { ...base, kind: 'balance', amount: item.amount, used: item.used, left: item.left, services: item.services, expiresAt: item.expiresAt, autoApplied: true }
        : { ...base, kind: 'bill', amount: item.amount, serviceId: item.serviceId, token: item.token, pins: item.pins };
    }),
    ...sent.map((item): BillGift | BalanceGift => {
      const base = {
        key: `out-${item.id}`,
        date: item.date,
        heading: t('giftHistory.to', { from: item.person }),
        message: item.message,
        amount: item.amount,
        status: t(`giftHistory.state.${item.state}`),
      };
      return item.type === 'balance'
        ? { ...base, kind: 'balance', used: item.used, left: item.left, services: item.services, expiresAt: item.expiresAt, autoApplied: false }
        : { ...base, kind: 'bill', serviceId: item.serviceId };
    }),
  ];
  return gifts.sort((a, b) => b.date.localeCompare(a.date));
}

/** One gift, all of it: who, what, how far through it, then the details. */
function GiftCard({
  heading,
  headline,
  amount,
  progress,
  children,
}: {
  heading: string;
  headline: string;
  amount: Kobo;
  progress?: number;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.received}>
      <View style={styles.giftHeader}>
        <View style={styles.giftCopy}>
          <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
            {heading}
          </TasaText>
          <TasaText variant="bodyMedium" color={colors.heading} numberOfLines={1}>
            {headline}
          </TasaText>
        </View>
        <TasaText variant="title" color={colors.heading}>
          {formatNaira(amount)}
        </TasaText>
      </View>
      {progress !== undefined && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
      )}
      <View style={styles.giftDetails}>{children}</View>
    </View>
  );
}

/** What a gift or coupon was worth, what's been spent, what's left and where it can go. */
function BalanceCard({
  heading,
  amount,
  used,
  left,
  services,
  expiresAt,
  message,
  status,
  autoApplied = true,
}: {
  heading: string;
  amount: Kobo;
  used: Kobo;
  left: Kobo;
  services: ServiceId[] | 'all';
  expiresAt: string;
  message?: string | null;
  /** Replaces the headline when there's no balance to show, e.g. a sent gift that's used up. */
  status?: string;
  autoApplied?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useSettings();
  const appliesTo =
    services === 'all' ? t('gifts.anyBill') : services.map((id) => t(`services.${id}.name`)).join(', ');

  return (
    <GiftCard
      heading={heading}
      headline={left > 0 ? t('gifts.left', { amount: formatNaira(left) }) : (status ?? t('gifts.used'))}
      amount={amount}
      progress={used / amount}>
      {!!message && (
        <TasaText variant="caption" color={colors.inkMuted}>
          “{message}”
        </TasaText>
      )}

      <GiftRow label={t('gifts.used')} value={formatNaira(used)} />
      <GiftRow label={t('gifts.balance')} value={formatNaira(left)} />
      <GiftRow label={t('gifts.appliesTo')} value={appliesTo} />
      <GiftRow label={t('gifts.expires')} value={formatDate(expiresAt)} />

      {autoApplied && (
        <TasaText variant="caption" color={colors.inkSubtle} style={styles.autoNote}>
          {t('gifts.auto')}
        </TasaText>
      )}
    </GiftCard>
  );
}

function GiftRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.giftRow}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" style={styles.giftValue}>
        {value}
      </TasaText>
    </View>
  );
}

function BillGiftCard({ gift }: { gift: BillGift }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useSettings();
  return (
    <GiftCard
      heading={gift.heading}
      headline={t(`services.${gift.serviceId}.name`)}
      amount={gift.amount}>
      <GiftRow label={t('gifts.date')} value={formatDate(gift.date)} />
      {!!gift.message && (
        <TasaText variant="caption" color={colors.inkMuted}>
          “{gift.message}”
        </TasaText>
      )}
      {!!gift.status && (
        <TasaText variant="caption" color={colors.inkSubtle}>
          {gift.status}
        </TasaText>
      )}
      {!!gift.token && <TasaText variant="bodyMedium">{gift.token}</TasaText>}
      {gift.pins?.map((entry, index) => (
        <TasaText key={`${entry.pin}-${index}`} variant="bodyMedium">
          {entry.pin}
        </TasaText>
      ))}
    </GiftCard>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    received: {
      gap: 8,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      marginBottom: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    switcher: {
      marginBottom: theme.spacing.md,
    },
    historyLink: {
      alignSelf: 'center',
      paddingVertical: theme.spacing.md,
    },
    giftHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    giftCopy: {
      flex: 1,
      gap: 2,
    },
    giftDetails: {
      gap: 4,
      paddingTop: theme.spacing.xs,
    },
    track: {
      height: 4,
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: colors.track,
    },
    fill: {
      height: '100%',
      backgroundColor: colors.brand,
    },
    giftRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    giftValue: {
      flexShrink: 1,
      textAlign: 'right',
    },
    autoNote: {
      marginTop: theme.spacing.xs,
    },
    banner: {
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
      marginBottom: theme.spacing.lg,
    },
    bannerFill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      minHeight: 76,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    bannerCopy: {
      flex: 1,
      gap: 2,
    },
    bannerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: theme.radius.pill,
      backgroundColor: '#FFFFFF',
    },
  }),
);
