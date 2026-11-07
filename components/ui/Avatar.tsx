import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { useTheme } from '@/context/ThemeContext';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Profile photo, falling back to the person's initials on a brand-coloured circle. */
export function Avatar({ uri, name, size = 44 }: { uri: string | null; name: string; size?: number }) {
  const { colors } = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri }}
        style={[shape, { backgroundColor: colors.track }]}
        contentFit="cover"
        transition={150}
      />
    );
  }

  return (
    <View style={[styles.fallback, shape, { backgroundColor: colors.brand }]}>
      <TasaText
        variant={size >= 56 ? 'title' : 'bodyMedium'}
        color="#FFFFFF"
        style={size >= 80 ? { fontSize: size * 0.34, lineHeight: size * 0.42 } : undefined}>
        {initials(name)}
      </TasaText>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
