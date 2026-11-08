import { Image, ImageSource } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useSheetDrag } from '@/hooks/useSheetDrag';

export type ActionSheetOption = {
  label: string;
  icon?: { ios: Parameters<typeof Icon>[0]['ios']; android: Parameters<typeof Icon>[0]['android'] };
  /** A full-colour image in place of `icon`, e.g. a brand logo that isn't in the symbol sets. */
  image?: ImageSource | number;
  destructive?: boolean;
  onPress: () => void;
};

type ActionSheetProps = {
  visible: boolean;
  title?: string;
  /** Supporting line under the title, e.g. what a destructive action will do. */
  message?: string;
  options: ActionSheetOption[];
  cancelLabel: string;
  onClose: () => void;
};

/** Bottom sheet of actions, consistent on iOS and Android. */
export function ActionSheet({ visible, title, message, options, cancelLabel, onClose }: ActionSheetProps) {
  const insets = useSafeAreaInsets();
  const drag = useSheetDrag(visible, onClose);
  const { colors } = useTheme();
  const styles = useStyles();
  // The chosen action runs only once the sheet has fully closed. iOS can't present another
  // screen (like the photo picker) while this modal is still animating away.
  const pending = useRef<(() => void) | null>(null);

  const runPending = () => {
    const action = pending.current;
    pending.current = null;
    action?.();
  };

  useEffect(() => {
    // Android has no dismissal callback to wait for; run once the sheet is hidden.
    if (!visible && Platform.OS !== 'ios' && pending.current) {
      const timeout = setTimeout(runPending, 0);
      return () => clearTimeout(timeout);
    }
  }, [visible]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={runPending}>
      <Pressable accessibilityLabel={cancelLabel} style={styles.backdrop} onPress={onClose} />
      <Animated.View {...drag.handlers} style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.md }, drag.style]}>
        <View style={styles.handle} />
        {(title || message) && (
          <View style={styles.header}>
            {title && <TasaText variant="subtitle">{title}</TasaText>}
            {message && (
              <TasaText variant="caption" color={colors.inkMuted}>
                {message}
              </TasaText>
            )}
          </View>
        )}
        {options.map((option) => {
          const tone = option.destructive ? colors.danger : colors.ink;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              onPress={() => {
                pending.current = option.onPress;
                onClose();
              }}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              {option.image ? (
                <Image source={option.image} style={styles.image} contentFit="contain" />
              ) : (
                option.icon && <Icon color={tone} {...option.icon} size={20} />
              )}
              <TasaText variant="bodyMedium" color={tone}>
                {option.label}
              </TasaText>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.option, styles.cancel, pressed && styles.pressed]}>
          <TasaText variant="bodyMedium" color={colors.inkMuted}>
            {cancelLabel}
          </TasaText>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    sheet: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      backgroundColor: colors.surfaceElevated,
    },
    image: {
      width: 20,
      height: 20,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      marginBottom: theme.spacing.sm,
      backgroundColor: colors.border,
    },
    header: {
      gap: 4,
      paddingHorizontal: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
      paddingBottom: theme.spacing.sm,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 52,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.radius.md,
    },
    pressed: {
      backgroundColor: colors.overlay,
    },
    cancel: {
      justifyContent: 'center',
      marginTop: theme.spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      borderRadius: 0,
    },
  }),
);
