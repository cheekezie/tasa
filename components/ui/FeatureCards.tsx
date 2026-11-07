import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { useCopyToClipboard } from '@/components/ui/Snackbar';
import { Beneficiary, Coupon } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { formatNaira, formatRelativeDateInline } from '@/lib/format';
import { Kobo } from '@/lib/money';

/**
 * A bill the wallet can't cover yet, in one line: how much is missing, for what and when, and
 * the way to fix it. Kept small: it's a nudge, not the main thing on the screen.
 */
export function ReminderBanner({
  title,
  amount,
  dueDate,
  shortfall,
}: {
  title: string;
  amount: Kobo;
  dueDate: string;
  shortfall: Kobo;
}) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('cards.topUp')}
      onPress={() => router.push('/wallet/fund')}
      style={styles.reminder}>
      <View style={styles.reminderIcon}>
        <Icon color={colors.danger} ios="exclamationmark.triangle.fill" android="warning" size={14} />
      </View>
      <View style={styles.reminderCopy}>
        <TasaText variant="bodyMedium" numberOfLines={1}>
          {t('cards.shortFor', { shortfall: formatNaira(shortfall), title })}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
          {t('cards.dueLine', { amount: formatNaira(amount), date: formatRelativeDateInline(dueDate) })}
        </TasaText>
      </View>
      <TasaText variant="caption" color={colors.danger}>
        {t('cards.topUp')}
      </TasaText>
    </Pressable>
  );
}

export function BeneficiaryRow({ beneficiary }: { beneficiary: Beneficiary }) {
  const { virtualAccount } = beneficiary;
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const copy = useCopyToClipboard();

  return (
    <Card style={styles.beneficiary}>
      <View style={styles.beneficiaryTop}>
        <View style={styles.beneficiaryCopy}>
          <TasaText variant='bodyMedium' numberOfLines={1}>
            {beneficiary.label}
          </TasaText>
          <TasaText variant='caption' color={colors.inkMuted} numberOfLines={1}>
            {t(`services.${beneficiary.serviceId}.name`)} · {beneficiary.provider}
          </TasaText>
        </View>
      </View>
      <TasaText variant='caption' color={colors.inkMuted}>
        {t(`services.${beneficiary.serviceId}.account`)}: {beneficiary.accountNumber}
        {beneficiary.customerName ? ` · ${beneficiary.customerName}` : ''}
      </TasaText>
      {virtualAccount && (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={t('cards.copyVirtual')}
          onPress={() => copy(virtualAccount.accountNumber, t('cards.virtualCopied'))}
          style={styles.virtualAccount}
        >
          <View>
            <TasaText variant='caption' color={colors.inkSubtle}>
              {virtualAccount.bankName}
            </TasaText>
            <TasaText variant='bodyMedium'>{virtualAccount.accountNumber}</TasaText>
          </View>
          <TasaText variant='caption' color={colors.brand}>
            {t('common.copy')}
          </TasaText>
        </Pressable>
      )}
    </Card>
  );
}

export function CouponCard({ coupon }: { coupon: Coupon }) {
  const t = useT();
  const { colors } = useTheme();
  const styles = useStyles();
  const remaining = coupon.quantity - coupon.redeemed;
  const progress = coupon.redeemed / coupon.quantity;

  return (
    <Card style={styles.coupon}>
      <View style={styles.couponHeader}>
        <View style={styles.couponBadge}>
          <TasaText variant='caption' color='#FFFFFF'>
            {t('cards.coupon')}
          </TasaText>
        </View>
        <TasaText variant='caption' color={colors.inkMuted}>
          {t('cards.left', { count: remaining })}
        </TasaText>
      </View>
      <TasaText variant='subtitle' numberOfLines={2}>
        {coupon.title}
      </TasaText>
      <TasaText variant='body' color={colors.inkMuted}>
        {t('cards.couponLine', { amount: formatNaira(coupon.amount), code: coupon.code })}
      </TasaText>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    reminder: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      backgroundColor: colors.dangerSoft,
      borderColor: colors.dangerSoftBorder,
    },
    reminderIcon: {
      width: 26,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 13,
      backgroundColor: `${colors.danger}1A`,
    },
    reminderCopy: {
      flex: 1,
      gap: 1,
    },
    beneficiary: {
      gap: 10,
      marginBottom: 12,
    },
    beneficiaryTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    beneficiaryCopy: {
      flex: 1,
    },
    virtualAccount: {
      marginTop: 4,
      padding: 12,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    coupon: {
      gap: 8,
      marginBottom: 12,
      backgroundColor: colors.warmSoft,
      borderColor: colors.warmSoftBorder,
    },
    couponHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    couponBadge: {
      backgroundColor: colors.coupon,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: theme.radius.pill,
    },
    progressTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.track,
      overflow: 'hidden',
      marginTop: 4,
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.accentHot,
      borderRadius: 999,
    },
  }),
);
