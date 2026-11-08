import * as Clipboard from 'expo-clipboard';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

type Tone = 'success' | 'error' | 'info';

type Snack = { id: number; message: string; tone: Tone };

type SnackbarContextValue = {
  show: (message: string, options?: { tone?: Tone; duration?: number }) => void;
};

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

const DEFAULT_DURATION_MS = 2500;

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [snack, setSnack] = useState<Snack | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<SnackbarContextValue['show']>((message, options) => {
    if (timeout.current) clearTimeout(timeout.current);
    setSnack({ id: Date.now(), message, tone: options?.tone ?? 'success' });
    timeout.current = setTimeout(() => setSnack(null), options?.duration ?? DEFAULT_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  return (
    <SnackbarContext.Provider value={{ show }}>
      {children}
      {snack && <SnackbarView key={snack.id} snack={snack} />}
    </SnackbarContext.Provider>
  );
}

function SnackbarView({ snack }: { snack: Snack }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const toneColor =
    snack.tone === 'error' ? colors.danger : snack.tone === 'info' ? colors.inkSubtle : colors.success;

  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + theme.spacing.md }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        entering={FadeInDown.springify().damping(16)}
        exiting={FadeOutDown.duration(180)}
        style={styles.snack}>
        <Icon
          color={toneColor}
          ios={snack.tone === 'error' ? 'exclamationmark.triangle.fill' : 'checkmark'}
          android={snack.tone === 'error' ? 'error' : 'check'}
          size={18}
        />
        <TasaText variant="bodyMedium" color={colors.surface} style={styles.message}>
          {snack.message}
        </TasaText>
      </Animated.View>
    </View>
  );
}

export function useSnackbar() {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error('useSnackbar must be used within SnackbarProvider');
  }
  return context;
}

/** Copies text and confirms with a snackbar, so every copy action behaves the same. */
export function useCopyToClipboard() {
  const { show } = useSnackbar();
  const t = useT();
  return useCallback(
    async (value: string, message?: string) => {
      await Clipboard.setStringAsync(value);
      show(message ?? t('common.copied'));
    },
    [show, t],
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    host: {
      position: 'absolute',
      left: theme.spacing.md,
      right: theme.spacing.md,
      alignItems: 'center',
    },
    snack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      maxWidth: 480,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 14,
      borderRadius: theme.radius.lg,
      backgroundColor: colors.ink,
      boxShadow: `0 8px 24px ${colors.shadow}33`,
    },
    message: {
      flexShrink: 1,
    },
  }),
);
