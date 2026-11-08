import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

export function FloatingTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, theme.spacing.md) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const color = focused ? '#FFFFFF' : colors.inkSubtle;
          const label = typeof options.title === 'string' ? options.title : route.name;

          const onPress = () => {
            const event = emitter.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigateToTab(route.key);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              style={[styles.item, focused && styles.itemActive]}>
              {options.tabBarIcon?.({ focused, color, size: 22 })}
              <TasaText variant="caption" color={color} style={styles.label}>
                {label}
              </TasaText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: theme.spacing.md,
      right: theme.spacing.md,
    },
    bar: {
      flexDirection: 'row',
      padding: 6,
      borderRadius: theme.radius.xl,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      boxShadow: `0 10px 30px ${colors.shadow}2E`,
    },
    item: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      paddingVertical: 8,
      borderRadius: theme.radius.lg + 2,
    },
    itemActive: {
      backgroundColor: colors.brand,
    },
    label: {
      fontFamily: theme.fonts.bodyMedium,
      fontSize: 11,
      lineHeight: 14,
    },
  }),
);
