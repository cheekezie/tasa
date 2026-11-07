import { Pressable, StyleSheet, View } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

type SegmentedControlProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Smaller text, for four or more options on narrow screens. */
  compact?: boolean;
};

/** Pill-shaped switch between a few options, e.g. Phone | Email. */
export function SegmentedControl<T extends string>({ options, value, onChange, compact }: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, compact && styles.compact, selected && styles.selected]}>
            <TasaText variant={compact ? 'caption' : 'bodyMedium'} color={selected ? colors.ink : colors.inkMuted} numberOfLines={1}>
              {option.label}
            </TasaText>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      padding: 4,
      marginBottom: theme.spacing.lg,
      borderRadius: theme.radius.pill,
      backgroundColor: colors.track,
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: theme.radius.pill,
    },
    compact: {
      paddingVertical: 8,
      paddingHorizontal: 2,
    },
    selected: {
      backgroundColor: colors.surfaceElevated,
      boxShadow: `0 1px 3px ${colors.shadow}22`,
    },
  }),
);
