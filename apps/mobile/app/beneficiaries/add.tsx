import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProviderPicker } from '@/components/ui/ProviderPicker';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { SuccessView, useResultScreen } from '@/components/ui/StatusView';
import { ServiceIcon } from '@/components/ui/Icon';
import { Beneficiary, ServiceId, utilityServices } from '@/constants/data';
import { theme } from '@/constants/theme';
import { accountRule, checkAccountNumber } from '@/lib/validation';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useBillServices } from '@/hooks/usePayments';
import { useNetworkDetection } from '@/hooks/useNetworkDetection';
import { useCreateBeneficiary } from '@/hooks/useSaved';
import { errorMessage } from '@/lib/api/errors';

export default function AddBeneficiaryScreen() {
  const styles = useStyles();
  const t = useT();
  const { colors } = useTheme();
  const { show } = useSnackbar();
  const createBeneficiary = useCreateBeneficiary();
  const { data: services } = useBillServices();
  const [created, setCreated] = useState<Beneficiary | null>(null);
  const [label, setLabel] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [provider, setProvider] = useState('');
  const [serviceId, setServiceId] = useState<ServiceId>('electricity');
  // The disco needs the meter type to find the meter, so it's asked before saving.
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');

  const [accountTouched, setAccountTouched] = useState(false);
  const providers = services?.find((service) => service.id === serviceId)?.providers ?? [];
  const accountCheck = checkAccountNumber(serviceId, accountNumber);
  const network = useNetworkDetection(serviceId, providers, setProvider);

  useResultScreen(!!created);

  if (created) {
    return (
      <SuccessView
        title={t('beneficiaries.createdTitle')}
        message={[
          created.customerName ? t('beneficiaries.verifiedAs', { name: created.customerName }) : null,
          t('beneficiaries.createdBody', {
            label: created.label,
            service: t(`services.${created.serviceId}.name`).toLowerCase(),
          }),
        ]
          .filter(Boolean)
          .join('\n\n')}
        secondaryAction={{
          label: t('beneficiaries.viewBeneficiary'),
          href: `/beneficiaries/${created.id}`,
          mode: 'replace',
        }}
      />
    );
  }

  return (
    <Screen
      footer={
        <Button
          disabled={!label || !!accountCheck.error || !provider}
          label={createBeneficiary.isPending ? t('beneficiaries.checking') : t('beneficiaries.create')}
          loading={createBeneficiary.isPending}
          onPress={() =>
            createBeneficiary.mutate(
              { label: label.trim(), serviceId, provider, account: accountCheck.value, ...(serviceId === 'electricity' && { meterType }) },
              {
                onSuccess: setCreated,
                onError: (error) => show(errorMessage(error), { tone: 'error' }),
              },
            )
          }
        />
      }>
      <SectionHeader title={t('beneficiaries.service')} />
      <View style={styles.grid}>
        {utilityServices.map((service) => (
          <Pressable
            key={service.id}
            onPress={() => {
              setServiceId(service.id);
              setProvider('');
              network.reset();
            }}
            accessibilityRole="button"
            accessibilityLabel={t(`services.${service.id}.name`)}
            accessibilityState={{ selected: serviceId === service.id }}
            style={[styles.chip, serviceId === service.id && styles.chipActive]}>
            <ServiceIcon serviceId={service.id} color={serviceId === service.id ? '#FFFFFF' : undefined} />
          </Pressable>
        ))}
      </View>
      <View style={styles.selected}>
        <TasaText variant="bodyMedium">{t(`services.${serviceId}.name`)}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t(`services.${serviceId}.subtitle`)}
        </TasaText>
      </View>

      <Input
        label={t('beneficiaries.label')}
        placeholder={t('beneficiaries.labelPlaceholder')}
        style={styles.field}
        value={label}
        onChangeText={setLabel}
      />

      <TasaText variant="label" color={colors.inkMuted}>
        {t('beneficiaries.provider')}
      </TasaText>
      <ProviderPicker
        label={t('beneficiaries.provider')}
        providers={providers}
        value={provider}
        onChange={(code) => {
          setProvider(code);
          network.onManualPick();
        }}
      />

      {serviceId === 'electricity' && (
        <View style={styles.field}>
          <SegmentedControl
            options={[
              { value: 'prepaid', label: t('bill.prepaid') },
              { value: 'postpaid', label: t('bill.postpaid') },
            ]}
            value={meterType}
            onChange={setMeterType}
          />
        </View>
      )}

      <Input
        label={t(`services.${serviceId}.account`)}
        last
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType={accountRule(serviceId).keyboardType}
        placeholder={accountRule(serviceId).placeholder}
        error={accountTouched || (serviceId === 'airtime' && accountCheck.value.length >= 11) ? accountCheck.error : null}
        hint={
          network.detectedName
            ? t('bill.networkDetected', { network: network.detectedName })
            : undefined
        }
        style={styles.field}
        value={accountNumber}
        onBlur={() => setAccountTouched(true)}
        onChangeText={(text) => {
          setAccountNumber(accountRule(serviceId).limit?.(text) ?? text);
          network.onType(text);
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: theme.spacing.sm,
    },
    selected: {
      gap: 2,
      marginBottom: theme.spacing.lg,
    },
    chip: {
      width: 52,
      height: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
    },
    chipActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    field: {
      gap: 8,
      marginBottom: theme.spacing.lg,
    },
  }),
);
