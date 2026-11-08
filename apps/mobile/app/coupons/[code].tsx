import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Linking, Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { ActionSheet } from '@/components/ui/ActionSheet';
import { Button } from '@/components/ui/Button';
import { useCopyToClipboard, useSnackbar } from '@/components/ui/Snackbar';
import { Screen, TasaText } from '@/components/ui/Screen';
import { QueryState } from '@/components/ui/QueryState';
import { Coupon } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useCancelCoupon, useCoupon } from '@/hooks/useOffers';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatNaira } from '@/lib/format';
import i18n from '@/lib/i18n';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function CouponDetailScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const copy = useCopyToClipboard();
  const { show } = useSnackbar();
  const [sharing, setSharing] = useState(false);
  const { code } = useLocalSearchParams<{ code: string }>();
  const query = useCoupon(code);
  const cancelCoupon = useCancelCoupon();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const coupon = query.data;

  if (!coupon) {
    return (
      <Screen scroll={false}>
        <QueryState query={query} skeleton="detail" />
      </Screen>
    );
  }

  const remaining = coupon.quantity - coupon.redeemed;
  const message = couponShareMessage(coupon);

  const shareOnWhatsApp = async () => {
    const text = encodeURIComponent(message);
    // The app scheme reliably pre-fills the message in the chat picker. wa.me without a number
    // often lands on a web page and drops the text, so the web link is only the fallback.
    // (openURL works for any scheme; only canOpenURL needs it declared on iOS.)
    if (Platform.OS === 'ios') {
      // WhatsApp on iPhone can send just the link and drop the text around it. Keep the full
      // message on the clipboard and say so before leaving, so it can be pasted into the chat.
      await Clipboard.setStringAsync(message);
      show(t('couponDetail.whatsappCopied'), { duration: 4000 });
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    try {
      await Linking.openURL(`whatsapp://send?text=${text}`);
    } catch {
      try {
        await Linking.openURL(`https://api.whatsapp.com/send?text=${text}`);
      } catch {
        show(t('couponDetail.whatsappFailed'));
      }
    }
  };

  return (
    <Screen refreshable>
      <View style={styles.card}>
        <TasaText variant="label" color={colors.accentHot}>
          {t('couponDetail.shareCode')}
        </TasaText>
        <TasaText variant="display" color={colors.heading}>
          {coupon.code}
        </TasaText>
        <TasaText variant="subtitle" numberOfLines={2}>{coupon.title}</TasaText>
        <TasaText variant="body" color={colors.inkMuted}>
          {t('couponDetail.line', {
            amount: formatNaira(coupon.amount),
            remaining,
            total: coupon.quantity,
          })}
        </TasaText>
        <TasaText variant="caption" color={colors.inkSubtle}>
          {t('couponDetail.expires', { date: formatDate(coupon.expiresAt) })}
        </TasaText>
      </View>

      <Pressable
        onPress={() => copy(coupon.code, t('couponDetail.copied'))}
        style={styles.copyRow}>
        <TasaText variant="bodyMedium" color={colors.brand}>
          {t('couponDetail.copyCode')}
        </TasaText>
      </Pressable>

      <Button label={t('couponDetail.share')} onPress={() => setSharing(true)} />

      {coupon.isOwner && coupon.status === 'active' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirmCancel(true)}
          style={styles.cancel}>
          <TasaText variant="bodyMedium" color={colors.danger}>
            {t('couponDetail.cancelCoupon')}
          </TasaText>
        </Pressable>
      )}

      <ActionSheet
        visible={confirmCancel}
        title={t('couponDetail.cancelCoupon')}
        message={t('couponDetail.cancelBody')}
        options={[
          {
            label: t('couponDetail.cancelCoupon'),
            icon: { ios: 'xmark.circle', android: 'cancel' },
            destructive: true,
            onPress: () =>
              cancelCoupon.mutate(coupon.id, {
                onSuccess: () => {
                  query.refetch();
                  show(t('couponDetail.cancelled'));
                },
                onError: (error) => show(errorMessage(error), { tone: 'error' }),
              }),
          },
        ]}
        cancelLabel={t('couponDetail.cancel')}
        onClose={() => setConfirmCancel(false)}
      />

      <ActionSheet
        visible={sharing}
        title={t('couponDetail.share')}
        options={[
          {
            label: t('couponDetail.shareWhatsApp'),
            image: require('@/assets/images/whatsapp.svg'),
            onPress: shareOnWhatsApp,
          },
          {
            label: t('couponDetail.copyLink'),
            icon: { ios: 'link', android: 'link' },
            onPress: () => copy(message, t('couponDetail.linkCopied')),
          },
          {
            label: t('couponDetail.shareMore'),
            icon: { ios: 'square.and.arrow.up', android: 'share' },
            onPress: () => Share.share({ message }),
          },
        ]}
        cancelLabel={t('couponDetail.cancel')}
        onClose={() => setSharing(false)}
      />
    </Screen>
  );
}

// Placeholder until the redeem page is live on the web.
const COUPON_LINK_BASE = 'https://tasa.ng/redeem';

function couponLink(code: string) {
  return `${COUPON_LINK_BASE}/${encodeURIComponent(code)}`;
}

/** What goes out on WhatsApp or the clipboard: the offer, how to use it, and the link. */
function couponShareMessage(coupon: Coupon) {
  const t = i18n.t.bind(i18n);
  const services =
    coupon.services === 'all'
      ? t('couponDetail.anyBill')
      : coupon.services.map((id) => t(`services.${id}.name`)).join(', ');
  return t('couponDetail.shareMessage', {
    title: coupon.title,
    amount: formatNaira(coupon.amount),
    services,
    code: coupon.code,
    date: formatDate(coupon.expiresAt),
    link: couponLink(coupon.code),
  });
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      padding: theme.spacing.lg,
      borderRadius: theme.radius.xl,
      backgroundColor: colors.warmSoft,
      borderWidth: 1,
      borderColor: colors.warmSoftBorder,
      gap: 8,
      marginBottom: theme.spacing.lg,
    },
    cancel: {
      alignItems: 'center',
      marginTop: theme.spacing.lg,
    },
    copyRow: {
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
  }),
);
