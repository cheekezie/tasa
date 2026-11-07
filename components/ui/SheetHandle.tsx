import { View } from 'react-native';

import { theme } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

/** The bar at the top of a sheet: says it can be dragged down to close. */
export function SheetHandle() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        marginTop: -theme.spacing.sm,
        marginBottom: theme.spacing.md,
        backgroundColor: colors.border,
      }}
    />
  );
}
