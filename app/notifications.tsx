import { Stack } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';

import { Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { NotificationPreferences, useSettings } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useUpdateProfile } from '@/hooks/useAccount';
import { KeysOf } from '@/lib/i18n';

const options: { key: keyof NotificationPreferences; label: KeysOf<'notifications'>; hint: KeysOf<'notifications'> }[] = [
  {
    key: 'shortfallReminders',
    label: 'notifications.shortfall',
    hint: 'notifications.shortfallHint',
  },
  { key: 'paymentReceipts', label: 'notifications.receipts', hint: 'notifications.receiptsHint' },
  { key: 'walletFunding', label: 'notifications.funding', hint: 'notifications.fundingHint' },
  { key: 'offers', label: 'notifications.offers', hint: 'notifications.offersHint' },
];

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { notifications, setNotification, t } = useSettings();
  const updateProfile = useUpdateProfile();

  const toggle = (key: keyof NotificationPreferences, enabled: boolean) => {
    setNotification(key, enabled);
    updateProfile.mutate({ notificationPrefs: { [key]: enabled } });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('notifications.title') }} />
      <TasaText variant="body" color={colors.inkMuted} style={styles.intro}>
        {t('notifications.intro')}
      </TasaText>

      <View style={styles.group}>
        {options.map((option, index) => (
          <View key={option.key} style={[styles.row, index > 0 && styles.rowDivider]}>
            <View style={styles.copy}>
              <TasaText variant="bodyMedium">{t(option.label)}</TasaText>
              <TasaText variant="caption" color={colors.inkMuted}>
                {t(option.hint)}
              </TasaText>
            </View>
            <Switch
              accessibilityLabel={t(option.label)}
              value={notifications[option.key]}
              onValueChange={(enabled) => toggle(option.key, enabled)}
              trackColor={{ false: colors.track, true: colors.brand }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={colors.track}
            />
          </View>
        ))}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    intro: {
      marginBottom: theme.spacing.lg,
    },
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
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
