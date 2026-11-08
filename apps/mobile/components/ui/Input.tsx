import { StyleSheet, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { Kobo, formatAmountInput, parseAmountInput } from '@/lib/money';

type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Marks the final field in a form: shows "Done" instead of "Next". */
  last?: boolean;
  style?: ViewStyle;
};

/**
 * Themed text field. Return moves focus to the next field in the form unless `last` is set.
 */
export function Input({ label, hint, error, last, style, onSubmitEditing, ...rest }: InputProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.field, style]}>
      {label && (
        <TasaText variant="label" color={colors.inkMuted}>
          {label}
        </TasaText>
      )}
      <TextInput
        placeholderTextColor={colors.inkSubtle}
        selectionColor={colors.brand}
        returnKeyType={last ? 'done' : 'next'}
        submitBehavior={last ? 'blurAndSubmit' : 'submit'}
        {...rest}
        onSubmitEditing={(event) => {
          onSubmitEditing?.(event);
          if (!last) KeyboardController.setFocusTo('next');
        }}
        style={[styles.input, rest.multiline && styles.multiline, !!error && styles.inputError]}
      />
      {/* A blank error string flags the field without a message (e.g. when it's shown elsewhere). */}
      {error?.trim() ? (
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

type AmountInputProps = Omit<InputProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  value: Kobo;
  onChangeValue: (value: Kobo) => void;
};

/** Amount field: people type whole naira, it holds kobo, and keeps thousands separators while typing. */
export function AmountInput({
  value,
  onChangeValue,
  placeholder = '₦0',
  ...rest
}: AmountInputProps) {
  return (
    <Input
      keyboardType="number-pad"
      placeholder={placeholder}
      value={formatAmountInput(value)}
      onChangeText={(text) => onChangeValue(parseAmountInput(text))}
      {...rest}
    />
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    field: {
      gap: 8,
      marginBottom: theme.spacing.md,
    },
    input: {
      minHeight: 52,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: theme.spacing.md,
      fontFamily: theme.fonts.bodyMedium,
      fontSize: 16,
      backgroundColor: colors.surfaceElevated,
      color: colors.ink,
    },
    multiline: {
      minHeight: 96,
      paddingTop: 14,
      paddingBottom: 14,
      textAlignVertical: 'top',
    },
    inputError: {
      borderColor: colors.danger,
    },
  }),
);
