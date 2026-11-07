import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { formatDateTime } from '@/lib/format';

/**
 * In place of the whole app while staff have it in maintenance. It checks again on its own every
 * minute and when the app comes back to the front; the button checks now.
 */
export function MaintenanceView({
  message,
  until,
  checking,
  onRetry,
}: {
  message: string | null;
  until: string | null;
  checking: boolean;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + theme.spacing.lg }]}>
      <View style={styles.body}>
        <View style={styles.icon}>
          <Icon color={colors.brand} ios="wrench.and.screwdriver.fill" android="construction" size={34} />
        </View>
        <TasaText variant="title" color={colors.heading} style={styles.centered}>
          {t('maintenance.title')}
        </TasaText>
        <TasaText variant="body" color={colors.inkMuted} style={styles.centered}>
          {message ?? t('maintenance.body')}
        </TasaText>
        {!!until && (
          <TasaText variant="bodyMedium" color={colors.ink} style={styles.centered}>
            {t('maintenance.until', { time: formatDateTime(until) })}
          </TasaText>
        )}
        <TasaText variant="caption" color={colors.inkSubtle} style={styles.centered}>
          {t('maintenance.safe')}
        </TasaText>
      </View>
      <Button label={t('maintenance.retry')} variant="secondary" loading={checking} onPress={onRetry} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      paddingHorizontal: theme.spacing.screen,
      backgroundColor: colors.surface,
    },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
    },
    icon: {
      width: 72,
      height: 72,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 36,
      marginBottom: theme.spacing.sm,
      backgroundColor: `${colors.brand}14`,
    },
    centered: {
      textAlign: 'center',
    },
  }),
);
