import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/context/ThemeContext';

// Same image, size and background as the native splash in app.json, so the hand-off is invisible.
const LOGO_WIDTH = 110;
const LOGO_HEIGHT = LOGO_WIDTH * (833 / 750);
const icons = {
  light: require('@/assets/images/tela-icon.png'),
  dark: require('@/assets/images/tela-icon-white.png'),
};
const HOLD_MS = 900;

/**
 * Takes over from the native splash once the app is ready: the Tasa mark pulses once, then
 * fades to reveal the app. Also gives Expo Go (which shows its own native splash) the branded one.
 */
export function AnimatedSplash() {
  const { colors, scheme } = useTheme();
  const [visible, setVisible] = useState(true);
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.08, { duration: 350 }),
      withTiming(1, { duration: 350 }),
    );
    const timeout = setTimeout(() => setVisible(false), HOLD_MS);
    return () => clearTimeout(timeout);
  }, [scale]);

  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (!visible) return null;

  return (
    <Animated.View
      exiting={FadeOut.duration(300)}
      pointerEvents="none"
      // Hide the native splash only once this identical screen is drawn underneath it.
      onLayout={() => SplashScreen.hideAsync()}
      style={[styles.root, { backgroundColor: colors.surface }]}>
      <Animated.View style={logoStyle}>
        <Image
          accessibilityLabel="Tasa"
          source={icons[scheme]}
          style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
          contentFit="contain"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
});
