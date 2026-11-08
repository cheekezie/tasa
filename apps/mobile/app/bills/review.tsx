import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button, Card } from '@/components/ui/Button';
import { Icon, ServiceIcon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PinSheet } from '@/components/ui/PinSheet';
import { ProcessingView } from '@/components/ui/ProcessingView';
import { Screen, TasaText } from '@/components/ui/Screen';
import { ErrorView, SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { CheckoutFailureView } from '@/components/ui/CheckoutFailureView';
import { Skeleton } from '@/components/ui/Skeleton';
import { ServiceId, getServiceById } from '@/constants/data';
import { fontSize, theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount } from '@/hooks/useAccount';
import { useCheckout } from '@/hooks/useCheckout';
import { useTransaction } from '@/hooks/usePayments';
import { useBeneficiaries, useRecurringBills } from '@/hooks/useSaved';
import { errorMessage, hasCode } from '@/lib/api/errors';
import { Quote } from '@/lib/api/mappers';
import { paymentsService } from '@/lib/api/services/payments';
import { BillQuoteInput } from '@/lib/api/types';
import { formatNaira } from '@/lib/format';
import { kobo, koboFromParam, maxKobo, subtractKobo } from '@/lib/money';
import { queryClient, queryKeys } from '@/lib/queryClient';

type QuoteState =
  | { status: 'loading' }
  | { status: 'error'; message: string; notVerified: boolean }
  | { status: 'ready'; quote: Quote };

export default function ReviewBillScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{
    service: ServiceId;
    provider: string;
    account: string;
    amount?: string;
    beneficiaryId?: string;
    product?: 'airtime' | 'data';
    meterType?: 'prepaid' | 'postpaid';
    planCode?: string;
  }>();
  const { walletBalance, balanceKnown, profile } = useAccount();
  const { data: beneficiaries = [] } = useBeneficiaries();
  const { data: recurringBills = [] } = useRecurringBills();
  // Exam PINs are one-offs, and a bill already on a schedule doesn't need a second one.
  const canRepeat =
    params.service !== 'jamb' &&
    !recurringBills.some(
      (bill) => bill.active && bill.serviceId === params.service && bill.accountNumber === params.account,
    );

  const t = useT();
  const serviceName = t(`services.${params.service}.name`);
  const accountLabel = t(`services.${params.service}.account`);
  const beneficiary = beneficiaries.find((item) => item.id === params.beneficiaryId);
  const isElectricity = params.service === 'electricity';

  const [quoteState, setQuoteState] = useState<QuoteState>({ status: 'loading' });
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [saveToBeneficiaries, setSaveToBeneficiaries] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  // What was actually sent, so a retry of the same payment asks for the same save.
  const savedAs = useRef<string | undefined>(undefined);
  const checkout = useCheckout((quoteId, pin) =>
    paymentsService.purchaseBill(quoteId, pin, savedAs.current),
  );
  const settled = useTransaction(checkout.result?.reference ?? null);
  const transaction = settled.data ?? checkout.result;

  const priceBill = useCallback(
    (extra: Pick<BillQuoteInput, 'couponCode' | 'autoApply'> = {}) =>
      paymentsService.createQuote({
        kind: 'bill',
        serviceId: params.service,
        provider: params.provider,
        account: params.account,
        amount: koboFromParam(params.amount) || undefined,
        product: params.product,
        meterType: params.meterType,
        planCode: params.planCode || undefined,
        beneficiaryId: params.beneficiaryId || undefined,
        ...extra,
      }),
    [
      params.service,
      params.provider,
      params.account,
      params.amount,
      params.product,
      params.meterType,
      params.planCode,
      params.beneficiaryId,
    ],
  );

  const loadQuote = useCallback(async () => {
    setQuoteState({ status: 'loading' });
    try {
      setQuoteState({ status: 'ready', quote: await priceBill() });
    } catch (error) {
      setQuoteState({
        status: 'error',
        message: errorMessage(error),
        notVerified: hasCode(error, 'ACCOUNT_NOT_VERIFIED'),
      });
    }
  }, [priceBill]);

  useEffect(() => {
    loadQuote();
  }, [loadQuote]);

  // The API saves it once the bill succeeds, so that's when the list changes.
  const succeeded = transaction?.status === 'success';
  useEffect(() => {
    if (succeeded && savedAs.current) {
      queryClient.invalidateQueries({ queryKey: queryKeys.beneficiaries });
    }
  }, [succeeded]);

  useResultScreen(!!transaction || !!checkout.failure || quoteState.status === 'error');

  if (checkout.paying) return <ProcessingView title={t('processing.bill')} />;

  if (transaction?.status === 'success') {
    return (
      <SuccessView
        title={t('review.successTitle')}
        message={t('review.successMessage', {
          service: serviceName.toLowerCase(),
          provider: params.provider,
        })}
        primaryAction={{ label: t('common.done'), href: '/' }}
        secondaryAction={{ label: t('review.payAnother'), href: '/(tabs)/pay' }}>
        <Card style={styles.card}>
          <Row label={accountLabel} value={params.account} />
          {!!transaction.token && (
            <Row label={t('transaction.token')} value={transaction.token} strong lines={2} />
          )}
          {!!transaction.units && <Row label={t('transaction.units')} value={transaction.units} />}
          {transaction.pins?.map((item, index) => (
            <Row key={`${item.pin}-${index}`} label={t('transaction.pin')} value={item.pin} strong />
          ))}
          {!!transaction.fee && (
            <Row label={t('review.serviceCharge')} value={formatNaira(transaction.fee)} />
          )}
          {!!transaction.discount && (
            <Row
              label={t('review.couponReceipt')}
              value={`−${formatNaira(transaction.discount)}`}
              tone={colors.success}
            />
          )}
          <Row label={t('review.paidFromWallet')} value={formatNaira(transaction.amount)} strong />
          {!!savedAs.current && (
            <Row label={t('review.savedAs')} value={savedAs.current} tone={colors.success} />
          )}
        </Card>
        {canRepeat && (
          <Button
            label={t('review.makeRecurring')}
            variant="secondary"
            style={styles.recurringButton}
            onPress={() =>
              router.push({
                pathname: '/recurring/setup',
                params: {
                  service: params.service,
                  provider: params.provider,
                  account: params.account,
                  amount: quoteState.status === 'ready' ? String(quoteState.quote.amount) : params.amount,
                  planCode: params.planCode ?? '',
                  product: params.product ?? '',
                  meterType: params.meterType ?? '',
                  beneficiaryId: params.beneficiaryId ?? '',
                  fromBill: '1',
                },
              })
            }
          />
        )}
      </SuccessView>
    );
  }

  if (transaction?.status === 'pending') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brand} size="large" />
        <TasaText variant="subtitle">{t('review.pendingTitle')}</TasaText>
        <TasaText variant="body" color={colors.inkMuted} style={styles.centered}>
          {t('review.pendingBody')}
        </TasaText>
        <Button
          label={t('fundTransfer.viewActivity')}
          variant="secondary"
          onPress={() => router.replace('/(tabs)/activity')}
        />
      </View>
    );
  }

  // Failed at the provider: the API has already refunded the wallet.
  if (transaction) {
    return (
      <ErrorView
        title={t('review.failedTitle')}
        message={t('review.refundedMessage')}
        primaryAction={{ label: t('common.tryAgain'), onPress: () => { checkout.reset(); loadQuote(); } }}
        secondaryAction={{ label: t('common.backToHome'), href: '/' }}
      />
    );
  }

  if (checkout.failure) {
    return (
      <CheckoutFailureView
        failure={checkout.failure}
        onRetry={checkout.retry}
        onEdit={() => {
          checkout.reset();
          loadQuote();
        }}
      />
    );
  }

  if (quoteState.status === 'error') {
    return (
      <ErrorView
        // Only say the account failed when it did: a low amount fails here too.
        title={
          quoteState.notVerified
            ? t(isElectricity ? 'review.verifyMeterFailed' : 'review.verifyAccountFailed')
            : t('review.cantContinue')
        }
        message={quoteState.message}
        primaryAction={{ label: t('common.editDetails') }}
        secondaryAction={{ label: t('common.tryAgain'), onPress: loadQuote }}
      />
    );
  }

  if (quoteState.status === 'loading') {
    return (
      // The receipt's shape while VTpass checks the account and we price it; the line says which.
      <Screen>
        <TasaText variant="body" color={colors.inkMuted} style={styles.skeletonNote}>
          {t(isElectricity ? 'review.verifyingMeter' : 'review.preparing')}
        </TasaText>
        <Card style={styles.skeletonReceipt}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonLine}>
              <Skeleton width={i === 0 ? '45%' : '35%'} height={12} />
              <Skeleton width={i === 4 ? '30%' : '22%'} height={i === 4 ? 18 : 12} />
            </View>
          ))}
        </Card>
        <Skeleton height={52} radius={theme.radius.md} />
      </Screen>
    );
  }

  const { quote } = quoteState;
  const { amount, fee, discount, total, customer, coupon } = quote;
  const alreadySaved =
    !!beneficiary ||
    beneficiaries.some(
      (item) => item.serviceId === params.service && item.accountNumber === params.account,
    );
  const canSave = !alreadySaved;
  const defaultLabel = (customer?.name ?? `${params.provider} ${serviceName}`).slice(0, 40);
  const labelToSave = saveLabel.trim().length >= 2 ? saveLabel.trim() : defaultLabel;
  const shortfall = balanceKnown ? maxKobo(kobo(0), subtractKobo(total, walletBalance)) : kobo(0);

  const reprice = async (extra: Pick<BillQuoteInput, 'couponCode' | 'autoApply'>) => {
    try {
      setQuoteState({ status: 'ready', quote: await priceBill(extra) });
      setCouponInput('');
      setCouponError(null);
      return true;
    } catch (error) {
      setCouponError(errorMessage(error));
      return false;
    }
  };

  const applyCoupon = () => {
    if (couponInput.trim()) reprice({ couponCode: couponInput.trim().toUpperCase() });
  };

  const pay = async () => {
    // Quotes last 15 minutes; a stale screen gets a fresh price rather than an error.
    if (new Date(quote.expiresAt).getTime() <= Date.now()) {
      await loadQuote();
      return;
    }
    savedAs.current = canSave && saveToBeneficiaries ? labelToSave : undefined;
    checkout.startWithQuote(quote, { skipPin: !profile.billPinEnabled });
  };

  return (
    <Screen
      footer={
        <Button
          disabled={shortfall > 0}
          label={total === 0 ? t('review.confirm') : t('review.pay', { amount: formatNaira(total) })}
          onPress={pay}
        />
      }>
      <Card style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headTitle}>
            <ServiceIcon serviceId={getServiceById(params.service).id} size={fontSize(22)} />
            <View style={styles.headCopy}>
              <TasaText variant="bodyMedium" numberOfLines={1}>{serviceName}</TasaText>
              <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
                {params.provider}
                {beneficiary ? ` · ${beneficiary.label}` : ''}
              </TasaText>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('review.editA11y')}
            hitSlop={8}
            onPress={() => router.back()}
            style={styles.editButton}>
            <TasaText variant="caption" color={colors.brand}>
              {t('common.edit')}
            </TasaText>
          </Pressable>
        </View>

        {customer && (
          <View style={styles.verified}>
            <View style={styles.verifiedBadge}>
              <Icon color={colors.success} ios="checkmark" android="check" size={14} />
              <TasaText variant="caption" color={colors.success}>
                {t(isElectricity ? 'review.meterVerified' : 'review.accountVerified')}
              </TasaText>
            </View>
            <Row label={t('review.customer')} value={customer.name} />
            {customer.address && <Row label={t('review.address')} value={customer.address} lines={2} />}
            {customer.detail && <Row label={customer.detail.label} value={customer.detail.value} />}
          </View>
        )}
        <Row label={accountLabel} value={params.account} />
        {!!quote.planName && <Row label={params.service === 'jamb' ? t('bill.service') : t('review.plan')} value={quote.planName} />}

        <View style={styles.divider} />
        <Row label={t('common.amount')} value={formatNaira(amount)} />
        {quote.charges.map((charge, index) => (
          <Row key={`${charge.code}-${index}`} label={charge.label} value={formatNaira(charge.amount)} />
        ))}
        {quote.charges.length === 0 && <Row label={t('review.serviceCharge')} value={t('review.free')} />}
        {!!coupon && (
          <Row
            label={t('review.couponLine', { code: coupon.code })}
            value={`−${formatNaira(discount)}`}
            tone={colors.success}
          />
        )}

        <View style={styles.divider} />
        <View style={styles.totalRow}>
          <TasaText variant="bodyMedium">{t('review.youPay')}</TasaText>
          <TasaText variant="subtitle" color={colors.heading} numberOfLines={1}>
            {formatNaira(total)}
          </TasaText>
        </View>
        {quote.pointsToEarn > 0 && (
          <Row
            label={t('review.pointsToEarn')}
            value={`+${quote.pointsToEarn.toLocaleString('en-NG')}`}
            tone={colors.success}
          />
        )}
        {!!coupon && discount === amount && (
          <TasaText variant="caption" color={colors.success}>
            {t(total === 0 ? 'review.coveredFull' : 'review.coveredBill')}
          </TasaText>
        )}
      </Card>

      {canSave && (
        <View style={styles.save}>
          <View style={styles.saveRow}>
            <View style={styles.saveCopy}>
              <TasaText variant="bodyMedium">{t('review.saveBeneficiary')}</TasaText>
              <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
                {t('review.saveHint')}
              </TasaText>
            </View>
            <Switch
              accessibilityLabel={t('review.saveBeneficiary')}
              value={saveToBeneficiaries}
              onValueChange={setSaveToBeneficiaries}
              trackColor={{ false: colors.track, true: colors.brand }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={colors.track}
            />
          </View>
          {saveToBeneficiaries && (
            <Input
              last
              label={t('review.saveLabel')}
              maxLength={40}
              placeholder={defaultLabel}
              value={saveLabel}
              onChangeText={setSaveLabel}
            />
          )}
        </View>
      )}

      <TasaText variant="label" color={colors.inkMuted} style={styles.couponLabel}>
        {t('review.coupon')}
      </TasaText>
      {coupon ? (
        <View style={styles.appliedCoupon}>
          <Icon color={colors.success} ios="ticket.fill" android="confirmation_number" size={20} />
          <View style={styles.appliedCopy}>
            <TasaText variant="bodyMedium">{coupon.code}</TasaText>
            <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1}>
              {t('review.saves', { title: coupon.title, amount: formatNaira(discount) })}
            </TasaText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('review.removeCoupon')}
            hitSlop={10}
            onPress={() => reprice({ autoApply: false })}>
            <Icon color={colors.inkSubtle} ios="xmark" android="close" size={18} />
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.couponRow}>
            <Input
              last
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={t('review.couponPlaceholder')}
              error={couponError ? ' ' : null}
              style={styles.couponInput}
              value={couponInput}
              onChangeText={(text) => {
                setCouponInput(text);
                setCouponError(null);
              }}
              onSubmitEditing={applyCoupon}
            />
            <Button
              disabled={!couponInput.trim()}
              label={t('common.apply')}
              variant="secondary"
              onPress={applyCoupon}
              style={styles.applyButton}
            />
          </View>
          {couponError && (
            <TasaText variant="caption" color={colors.danger} style={styles.couponError}>
              {couponError}
            </TasaText>
          )}
        </>
      )}

      {shortfall > 0 ? (
        <View style={styles.shortfall}>
          <TasaText variant="caption" color={colors.ink} numberOfLines={2} style={styles.shortfallCopy}>
            {t('review.walletShort', {
              balance: formatNaira(walletBalance),
              shortfall: formatNaira(shortfall),
            })}
          </TasaText>
          <Pressable accessibilityRole="button" onPress={() => router.push('/wallet/fund')}>
            <TasaText variant="bodyMedium" color={colors.brand}>
              {t('review.fundWallet')}
            </TasaText>
          </Pressable>
        </View>
      ) : (
        <TasaText variant="caption" color={colors.inkMuted} style={styles.balance}>
          {t('review.payingFrom', { balance: formatNaira(walletBalance) })}
        </TasaText>
      )}

      <PinSheet
        {...checkout.pinSheet}
        title={t('checkout.pinTitle')}
        processingTitle={t('processing.bill')}
        detail={t('review.pay', { amount: formatNaira(total) })}
      />
    </Screen>
  );
}


