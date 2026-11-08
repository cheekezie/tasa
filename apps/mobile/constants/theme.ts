import { Dimensions } from 'react-native';

const lightColors = {
  brand: '#0A4D3C',
  brandDeep: '#063328',
  brandLight: '#127A5E',
  heading: '#063328',
  accent: '#F4A524',
  accentHot: '#E85D04',
  surface: '#FAF8F4',
  surfaceElevated: '#FFFFFF',
  ink: '#1A1A18',
  inkMuted: '#6B6860',
  inkSubtle: '#9C9890',
  success: '#1B9E77',
  warning: '#F4A524',
  danger: '#D64545',
  border: '#E8E4DC',
  track: '#F0ECE4',
  overlay: 'rgba(6, 51, 40, 0.08)',
  shadow: '#063328',
  dangerSoft: '#FFF5F5',
  dangerSoftBorder: '#F3CFCF',
  warmSoft: '#FFF9F3',
  warmSoftBorder: '#F6DFC2',
  giftSoft: '#F8F0FF',
  giftSoftBorder: '#E7D4FF',
  electricity: '#FFB020',
  airtime: '#5B8DEF',
  tv: '#9B59B6',
  water: '#3498DB',
  internet: '#1ABC9C',
  jamb: '#2ECC71',
  gift: '#E056FD',
  coupon: '#FF6B6B',
};

export type ThemeColors = typeof lightColors;

const darkColors: ThemeColors = {
  ...lightColors,
  brand: '#1C8A69',
  brandLight: '#3FBF96',
  heading: '#E3F1EB',
  surface: '#0E1311',
  surfaceElevated: '#171E1B',
  ink: '#F1EEE7',
  inkMuted: '#A9A59C',
  inkSubtle: '#7A766E',
  success: '#34C291',
  danger: '#EF6B6B',
  border: '#26302C',
  track: '#252D29',
  overlay: 'rgba(43, 165, 127, 0.16)',
  shadow: '#000000',
  dangerSoft: 'rgba(214, 69, 69, 0.12)',
  dangerSoftBorder: 'rgba(214, 69, 69, 0.35)',
  warmSoft: 'rgba(244, 165, 36, 0.10)',
  warmSoftBorder: 'rgba(244, 165, 36, 0.30)',
  giftSoft: 'rgba(155, 89, 182, 0.14)',
  giftSoftBorder: 'rgba(155, 89, 182, 0.40)',
};

export const palettes = {
  light: lightColors,
  dark: darkColors,
} as const;

export const theme = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    /** Left and right margin of every screen. */
    screen: 20,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    pill: 999,
  },
  fonts: {
    display: 'Sora_600SemiBold',
    body: 'Sora_400Regular',
    bodyMedium: 'Sora_500Medium',
    bodyBold: 'Sora_700Bold',
  },
} as const;

export type ServiceId =
  | 'electricity'
  | 'airtime'
  | 'tv'
  | 'water'
  | 'internet'
  | 'jamb';

// Like a CSS breakpoint: headings and big figures shrink on narrow phones,
// while body text (under 18) keeps its size for readability.
const LARGE_TEXT = 18;
const screenWidth = Dimensions.get('window').width;
const largeTextScale = screenWidth < 340 ? 0.85 : screenWidth <= 360 ? 0.9 : 1;

/** Font size (or matching line height) adjusted for the screen width. */
export function fontSize(size: number) {
  return size >= LARGE_TEXT ? Math.round(size * largeTextScale) : size;
}
