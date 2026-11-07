import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/** Fills the screen while money moves, so nobody thinks nothing is happening and taps again. */
export function ProcessingView({ title }: { title: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();

  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.root}>
      <ActivityIndicator color={colors.brand} size="large" />
      <TasaText variant="title" color={colors.heading} style={styles.centered}>
        {title}
      </TasaText>
      <TasaText variant="body" color={colors.inkMuted} style={styles.centered}>
        {t('processing.hint')}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.screen,
      backgroundColor: colors.surface,
    },
    centered: {
      textAlign: 'center',
    },
  }),
);
