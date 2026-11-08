import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { fontSize, theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

type OtpInputProps = {
  /** Read out by screen readers, since the field itself is hidden. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  length?: number;
  error?: string | null;
  hint?: string;
  autoFocus?: boolean;
};

/**
 * One box per digit. A single hidden field takes the input, so typing, deleting,
 * pasting and SMS auto-fill all behave like a normal text field.
 */
export function OtpInput({ label, value, onChange, length = 6, error, hint, autoFocus }: OtpInputProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const inputRef = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="none"
        onPress={() => inputRef.current?.focus()}
        style={styles.boxes}>
        {Array.from({ length }, (_, index) => {
          const active = focused && index === Math.min(value.length, length - 1);
          return (
            <View
              key={index}
              style={[
                styles.box,
                !!value[index] && styles.boxFilled,
                active && styles.boxActive,
                !!error && styles.boxError,
              ]}>
              <TasaText variant="display" style={styles.digit}>
                {value[index] ?? ''}
              </TasaText>
            </View>
          );
        })}
      </Pressable>

      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        autoFocus={autoFocus}
        maxLength={length}
        caretHidden
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.hiddenInput}
      />

      {error ? (
        <TasaText variant="caption" color={colors.danger}>
          {error}
        </TasaText>
      ) : hint ? (
        <TasaText variant="caption" color={colors.inkMuted}>
          {hint}
        </TasaText>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    boxes: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    box: {
      flex: 1,
      maxWidth: 56,
      aspectRatio: 0.85,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    boxFilled: {
      borderColor: colors.inkSubtle,
    },
    boxActive: {
      borderColor: colors.brand,
      borderWidth: 2,
    },
    boxError: {
      borderColor: colors.danger,
    },
    digit: {
      fontSize: fontSize(24),
      lineHeight: fontSize(30),
    },
    // Kept in the tree (not display: none) so it can hold focus and receive SMS auto-fill.
    hiddenInput: {
      position: 'absolute',
      width: 1,
      height: 1,
      opacity: 0,
    },
  }),
);
