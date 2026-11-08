import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  /** `destructive`: outlined in red, for undoing things (cancel, end, remove); `danger` is the filled one. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive';
  disabled?: boolean;
  /** Shows a spinner and blocks presses. */
  loading?: boolean;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const onFill = variant === 'primary' || variant === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={onFill ? '#FFFFFF' : variant === 'destructive' ? colors.danger : colors.brand} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label` as const]]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    base: {
      minHeight: 52,
      borderRadius: theme.radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    primary: {
      backgroundColor: colors.brand,
    },
    secondary: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    ghost: {
      backgroundColor: colors.overlay,
    },
    danger: {
      backgroundColor: colors.danger,
    },
    destructive: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.danger,
    },
    disabled: {
      opacity: 0.45,
    },
    pressed: {
      transform: [{ scale: 0.98 }],
    },
    label: {
      fontFamily: theme.fonts.bodyBold,
      fontSize: 15,
    },
    primaryLabel: {
      color: '#FFFFFF',
    },
    secondaryLabel: {
      color: colors.brand,
    },
    ghostLabel: {
      color: colors.brand,
    },
    dangerLabel: {
      color: '#FFFFFF',
    },
    destructiveLabel: {
      color: colors.danger,
    },
    card: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
  }),
);
