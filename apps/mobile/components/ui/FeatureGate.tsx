import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen, TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useFeature } from '@/hooks/useAppConfig';
import { FeatureKey } from '@/lib/api/types';

/**
 * A whole screen for one feature: the screen while it's on, a "paused" notice with the reason
 * staff gave while it's off. Wrap a route's default export with it.
 */
export function FeatureGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { enabled, message } = useFeature(feature);
  if (enabled) return <>{children}</>;
  return (
    <Screen>
      <FeaturePaused message={message} />
    </Screen>
  );
}

/** Says a feature is paused and why, inside a screen that otherwise carries on. */
export function FeaturePaused({ message }: { message: string | null }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  return (
    <Card style={styles.card}>
      <View style={styles.icon}>
        <Icon color={colors.accentHot} ios="pause.circle.fill" android="pause_circle" size={22} />
      </View>
      <View style={styles.copy}>
        <TasaText variant="bodyMedium" color={colors.heading}>
          {t('features.pausedTitle')}
        </TasaText>
        <TasaText variant="caption" color={colors.inkMuted}>
          {message ?? t('features.pausedBody')}
        </TasaText>
      </View>
    </Card>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
      backgroundColor: colors.warmSoft,
      borderColor: colors.warmSoftBorder,
    },
    icon: {
      paddingTop: 2,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
  }),
);
