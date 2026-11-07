import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { AmountInput, Input } from '@/components/ui/Input';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { ServiceIcon } from '@/components/ui/Icon';
import { CheckoutFailureView } from '@/components/ui/CheckoutFailureView';
import { PinSheet } from '@/components/ui/PinSheet';
import { useCopyToClipboard } from '@/components/ui/Snackbar';
import { SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { ServiceId, utilityServices } from '@/constants/data';
import { theme } from '@/constants/theme';
import { useCheckout } from '@/hooks/useCheckout';
import { errorMessage } from '@/lib/api/errors';
import { offersService } from '@/lib/api/services/offers';
import { queryClient, queryKeys } from '@/lib/queryClient';
import { formatNaira } from '@/lib/format';
import { kobo, timesKobo } from '@/lib/money';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function CreateCouponScreenGated() {
  return (
    <FeatureGate feature="coupons">
      <CreateCouponScreen />
    </FeatureGate>
  );
}

function CreateCouponScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const copy = useCopyToClipboard();
  const checkout = useCheckout(offersService.createCoupon);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [parsedAmount, setAmount] = useState(kobo(500_000));
  const [quantity, setQuantity] = useState('10');
  const [scope, setScope] = useState<ServiceId[] | 'all'>('all');

  const parsedQuantity = Number(quantity.replace(/,/g, '')) || 0;

  const submit = async () => {
    setQuoteError(null);
    try {
      await checkout.start({
        kind: 'coupon',
        title: title.trim(),
        amount: parsedAmount,
        quantity: parsedQuantity,
        services: scope === 'all' || scope.length === 0 ? 'all' : scope,
      });
    } catch (error) {
      setQuoteError(errorMessage(error));
    }
  };

  const created = checkout.result;
  useResultScreen(!!created || !!checkout.failure);
  useEffect(() => {
    if (created) queryClient.invalidateQueries({ queryKey: queryKeys.coupons });
  }, [created]);

  if (created) {
    const code = created.coupon?.code ?? created.transaction.couponCode ?? '';
    return (
      <SuccessView
        title={t('couponCreate.createdTitle')}
        message={t('couponCreate.createdBody', { code })}
        primaryAction={{
          label: t('couponCreate.viewCoupon'),
          href: `/coupons/${code}`,
          mode: 'replace',
        }}
        secondaryAction={{ label: t('common.done') }}>
        <Card style={styles.receipt}>
          <Row label={t('couponCreate.receiptCode')} value={code} />
          <Row
            label={t('couponCreate.receiptValue')}
            value={`${parsedQuantity} × ${formatNaira(parsedAmount)}`}
          />
          <Row label={t('couponCreate.receiptPaid')} value={formatNaira(checkout.quote?.total ?? kobo(0))} />
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => copy(code, t('couponDetail.copied'))}
            style={styles.copy}>
            <TasaText variant="bodyMedium" color={colors.brand}>
              {t('couponDetail.copyCode')}
            </TasaText>
          </Pressable>
        </Card>
      </SuccessView>
    );
  }

  if (checkout.failure) {
    return (
      <CheckoutFailureView failure={checkout.failure} onRetry={checkout.retry} onEdit={checkout.reset} />
    );
  }

  return (
    <Screen
      footer={
        <Button
          disabled={!title || parsedAmount <= 0 || parsedQuantity <= 0}
          label={t('couponCreate.submit')}
          loading={checkout.quoting}
          onPress={submit}
        />
      }>
      <View style={styles.hero}>
        <TasaText variant="bodyMedium">{t('couponCreate.heroTitle')}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('couponCreate.heroBody')}
        </TasaText>
      </View>

      <Input
        label={t('couponCreate.campaign')}
        placeholder={t('couponCreate.campaignPlaceholder')}
        style={styles.field}
        error={quoteError}
        value={title}
        onChangeText={setTitle}
      />

      <View style={styles.row}>
        <AmountInput
          label={t('couponCreate.amountEach')}
          style={{ ...styles.field, ...styles.half }}
          value={parsedAmount}
          onChangeValue={setAmount}
        />
        <Input
          label={t('couponCreate.quantity')}
          last
          keyboardType="number-pad"
          style={{ ...styles.field, ...styles.half }}
          value={quantity}
          onChangeText={(text) => setQuantity(text.replace(/\D/g, '').slice(0, 5))}
        />
      </View>

      <SectionHeader title={t('couponCreate.eligible')} />
      <Pressable
        onPress={() => setScope('all')}
        style={[styles.scopeChip, scope === 'all' && styles.scopeChipActive]}>
        <TasaText variant="caption" color={scope === 'all' ? '#FFFFFF' : colors.brand}>
          {t('couponCreate.allServices')}
        </TasaText>
      </Pressable>
      <View style={styles.grid}>
        {utilityServices.map((service) => {
          const selected = scope !== 'all' && scope.includes(service.id);
          return (
            <Pressable
              key={service.id}
              onPress={() => {
                if (scope === 'all') {
                  setScope([service.id]);
                  return;
                }
                setScope(
                  selected
                    ? scope.filter((id) => id !== service.id)
                    : [...scope, service.id],
                );
              }}
              accessibilityRole="button"
              accessibilityLabel={t(`services.${service.id}.name`)}
              accessibilityState={{ selected }}
              style={[styles.tile, selected && styles.tileActive]}>
              <ServiceIcon serviceId={service.id} color={selected ? '#FFFFFF' : undefined} />
            </Pressable>
          );
        })}
      </View>
      <TasaText variant="bodyMedium" style={styles.selectedServices}>
        {scope === 'all' || scope.length === 0
          ? t('couponCreate.allServices')
          : scope.map((id) => t(`services.${id}.name`)).join(', ')}
      </TasaText>

      <View style={styles.summary}>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('couponCreate.totalCost')}
        </TasaText>
        <TasaText variant="title" color={colors.heading}>
          {formatNaira(timesKobo(parsedAmount, parsedQuantity))}
        </TasaText>
      </View>

      <PinSheet
        {...checkout.pinSheet}
        title={t('checkout.pinTitle')}
        processingTitle={t('processing.coupon')}
        detail={checkout.quote ? t('checkout.total', { amount: formatNaira(checkout.quote.total) }) : undefined}
      />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.receiptRow}>
      <TasaText variant="caption" color={colors.inkMuted}>
        {label}
      </TasaText>
      <TasaText variant="bodyMedium" numberOfLines={1} style={styles.receiptValue}>
        {value}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hero: {
      gap: 2,
      marginBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: colors.warmSoft,
      borderWidth: 1,
      borderColor: colors.warmSoftBorder,
    },
    field: {
      gap: 8,
      marginBottom: theme.spacing.md,
    },
    row: {
      flexDirection: 'row',
      gap: 12,
    },
    half: {
      flex: 1,
    },
    scopeChip: {
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: theme.spacing.sm,
    },
    scopeChipActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: theme.spacing.sm,
    },
    selectedServices: {
      marginBottom: theme.spacing.lg,
    },
    tile: {
      width: 52,
      height: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
    },
    tileActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    summary: {
      gap: 4,
      marginBottom: theme.spacing.lg,
    },
    receipt: {
      gap: 10,
    },
    receiptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    receiptValue: {
      flexShrink: 1,
      textAlign: 'right',
    },
    copy: {
      alignSelf: 'flex-start',
      paddingTop: theme.spacing.xs,
    },
  }),
);
