import { Href, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { QuickAction } from '@/components/ui/Actions';
import { Avatar } from '@/components/ui/Avatar';
import { ReminderBanner } from '@/components/ui/FeatureCards';
import { CardCarousel } from '@/components/ui/CardCarousel';
import { ComingUp } from '@/components/ui/ComingUp';
import { PointsCard } from '@/components/ui/PointsCard';
import { Screen, ScreenHeader, SectionHeader, TasaText } from '@/components/ui/Screen';
import { Icon, IconName } from '@/components/ui/Icon';
import { LoadError, QueryState } from '@/components/ui/QueryState';
import { useCopyToClipboard } from '@/components/ui/Snackbar';
import { NextEventBanner } from '@/components/ui/NextEventBanner';
import { SpendingSnapshot } from '@/components/ui/SpendingSnapshot';
import { WalletCard } from '@/components/ui/WalletCard';
import { theme } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import { useAccount } from '@/hooks/useAccount';
import { usePoints, usePromotions } from '@/hooks/useOffers';
import { useRecurringBills } from '@/hooks/useSaved';
import { Promotion } from '@/lib/api/mappers';
import { formatNaira } from '@/lib/format';
import { kobo, subtractKobo } from '@/lib/money';
import { queryClient } from '@/lib/queryClient';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { t } = useSettings();
  const styles = useStyles();
  const account = useAccount();
  const { walletBalance, balanceKnown, profile, giftsUnseen, giftsBalance } = account;
  const recurring = useRecurringBills();
  const recurringBills = (recurring.data ?? []).filter((bill) => bill.active);
  const { data: promotions = [] } = usePromotions();
  const { dismissedPromos, dismissPromo } = useApp();
  const visiblePromos = promotions.filter((promo) => !dismissedPromos.includes(promo.id));
  const { data: points } = usePoints();
  const quickActions: { label: string; icon: IconName; color: string; href: Href }[] = [
    { label: t('home.payBill'), icon: { ios: 'creditcard.fill', android: 'credit_card' }, color: colors.brand, href: '/(tabs)/pay' },
    { label: t('home.tickets'), icon: { ios: 'ticket.fill', android: 'confirmation_number' }, color: colors.accentHot, href: '/events' },
    { label: t('home.recurring'), icon: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew' }, color: colors.success, href: '/recurring' },
    { label: t('home.people'), icon: { ios: 'person.2.fill', android: 'group' }, color: colors.brandLight, href: '/beneficiaries' },
  ];
  const nextShortBill = [...recurringBills]
    .sort((a, b) => new Date(a.nextDate).getTime() - new Date(b.nextDate).getTime())
    .find((bill) => balanceKnown && bill.amount > walletBalance);
  const shortfall = nextShortBill ? subtractKobo(nextShortBill.amount, walletBalance) : kobo(0);

  // Nothing on Home means much without the balance, so this replaces it: one message, one button.
  if (account.query.isError && !balanceKnown) {
    return (
      <LoadError
        fill
        error={account.query.error}
        reloading={account.query.isFetching}
        onReload={() => queryClient.refetchQueries({ type: 'active' })}
      />
    );
  }

  return (
    <Screen
      refreshable
      header={
        <ScreenHeader
          eyebrow={t(greetingKey())}
          title={profile.fullName.trim().split(/\s+/)[0] || 'Tasa'}
          right={
            <View style={styles.headerActions}>
              {/* Everything Tasa does, one tap from Home. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home.allServices')}
                hitSlop={6}
                onPress={() => router.push('/services')}
                style={({ pressed }) => [styles.servicesButton, pressed && styles.pressed]}>
                <Icon ios="square.grid.2x2.fill" android="apps" color={colors.brand} size={20} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home.openProfile')}
                onPress={() => router.push('/(tabs)/profile')}>
                <Avatar uri={profile.avatarUri} name={profile.fullName} size={44} />
              </Pressable>
            </View>
          }
        />
      }>
      <CardCarousel>
        <WalletCard key="wallet" balance={walletBalance} style={styles.carouselCard} />
        {points?.active && <PointsCard key="points" points={points} style={styles.carouselCard} />}
      </CardCarousel>

      <SpendingSnapshot />
      <NextEventBanner />
      <QueryState query={account.query} hasData={balanceKnown} quiet />

      {giftsUnseen > 0 && (
        <Pressable onPress={() => router.push('/(tabs)/gifts')} style={styles.notice}>
          <TasaText variant="bodyMedium">{t('home.giftsWaiting', { count: giftsUnseen })}</TasaText>
          <TasaText variant="caption" color={colors.inkMuted}>
            {t('home.giftsBalance', { amount: formatNaira(giftsBalance) })}
          </TasaText>
        </Pressable>
      )}

      {nextShortBill && (
        <View style={styles.sectionGap}>
          <ReminderBanner
            amount={nextShortBill.amount}
            dueDate={nextShortBill.nextDate}
            shortfall={shortfall}
            title={nextShortBill.label}
          />
        </View>
      )}

      {visiblePromos.slice(0, 2).map((promo) => (
        <PromoBanner key={promo.id} promo={promo} onClose={() => dismissPromo(promo.id)} />
      ))}

      <SectionHeader
        action={
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/services')}>
            <TasaText variant="caption" color={colors.brand}>
              {t('home.seeMore')}
            </TasaText>
          </Pressable>
        }
        title={t('home.quickActions')}
      />
      {/* The shortlist of Services; everything else is behind See more. */}
      <View style={styles.quickActions}>
        {quickActions.map((action) => (
          <View key={action.label} style={styles.quickAction}>
            <QuickAction color={action.color} icon={action.icon} label={action.label} onPress={() => router.push(action.href)} />
          </View>
        ))}
      </View>

      <ComingUp />
    </Screen>
  );
}

function PromoBanner({ promo, onClose }: { promo: Promotion; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useSettings();
  const styles = useStyles();
  const copy = useCopyToClipboard();

  return (
    <View style={styles.notice}>
      <View style={styles.promoHeader}>
        <TasaText variant="bodyMedium" style={styles.promoTitle}>
          {promo.title}
        </TasaText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={10}
          onPress={onClose}>
          <Icon color={colors.inkMuted} ios="xmark" android="close" size={16} />
        </Pressable>
      </View>
      <TasaText variant="caption" color={colors.inkMuted}>
        {promo.summary}
      </TasaText>
      <View style={styles.promoCode}>
        <TasaText variant="bodyMedium" color={colors.brand} style={styles.promoCodeText}>
          {promo.code}
        </TasaText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('common.copy')} ${promo.code}`}
          hitSlop={8}
          onPress={() => copy(promo.code, t('couponDetail.copied'))}
          style={styles.copyButton}>
          <Icon color={colors.brand} ios="doc.on.doc" android="content_copy" size={16} />
          <TasaText variant="caption" color={colors.brand}>
            {t('common.copy')}
          </TasaText>
        </Pressable>
      </View>
    </View>
  );
}

function greetingKey() {
  const hour = new Date().getHours();
  if (hour < 12) return 'home.morning';
  if (hour < 17) return 'home.afternoon';
  return 'home.evening';
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    carouselCard: {
      flex: 1,
    },
    notice: {
      gap: 2,
      marginTop: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    promoHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    promoTitle: {
      flex: 1,
    },
    promoCode: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      marginTop: theme.spacing.xs,
    },
    promoCodeText: {
      flexShrink: 1,
    },
    copyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: colors.overlay,
    },
    sectionGap: {
      marginTop: theme.spacing.lg,
    },
    quickActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: theme.spacing.md,
    },
    pressed: {
      opacity: 0.7,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    servicesButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickAction: {
      width: '25%',
      flexDirection: 'row',
      justifyContent: 'center',
    },
  }),
);
