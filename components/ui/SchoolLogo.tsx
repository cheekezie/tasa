import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TasaText } from '@/components/ui/Screen';
import { useTheme } from '@/context/ThemeContext';
import type { SchoolDto } from '@/lib/api/types';

/** A school's crest on white (most are drawn for white), or its short name's first letters without one. */
export function SchoolLogo({ school, size = 32 }: { school: Pick<SchoolDto, 'shortName' | 'logoUrl'>; size?: number }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const frame = { width: size, height: size, borderRadius: size / 4 };

  if (!school.logoUrl || failed) {
    return (
      <View style={[frame, styles.center, { backgroundColor: colors.overlay }]}>
        <TasaText variant="caption" color={colors.brand} style={{ fontSize: size * 0.34 }}>
          {school.shortName.slice(0, 3)}
        </TasaText>
      </View>
    );
  }
  return (
    <View style={[frame, styles.center, styles.plate]}>
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: school.logoUrl }}
        style={{ width: size * 0.84, height: size * 0.84 }}
        contentFit="contain"
        transition={150}
        cachePolicy="memory-disk"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  plate: { backgroundColor: '#FFFFFF' },
});
