import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { PinSheet } from '@/components/ui/PinSheet';
import { Screen, SectionHeader, TasaText } from '@/components/ui/Screen';
import { useSnackbar } from '@/components/ui/Snackbar';
import { theme } from '@/constants/theme';
import { useSettings } from '@/context/SettingsContext';
import { ThemePreference, makeStyles, useTheme } from '@/context/ThemeContext';
import { useAccount, useSetBillPin } from '@/hooks/useAccount';
import { KeysOf, languages } from '@/lib/i18n';

const appearanceOptions: { value: ThemePreference; label: KeysOf<'settings'>; hint: KeysOf<'settings'> }[] = [
  { value: 'system', label: 'settings.system', hint: 'settings.systemHint' },
  { value: 'light', label: 'settings.light', hint: 'settings.lightHint' },
  { value: 'dark', label: 'settings.dark', hint: 'settings.darkHint' },
];

export default function SettingsScreen() {
  const { preference, setPreference, colors } = useTheme();
  const { profile, balanceKnown } = useAccount();
  const setBillPin = useSetBillPin();
  const { show } = useSnackbar();
  // The switch only moves once the PIN has confirmed it.
  const [pendingBillPin, setPendingBillPin] = useState<boolean | null>(null);
  const { language, setLanguage, t } = useSettings();
  const styles = useStyles();

  return (
    <Screen>
      <Stack.Screen options={{ title: t('settings.title') }} />

      <SectionHeader title={t('settings.security')} />
      <View style={styles.group}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <TasaText variant="bodyMedium">{t('settings.billPin')}</TasaText>
            <TasaText variant="caption" color={colors.inkMuted}>
              {t('settings.billPinHint')}
            </TasaText>
          </View>
          <Switch
            accessibilityLabel={t('settings.billPin')}
            disabled={!balanceKnown}
            value={profile.billPinEnabled}
            onValueChange={setPendingBillPin}
            trackColor={{ false: colors.track, true: colors.brand }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={colors.track}
          />
        </View>
      </View>

      <SectionHeader title={t('settings.appearance')} />
      <View accessibilityRole="radiogroup" style={styles.group}>
        {appearanceOptions.map((option, index) => (
          <OptionRow
            key={option.value}
            first={index === 0}
            label={t(option.label)}
            hint={t(option.hint)}
            selected={preference === option.value}
            onPress={() => setPreference(option.value)}
          />
        ))}
      </View>

      <SectionHeader title={t('settings.language')} />
      <View accessibilityRole="radiogroup" style={styles.group}>
        {languages.map((option, index) => (
          <OptionRow
            key={option.value}
            first={index === 0}
            label={option.native}
            hint={option.label}
            selected={language === option.value}
            onPress={() => setLanguage(option.value)}
          />
        ))}
      </View>

      <PinSheet
        visible={pendingBillPin !== null}
        title={t('checkout.pinTitle')}
        processingTitle={t('processing.saving')}
        detail={t(pendingBillPin ? 'settings.billPinOn' : 'settings.billPinOff')}
        onSubmit={async (pin) => {
          await setBillPin.mutateAsync({ enabled: pendingBillPin!, pin });
          setPendingBillPin(null);
          show(t('settings.billPinSaved'));
        }}
        onClose={() => setPendingBillPin(null)}
      />
    </Screen>
  );
}

function OptionRow({
  label,
  hint,
  selected,
  first,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.pressed]}>
      <View style={styles.copy}>
        <TasaText variant="bodyMedium">{label}</TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {hint}
        </TasaText>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <Icon color="#FFFFFF" ios="checkmark" android="check" size={14} />}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    group: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 14,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    pressed: {
      backgroundColor: colors.overlay,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
    radio: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: {
      borderColor: colors.brand,
      backgroundColor: colors.brand,
    },
  }),
);
