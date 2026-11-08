import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { BeneficiaryRow } from '@/components/ui/FeatureCards';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState, Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useBeneficiaries } from '@/hooks/useSaved';

export default function BeneficiariesScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const query = useBeneficiaries();
  const beneficiaries = query.data ?? [];

  return (
    <Screen
      refreshable
      footer={
        <Button
          label={t('beneficiaries.add')}
          onPress={() => router.push('/beneficiaries/add')}
        />
      }>
      <View style={styles.hero}>
        <TasaText variant="bodyMedium">{t('beneficiaries.heroTitle')}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('beneficiaries.heroBody')}
        </TasaText>
      </View>

      <SectionHeader title={t('beneficiaries.saved')} />
      <QueryState query={query} hasData={!!query.data} />
      {query.data && beneficiaries.length === 0 && <EmptyState message={t('beneficiaries.empty')} />}
      {beneficiaries.map((beneficiary) => (
        <Pressable key={beneficiary.id} onPress={() => router.push(`/beneficiaries/${beneficiary.id}`)}>
          <BeneficiaryRow beneficiary={beneficiary} />
        </Pressable>
      ))}
    </Screen>
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
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
  }),
);
