import { Image } from 'expo-image';

import { useTheme } from '@/context/ThemeContext';

// The original wordmark is white for dark backgrounds; the green copy is for light ones.
const wordmark = {
  light: require('@/assets/images/tela-logo-green.png'),
  dark: require('@/assets/images/tela-logo.png'),
};
const WORDMARK_RATIO = 1732 / 834;

const mark = require('@/assets/images/tela-icon.png');
const MARK_RATIO = 750 / 833;

/** Tasa logo: the full "Tasa" wordmark, or just the T mark. Sized by height. */
export function Logo({ height = 40, variant = 'full' }: { height?: number; variant?: 'full' | 'mark' }) {
  const { scheme } = useTheme();
  const full = variant === 'full';
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel="Tasa"
      source={full ? wordmark[scheme] : mark}
      style={{ height, width: height * (full ? WORDMARK_RATIO : MARK_RATIO) }}
      contentFit="contain"
    />
  );
}
