import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { SpendingChart } from '@/components/ui/Actions';
import { Button, Card } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useCopyToClipboard, useSnackbar } from '@/components/ui/Snackbar';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { ServiceIcon } from '@/components/ui/Icon';
import { getServiceById, getServiceColor } from '@/constants/data';
import { fontSize, theme } from '@/constants/theme';
import { useActivity } from '@/hooks/usePayments';
import {
  useAutoPayOptIn,
  useAutoPayTerms,
  useBeneficiaries,
  useRemoveBeneficiary,
} from '@/hooks/useSaved';
import { errorMessage } from '@/lib/api/errors';
import { formatNaira } from '@/lib/format';
import { beneficiarySpendingSeries } from '@/lib/insights';
import { averageKobo, roundToNaira, sumKobo } from '@/lib/money';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export default function BeneficiaryDetailScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const copy = useCopyToClipboard();
  const { show } = useSnackbar();
  const query = useBeneficiaries();
  const { items: activity } = useActivity({ beneficiaryId: id });
  const optIn = useAutoPayOptIn(id);
  const removeBeneficiary = useRemoveBeneficiary();
  const terms = useAutoPayTerms();
  const [accepted, setAccepted] = useState(false);

  const beneficiary = query.data?.find((item) => item.id === id);
  const series = useMemo(
    () => (beneficiary ? beneficiarySpendingSeries(activity, beneficiary.id) : []),
    [activity, beneficiary],
  );
  const amounts = series.map((point) => point.amount);
  const total = sumKobo(amounts);
  const average = averageKobo(amounts);

  if (!beneficiary) {
    return (
      <Screen scroll={false}>
        <QueryState query={query} hasData={!!query.data} skeleton="detail" />
        {query.data && <TasaText variant="title">{t('beneficiaries.notFound')}</TasaText>}
      </Screen>
    );
  }

  const service = getServiceById(beneficiary.serviceId);
  const color = getServiceColor(beneficiary.serviceId);
  const virtualAccount = beneficiary.virtualAccount;

  return (
    <Screen refreshable>
      <View style={[styles.hero, { backgroundColor: `${color}18` }]}>
        <ServiceIcon serviceId={service.id} size={fontSize(32)} style={styles.heroIcon} />
        <TasaText variant="title" numberOfLines={2}>{beneficiary.label}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t(`services.${beneficiary.serviceId}.name`)} · {beneficiary.provider}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t(`services.${beneficiary.serviceId}.account`)}: {beneficiary.accountNumber}
        </TasaText>
        {!!beneficiary.customerName && (
          <TasaText variant="caption" color={colors.success}>
            {t('beneficiaries.verifiedAs', { name: beneficiary.customerName })}
          </TasaText>
        )}
      </View>

      <SectionHeader title={t('beneficiaries.spending')} />
      {series.length === 0 ? (
        <Card>
          <TasaText variant="body" color={colors.inkMuted}>
            {t('beneficiaries.empty', { label: beneficiary.label })}
          </TasaText>
        </Card>
      ) : (
        <>
          <View style={styles.statsRow}>
            <Card style={styles.stat}>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('insight.total6')}
              </TasaText>
              <TasaText variant="title" color={color}>
                {formatNaira(total)}
              </TasaText>
            </Card>
            <Card style={styles.stat}>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t('insight.average')}
              </TasaText>
              <TasaText variant="title" color={color}>
                {formatNaira(roundToNaira(average))}
              </TasaText>
            </Card>
          </View>
          <Card style={styles.chartCard}>
            <SpendingChart color={color} data={series} />
          </Card>
        </>
      )}

      <SectionHeader title={t('beneficiaries.virtualAccount')} />
      {virtualAccount ? (
        <Card style={styles.virtualAccountCard}>
          <TasaText variant="body" color={colors.inkMuted}>
            {t('beneficiaries.virtualBody', {
              service: t(`services.${beneficiary.serviceId}.name`).toLowerCase(),
              label: beneficiary.label,
            })}
          </TasaText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('cards.copyVirtual')}
            onPress={() => copy(virtualAccount.accountNumber, t('cards.virtualCopied'))}
            style={styles.virtualAccountRow}>
            <View>
              <TasaText variant="caption" color={colors.inkSubtle}>
                {virtualAccount.bankName}
              </TasaText>
              <TasaText variant="bodyMedium">{virtualAccount.accountNumber}</TasaText>
              <TasaText variant="caption" color={colors.inkSubtle}>
                {virtualAccount.accountName}
              </TasaText>
            </View>
            <TasaText variant="caption" color={colors.brand}>
              {t('common.copy')}
            </TasaText>
          </Pressable>
        </Card>
      ) : (
        <Card style={styles.virtualAccountCard}>
          <TasaText variant="body" color={colors.inkMuted}>
            {t('beneficiaries.autoPayBody')}
          </TasaText>
          {!!terms.data?.url && (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(terms.data.url)}>
              <TasaText variant="bodyMedium" color={colors.brand}>
                {t('beneficiaries.autoPayTerms')}
              </TasaText>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            onPress={() => setAccepted((current) => !current)}
            style={styles.accept}>
            <View style={[styles.checkbox, accepted && styles.checkboxOn]} />
            <TasaText variant="caption" color={colors.ink} style={styles.acceptCopy}>
              {t('beneficiaries.autoPayAccept')}
            </TasaText>
          </Pressable>
          <Button
            label={t('beneficiaries.autoPayCta')}
            disabled={!accepted}
            loading={optIn.isPending}
            onPress={() =>
              optIn.mutate(undefined, {
                onError: (error) => show(errorMessage(error), { tone: 'error' }),
              })
            }
          />
        </Card>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={removeBeneficiary.isPending}
        onPress={() =>
          removeBeneficiary.mutate(beneficiary.id, {
            onSuccess: () => router.back(),
            onError: (error) => show(errorMessage(error), { tone: 'error' }),
          })
        }
        style={styles.remove}>
        <TasaText variant="bodyMedium" color={colors.danger}>
          {t('beneficiaries.remove')}
        </TasaText>
      </Pressable>
    </Screen>
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
    statsRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: theme.spacing.md,
    },
    stat: {
      flex: 1,
      gap: 6,
    },
    chartCard: {
      gap: 12,
    },
    virtualAccountCard: {
      gap: 12,
      marginBottom: theme.spacing.md,
    },
    virtualAccountRow: {
      padding: 12,
      borderRadius: theme.radius.md,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    accept: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    acceptCopy: {
      flex: 1,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.border,
    },
    checkboxOn: {
      borderColor: colors.brand,
      backgroundColor: colors.brand,
    },
    remove: {
      alignItems: 'center',
      paddingVertical: theme.spacing.md,
    },
  }),
);