// Summary lines are compact and clamped so the whole review fits without scrolling.
function Row({
  label,
  value,
  tone,
  strong,
  lines = 1,
}: {
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
  /** Most values are one line; an address may wrap once. */
  lines?: number;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <TasaText variant="caption" color={colors.inkMuted} numberOfLines={1} style={styles.rowLabel}>
        {label}
      </TasaText>
      <TasaText
        variant="bodyMedium"
        color={tone ?? colors.ink}
        numberOfLines={lines}
        style={strong ? styles.rowValueStrong : styles.rowValue}>
        {value}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.md,
      backgroundColor: colors.surface,
    },
    skeletonNote: {
      marginBottom: theme.spacing.md,
    },
    skeletonReceipt: {
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    skeletonLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    recurringButton: {
      marginTop: theme.spacing.md,
    },
    save: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    saveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    saveCopy: {
      flex: 1,
      gap: 2,
    },
    centered: {
      textAlign: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    card: {
      gap: 6,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    headTitle: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headCopy: {
      flex: 1,
    },
    editButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: colors.overlay,
    },
    verified: {
      gap: 4,
      marginTop: 2,
      padding: 10,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
    },
    verifiedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    rowLabel: {
      flexShrink: 0,
      maxWidth: '45%',
    },
    rowValue: {
      flexShrink: 1,
      textAlign: 'right',
      fontSize: 13,
      lineHeight: 18,
    },
    rowValueStrong: {
      flexShrink: 1,
      textAlign: 'right',
    },
    couponLabel: {
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    couponRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    couponInput: {
      flex: 1,
      marginBottom: 0,
    },
    applyButton: {
      minWidth: 96,
    },
    couponError: {
      marginTop: theme.spacing.sm,
    },
    appliedCoupon: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.success,
      backgroundColor: `${colors.success}14`,
    },
    appliedCopy: {
      flex: 1,
      gap: 2,
    },
    shortfall: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: theme.spacing.md,
      padding: 10,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      backgroundColor: colors.dangerSoft,
      borderColor: colors.dangerSoftBorder,
    },
    shortfallCopy: {
      flex: 1,
    },
    balance: {
      marginTop: theme.spacing.lg,
    },
  }),
);
