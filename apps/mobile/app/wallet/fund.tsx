import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen, TasaText } from '@/components/ui/Screen';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { fontSize, theme } from '@/constants/theme';
import { formatNaira } from '@/lib/format';
import { formatNairaNumber, kobo, parseAmountInput } from '@/lib/money';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

// ₦5,000, ₦10,000, ₦20,000 and ₦50,000.
const amounts = [kobo(500_000), kobo(1_000_000), kobo(2_000_000), kobo(5_000_000)];
const MIN_AMOUNT = kobo(10_000);
const MAX_AMOUNT = kobo(500_000_000);

export default function FundWalletScreenGated() {
  return (
    <FeatureGate feature="funding">
      <FundWalletScreen />
    </FeatureGate>
  );
}

function FundWalletScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const [amount, setAmount] = useState(kobo(1_000_000));

  const tooSmall = amount > 0 && amount < MIN_AMOUNT;
  const tooLarge = amount > MAX_AMOUNT;
  const isValid = amount >= MIN_AMOUNT && !tooLarge;

  const onChangeAmount = (text: string) => setAmount(parseAmountInput(text));

  return (
    <Screen
      footer={
        <Button
          disabled={!isValid}
          label={isValid ? t('fund.continue', { amount: formatNaira(amount) }) : t('fund.enterAmount')}
          onPress={() =>
            router.push({ pathname: '/wallet/fund-transfer', params: { amount: String(amount) } })
          }
        />
      }>
      <TasaText variant="body" color={colors.inkMuted}>
        {t('fund.intro')}
      </TasaText>

      <View style={[styles.amountField, (tooSmall || tooLarge) && styles.amountFieldError]}>
        <TasaText variant="label" color={colors.inkMuted}>
          {t('common.amount')}
        </TasaText>
        <View style={styles.amountRow}>
          <TasaText variant="display" color={colors.inkSubtle}>
            ₦
          </TasaText>
          <TextInput
            accessibilityLabel={t('fund.amountA11y')}
            returnKeyType="done"
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.inkSubtle}
            selectionColor={colors.brand}
            style={styles.amountInput}
            value={amount ? formatNairaNumber(amount) : ''}
            onChangeText={onChangeAmount}
          />
        </View>
        <TasaText variant="caption" color={tooSmall || tooLarge ? colors.danger : colors.inkMuted}>
          {tooLarge
            ? t('fund.max', { amount: formatNaira(MAX_AMOUNT) })
            : t('fund.min', { amount: formatNaira(MIN_AMOUNT) })}
        </TasaText>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/wallet/account')}
        style={styles.permanent}>
        <TasaText variant="bodyMedium" color={colors.brand}>
          {t('fund.permanentAccount')}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {t('fund.permanentHint')}
        </TasaText>
      </Pressable>

      <View style={styles.amountGrid}>
        {amounts.map((preset) => {
          const selected = amount === preset;
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setAmount(preset)}
              style={[styles.amountChip, selected && styles.amountChipActive]}>
              <TasaText variant="bodyMedium" color={selected ? '#FFFFFF' : colors.brand}>
                {formatNaira(preset, true)}
              </TasaText>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    amountField: {
      marginTop: theme.spacing.lg,
      padding: theme.spacing.md,
      gap: 6,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    amountFieldError: {
      borderColor: colors.danger,
    },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    amountInput: {
      flex: 1,
      paddingVertical: 4,
      fontFamily: theme.fonts.display,
      fontSize: fontSize(28),
      letterSpacing: -0.5,
      color: colors.heading,
    },
    permanent: {
      gap: 2,
      marginTop: theme.spacing.md,
    },
    amountGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: theme.spacing.md,
    },
    amountChip: {
      minWidth: '47%',
      minHeight: 52,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
    },
    amountChipActive: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
  }),
);
