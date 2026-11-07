import { ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useT } from '@/context/SettingsContext';
import { makeStyles } from '@/context/ThemeContext';
import { useSheetDrag } from '@/hooks/useSheetDrag';

/** A sheet from the bottom for a short task (a form, a choice), kept clear of the keyboard. */
export function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const drag = useSheetDrag(visible, onClose);
  const t = useT();
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={[styles.host, { paddingBottom: keyboard }]}>
        <Pressable accessibilityLabel={t('common.close')} style={styles.backdrop} onPress={onClose} />
        {/* Kept below the status bar however much the keyboard takes. */}
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: Math.min(height * 0.85, height - keyboard - insets.top - theme.spacing.md),
              paddingBottom: (keyboard ? 0 : insets.bottom) + theme.spacing.md,
            },
            drag.style,
          ]}>
          {/* Drag the handle or title down to close; the content below scrolls. */}
          <View {...drag.handlers}>
            <View style={styles.handle} />
            <TasaText variant="subtitle" style={styles.title}>
              {title}
            </TasaText>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    host: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    sheet: {
      paddingHorizontal: theme.spacing.screen,
      paddingTop: theme.spacing.sm,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      backgroundColor: colors.surfaceElevated,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      marginBottom: theme.spacing.sm,
      backgroundColor: colors.border,
    },
    title: {
      paddingBottom: theme.spacing.md,
    },
  }),
);
