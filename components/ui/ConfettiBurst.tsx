import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const COLORS = ['#EBBB01', '#7FE0B8', '#FF8A65', '#1B9E77', '#5B8DEF', '#E056FD'];
const PIECE_COUNT = 42;

type PieceSpec = {
  x: number;
  delay: number;
  duration: number;
  color: string;
  width: number;
  height: number;
  spin: number;
  sway: number;
  swaySpeed: number;
  /** Where it comes to rest, as a fraction of the screen height. */
  restY: number;
  restOpacity: number;
  /** An emoji in place of the paper shape. */
  symbol?: string;
};

type ConfettiOptions = {
  colors?: string[];
  /** Sprinkled among the paper, to match what's being celebrated. */
  symbol?: string;
  /** Fade away after landing instead of staying as decoration, for screens people read. */
  fade?: boolean;
  /** How long the fall takes, relative to the usual burst. */
  pace?: number;
};

function makePieces(screenWidth: number, { colors = COLORS, symbol, fade, pace = 1 }: ConfettiOptions): PieceSpec[] {
  return Array.from({ length: PIECE_COUNT }, (_, index) => {
    const dot = index % 4 === 0;
    const size = 6 + Math.random() * 6;
    return {
      x: Math.random() * screenWidth,
      delay: Math.random() * 450,
      duration: (2200 + Math.random() * 1400) * pace,
      color: colors[index % colors.length],
      width: dot ? size * 0.8 : size * 0.45,
      height: dot ? size * 0.8 : size,
      spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
      sway: 12 + Math.random() * 24,
      swaySpeed: 2 + Math.random() * 3,
      restY: 0.08 + Math.random() * 0.9,
      restOpacity: fade ? 0 : 0.2 + Math.random() * 0.2,
      symbol: index % 3 === 0 ? symbol : undefined,
    };
  });
}

function Piece({ spec, screenHeight }: { spec: PieceSpec; screenHeight: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      spec.delay,
      withTiming(1, { duration: spec.duration, easing: Easing.out(Easing.cubic) }),
    );
  }, [progress, spec]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // Full strength while falling, easing down to a softer resting strength as it lands.
    const opacity = p === 0 ? 0 : 1 - p * (1 - spec.restOpacity);
    return {
      opacity,
      transform: [
        // The sway dies out as the piece settles so it comes to a gentle stop.
        { translateX: spec.x + Math.sin(p * Math.PI * spec.swaySpeed) * spec.sway * (1 - p) },
        { translateY: -20 + p * (spec.restY * screenHeight + 20) },
        { rotate: `${p * spec.spin}deg` },
      ],
    };
  });

  if (spec.symbol) {
    return (
      <Animated.View style={[styles.piece, style]}>
        <Text style={styles.symbol}>{spec.symbol}</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          width: spec.width,
          height: spec.height,
          borderRadius: spec.width === spec.height ? spec.width / 2 : 1.5,
          backgroundColor: spec.color,
        },
        style,
      ]}
    />
  );
}

/**
 * Confetti that showers down once, then stays scattered across the screen as decoration.
 * Skipped when Reduce Motion is on.
 */
export function ConfettiBurst(options: ConfettiOptions) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // Generated once so re-renders don't restart or reshuffle the pieces.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pieces = useMemo(() => makePieces(width, options), []);

  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((spec, index) => (
        <Piece key={index} spec={spec} screenHeight={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  symbol: {
    fontSize: 18,
  },
});
