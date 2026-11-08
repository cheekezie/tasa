import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { MiniBars } from '@/components/ui/Actions';
import { Button } from '@/components/ui/Button';
import { AmountInput, Input } from '@/components/ui/Input';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { Icon, ServiceIcon } from '@/components/ui/Icon';
import { ProviderPicker } from '@/components/ui/ProviderPicker';
import { SelectField } from '@/components/ui/SelectField';
import { useCopyToClipboard } from '@/components/ui/Snackbar';
import { Skeleton } from '@/components/ui/Skeleton';
import { ServiceId, getServiceById, getServiceColor, planCopy } from '@/constants/data';
import { fontSize, theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount } from '@/hooks/useAccount';
import { usePromotions } from '@/hooks/useOffers';
import { useBillServices, useInsights, usePlans } from '@/hooks/usePayments';
import { useNetworkDetection } from '@/hooks/useNetworkDetection';
import { useBeneficiaries } from '@/hooks/useSaved';
import { formatNaira } from '@/lib/format';
import { errorMessage } from '@/lib/api/errors';
import { Plan, promoFits } from '@/lib/api/mappers';
import { kobo } from '@/lib/money';
import { accountRule, checkAccountNumber } from '@/lib/validation';

export default function PayBillScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { service } = useLocalSearchParams<{ service: ServiceId }>();
  const { walletBalance } = useAccount();
  const { data: beneficiaries = [] } = useBeneficiaries();
  const { data: insights } = useInsights(service);
  const { data: services } = useBillServices();
  const { data: promotions = [] } = usePromotions();
  const copyToClipboard = useCopyToClipboard();
  const [provider, setProvider] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [parsedAmount, setAmount] = useState(kobo(0));
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string | null>(null);
  const [accountTouched, setAccountTouched] = useState(false);
  const [product, setProduct] = useState<'airtime' | 'data'>('airtime');
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [plan, setPlan] = useState<Plan | null>(null);

  const catalog = services?.find((item) => item.id === service);
  const planBased = service === 'tv' || service === 'internet' || service === 'jamb' || product === 'data';
  const plans = usePlans(service, provider, planBased);
  const selectProvider = useCallback((code: string) => {
    setProvider(code);
    setPlan(null);
    setSelectedBeneficiaryId(null);
  }, []);
  const network = useNetworkDetection(service, catalog?.providers ?? [], selectProvider);

  const billService = useMemo(() => getServiceById(service), [service]);
  const color = getServiceColor(service);
  const spendingSeries = insights?.series ?? [];
  const totalSpent = insights?.total ?? kobo(0);
  const t = useT();
  // WAEC PINs aren't tied to a candidate: they go to a phone number.
  const accountType = service === 'jamb' && provider === 'WAEC' ? 'airtime' : service;
  const accountLabel = t(`services.${accountType}.account`);
  const rule = accountRule(accountType);
  const accountCheck = checkAccountNumber(accountType, account);
  const copy = planCopy(service);
  // A full phone number can already be judged, without waiting for them to leave the field.
  const accountComplete = !!rule.limit && accountCheck.value.length >= 11;
  const showAccountError = (accountTouched || accountComplete) && !!account && !!accountCheck.error;
  const matchingBeneficiaries = beneficiaries.filter((item) => item.serviceId === service);
  const minAmount = catalog?.providers.find((item) => item.code === provider)?.minAmount ?? kobo(0);
  const belowMinimum = !planBased && parsedAmount > 0 && parsedAmount < minAmount;
  // Seen before they commit to an amount, so the minimum can shape what they pay.
  const offer = promotions.find((promo) => promoFits(promo, service, provider ?? '', promo.minSpend));
  const navigation = useNavigation();
  const accountValue = account ? accountCheck.value : '';

  // Exam PINs are one-offs, so they have nothing to repeat.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight:
        service === 'jamb'
          ? undefined
          : () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('bill.setupRecurring')}
                hitSlop={8}
                onPress={() =>
                  router.push({
                    pathname: '/recurring/setup',
                    params: {
                      service,
                      provider: provider ?? '',
                      account: accountValue,
                      amount: plan ? String(plan.amount) : parsedAmount ? String(parsedAmount) : '',
                      planCode: plan?.code ?? '',
                      product,
                      meterType,
                    },
                  })
                }
                style={styles.recurringButton}>
                <Icon color={colors.brand} ios="arrow.triangle.2.circlepath" android="autorenew" size={15} />
                <TasaText variant="caption" color={colors.brand}>
                  {t('bill.recurring')}
                </TasaText>
              </Pressable>
            ),
    });
  }, [navigation, service, provider, accountValue, plan, parsedAmount, product, meterType, colors, styles, t]);

  return (
    <Screen
      refreshable
      footer={
        <Button
          disabled={
            !catalog?.available ||
            !provider ||
            !!accountCheck.error ||
            (planBased ? !plan : parsedAmount <= 0) ||
            belowMinimum
          }
          label={t('common.continue')}
          onPress={() =>
            router.push({
              pathname: '/bills/review',
              params: {
                service,
                provider: provider ?? '',
                account: accountCheck.value,
                amount: planBased ? '' : String(parsedAmount),
                beneficiaryId: selectedBeneficiaryId ?? '',
                product,
                meterType,
                planCode: plan?.code ?? '',
              },
            })
          }
        />
      }>
      <View style={[styles.hero, { backgroundColor: `${color}18` }]}>
        <ServiceIcon serviceId={billService.id} size={fontSize(32)} style={styles.heroIcon} />
        <TasaText variant='title'>{t(`services.${service}.name`)}</TasaText>
        <TasaText variant='caption' color={colors.inkMuted}>
          {t(`services.${service}.subtitle`)}
        </TasaText>
      </View>

      {offer && (
        <View style={styles.promo}>
          <TasaText variant='bodyMedium' numberOfLines={1}>
            {offer.title}
          </TasaText>
          {!!offer.summary && (
            <TasaText variant='caption' color={colors.inkMuted} numberOfLines={1}>
              {offer.summary}
            </TasaText>
          )}
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`${t('common.copy')} ${offer.code}`}
            hitSlop={6}
            onPress={() => copyToClipboard(offer.code, t('couponDetail.copied'))}
            style={styles.promoCode}>
            <TasaText variant='caption' color={colors.accentHot}>
              {offer.code}
            </TasaText>
            <Icon color={colors.accentHot} ios="doc.on.doc" android="content_copy" size={12} />
            <TasaText variant='caption' color={colors.accentHot}>
              {t('common.copy')}
            </TasaText>
          </Pressable>
        </View>
      )}

      <SectionHeader
        action={
          <Pressable onPress={() => router.push(`/bills/insight/${service}`)}>
            <TasaText variant='caption' color={colors.brand}>
              {t('bill.fullInsight')}
            </TasaText>
          </Pressable>
        }
        title={t('bill.yourSpending')}
      />
      <View style={styles.insightCard}>
        <View style={styles.insightCopy}>
          <TasaText variant='caption' color={colors.inkMuted}>
            {t('bill.last6')}
          </TasaText>
          <TasaText variant='title' color={color} numberOfLines={1}>
            {t('bill.total', { amount: formatNaira(totalSpent) })}
          </TasaText>
        </View>
        <MiniBars color={color} data={spendingSeries} />
      </View>

      {matchingBeneficiaries.length > 0 && (
        <>
          <SectionHeader title={t('bill.savedBeneficiary')} />
          <View style={styles.providers}>
            {matchingBeneficiaries.map((beneficiary) => (
              <Pressable
                key={beneficiary.id}
                onPress={() => {
                  setSelectedBeneficiaryId(beneficiary.id);
                  setProvider(beneficiary.provider);
                  setPlan(null);
                  setAccount(beneficiary.accountNumber);
                  network.reset();
                }}
                style={[styles.providerChip, selectedBeneficiaryId === beneficiary.id && styles.providerChipActive]}
              >
                <TasaText
                  variant='caption'
                  color={selectedBeneficiaryId === beneficiary.id ? '#FFFFFF' : colors.brand}
                  numberOfLines={1}
                >
                  {beneficiary.label}
                </TasaText>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <SectionHeader title={t('bill.payNow')} />
      {!catalog && (
        // The provider chips' shape until the catalogue arrives.
        <View style={styles.providerSkeleton}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width={84} height={40} radius={theme.radius.pill} />
          ))}
        </View>
      )}
      {catalog && (
        <ProviderPicker
          label={t('bill.provider')}
          providers={catalog.providers}
          value={provider}
          onChange={(code) => {
            selectProvider(code);
            network.onManualPick();
          }}
        />
      )}
      {catalog && !catalog.available && (
        <TasaText variant='caption' color={colors.danger} style={styles.notice}>
          {catalog.pausedMessage ?? t('bill.unavailable')}
        </TasaText>
      )}

      {service === 'airtime' && (
        <ChoiceRow
          options={[
            { value: 'airtime', label: t('bill.productAirtime') },
            { value: 'data', label: t('bill.productData') },
          ]}
          selected={product}
          onSelect={(next) => {
            setProduct(next);
            setPlan(null);
          }}
        />
      )}
      {service === 'electricity' && (
        <ChoiceRow
          options={[
            { value: 'prepaid', label: t('bill.prepaid') },
            { value: 'postpaid', label: t('bill.postpaid') },
          ]}
          selected={meterType}
          onSelect={setMeterType}
        />
      )}

      <Input
        label={accountLabel}
        autoCapitalize='characters'
        autoCorrect={false}
        keyboardType={rule.keyboardType}
        placeholder={rule.placeholder}
        error={showAccountError ? accountCheck.error : null}
        hint={
          network.detectedName
            ? t('bill.networkDetected', { network: network.detectedName })
            : undefined
        }
        value={account}
        onBlur={() => setAccountTouched(true)}
        onChangeText={(typed) => {
          const text = rule.limit?.(typed) ?? typed;
          setAccount(text);
          setSelectedBeneficiaryId(null);
          network.onType(text);
        }}
      />

      {planBased ? (
        provider && (
          <>
            <SectionHeader title={t(copy.section)} />
            {plans.isPending && <ActivityIndicator color={colors.brand} />}
            {plans.isError && (
              <TasaText variant='caption' color={colors.danger}>
                {errorMessage(plans.error)}
              </TasaText>
            )}
            {plans.data && (
              <SelectField
                title={t(copy.title)}
                placeholder={t(copy.placeholder)}
                value={plan?.code ?? null}
                onChange={(code) => setPlan(plans.data.find((item) => item.code === code) ?? null)}
                // Cheapest first.
                options={[...plans.data]
                  .sort((a, b) => a.amount - b.amount)
                  .map((item) => ({
                    value: item.code,
                    label: item.name,
                    detail: formatNaira(item.amount),
                  }))}
              />
            )}
          </>
        )
      ) : (
        <AmountInput
          label={t('common.amount')}
          last
          error={belowMinimum ? t('bill.minAmount', { amount: formatNaira(minAmount) }) : null}
          hint={t('bill.walletBalance', { amount: formatNaira(walletBalance) })}
          value={parsedAmount}
          onChangeValue={setAmount}
        />
      )}
    </Screen>
  );
}

function ChoiceRow<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.providers}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onSelect(option.value)}
          style={[styles.providerChip, selected === option.value && styles.providerChipActive]}
        >
          <TasaText variant='caption' color={selected === option.value ? '#FFFFFF' : colors.brand}>
            {option.label}
          </TasaText>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hero: {
      borderRadius: theme.radius.xl,
      padding: theme.spacing.lg,
      alignItems: 'flex-start',
      gap: 4,
      marginBottom: theme.spacing.md,
    },
    heroIcon: {
      marginBottom: 4,
    },
    promo: {
      gap: 2,
      marginBottom: theme.spacing.md,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.warmSoftBorder,
      backgroundColor: colors.warmSoft,
    },
    promoCode: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
    },
    insightCard: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    insightCopy: {
      flex: 1,
      gap: 2,
    },
    providers: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: theme.spacing.md,
    },
    providerChip: {
      paddingHorizontal: 14,
      maxWidth: 200,
      paddingVertical: 10,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    providerChipActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    providerSkeleton: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    notice: {
      marginBottom: theme.spacing.md,
    },
    recurringButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 6,
    },
  }),
);
