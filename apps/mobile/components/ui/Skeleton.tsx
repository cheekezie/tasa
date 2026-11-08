import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { theme } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

/**
 * A grey shape where content is about to be, so the screen keeps its layout while it loads.
 * It breathes gently; with "reduce motion" on it stays still.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: {
  width?: DimensionValue;
  /** null: the style sets it (e.g. an aspect ratio). */
  height?: DimensionValue | null;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity, reduceMotion]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.block, { width, borderRadius: radius }, height !== null && { height }, pulse, style]} />;
}

export type SkeletonShape = 'list' | 'cards' | 'detail' | 'chart';

/** A whole loading screen in the shape of what's coming. Hidden from screen readers, which hear "Loading". */
export function SkeletonScreen({ shape = 'list', rows }: { shape?: SkeletonShape; rows?: number }) {
  const styles = useStyles();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading" style={styles.screen}>
      {shape === 'list' && <ListRows count={rows ?? 6} />}
      {shape === 'cards' &&
        Array.from({ length: rows ?? 3 }, (_, i) => (
          <View key={i} style={styles.card}>
            <Skeleton height={null} radius={theme.radius.md} style={styles.poster} />
            <Skeleton width="70%" height={16} />
            <Skeleton width="50%" height={12} />
            <Skeleton width={90} height={22} radius={11} />
          </View>
        ))}
      {shape === 'detail' && (
        <>
          <Skeleton height={null} radius={theme.radius.lg} style={styles.poster} />
          <Skeleton width="65%" height={22} />
          <Skeleton width="40%" height={12} />
          <View style={styles.detailRows}>
            {Array.from({ length: rows ?? 4 }, (_, i) => (
              <View key={i} style={styles.detailRow}>
                <Skeleton width={36} height={36} radius={10} />
                <View style={styles.lines}>
                  <Skeleton width="30%" height={10} />
                  <Skeleton width="60%" height={14} />
                </View>
              </View>
            ))}
          </View>
        </>
      )}
      {shape === 'chart' && (
        <>
          <Skeleton width="45%" height={12} />
          <Skeleton width="60%" height={30} radius={8} />
          <View style={styles.bars}>
            {[55, 80, 40, 95, 65, 75].map((h, i) => (
              <Skeleton key={i} width={18} height={`${h}%`} radius={9} />
            ))}
          </View>
          <ListRows count={rows ?? 3} />
        </>
      )}
    </View>
  );
}

/** Rows like an activity list: an icon, two lines, an amount. */
export function ListRows({ count = 3 }: { count?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.rows}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={40} height={40} radius={20} />
          <View style={styles.lines}>
            <Skeleton width={i % 2 ? '55%' : '70%'} height={14} />
            <Skeleton width={i % 2 ? '35%' : '45%'} height={11} />
          </View>
          <Skeleton width={56} height={14} />
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    block: {
      backgroundColor: colors.track,
    },
    screen: {
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
    },
    rows: {
      gap: theme.spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    lines: {
      flex: 1,
      gap: 6,
    },
    card: {
      gap: 8,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    poster: {
      aspectRatio: 16 / 9,
      width: '100%',
      marginBottom: theme.spacing.xs,
    },
    detailRows: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    bars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-around',
      height: 120,
      marginVertical: theme.spacing.md,
    },
  }),
);
