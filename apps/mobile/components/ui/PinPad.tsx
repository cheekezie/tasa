import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { fontSize, theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { PIN_LENGTH } from '@/lib/pin';


const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'] as const;

type PinPadProps = {
  value: string;
  onChange: (value: string) => void;
  /** Shown under the dots; a change of message shakes the dots. */
  error?: string | null;
  /** Locks the keypad, e.g. while checking or after too many tries. */
  disabled?: boolean;
  busy?: boolean;
};

/** PIN dots with an on-screen number pad, so the system keyboard never opens. */
export function PinPad({ value, onChange, error, disabled, busy }: PinPadProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const shake = useSharedValue(0);

  useEffect(() => {
    if (!error) return;
    shake.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [error, shake]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const press = (key: (typeof KEYS)[number]) => {
    if (disabled || busy) return;
    if (key === 'delete') onChange(value.slice(0, -1));
    else if (value.length < PIN_LENGTH) onChange(value + key);
  };

  return (
    <View style={styles.root}>
      <Animated.View
        accessible
        accessibilityLabel={t('auth.pinProgress', { count: value.length, total: PIN_LENGTH })}
        style={[styles.dots, shakeStyle]}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              index < value.length && styles.dotFilled,
              !!error && styles.dotError,
            ]}
          />
        ))}
      </Animated.View>

      <View style={styles.message}>
        {busy ? (
          <ActivityIndicator color={colors.brand} />
        ) : error ? (
          <TasaText variant="caption" color={colors.danger} style={styles.messageText}>
            {error}
          </TasaText>
        ) : null}
      </View>

      <View style={styles.keys}>
        {KEYS.map((key) =>
          key === '' ? (
            <View key="spacer" style={styles.key} />
          ) : (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key === 'delete' ? t('auth.deleteDigit') : key}
              disabled={disabled || busy}
              onPress={() => press(key)}
              style={({ pressed }) => [
                styles.key,
                pressed && styles.keyPressed,
                disabled && styles.keyDisabled,
              ]}>
              {key === 'delete' ? (
                <Icon color={colors.ink} ios="delete.left" android="backspace" size={24} />
              ) : (
                <TasaText variant="display" style={styles.keyLabel}>
                  {key}
                </TasaText>
              )}
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      alignItems: 'center',
    },
    dots: {
      flexDirection: 'row',
      gap: 14,
    },
    dot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.inkSubtle,
    },
    dotFilled: {
      backgroundColor: colors.brand,
      borderColor: colors.brand,
    },
    dotError: {
      borderColor: colors.danger,
    },
    message: {
      minHeight: 40,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
    },
    messageText: {
      textAlign: 'center',
    },
    keys: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: theme.spacing.sm,
      width: '100%',
      maxWidth: 300,
    },
    key: {
      width: '30%',
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyPressed: {
      backgroundColor: colors.overlay,
    },
    keyDisabled: {
      opacity: 0.4,
    },
    keyLabel: {
      fontSize: fontSize(26),
      lineHeight: fontSize(32),
    },
  }),
);
