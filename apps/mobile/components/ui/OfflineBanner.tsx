import { onlineManager } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';

// A connection often drops for a moment; only say so if it stays down.
const SHOW_AFTER_MS = 1500;

/** Sits above every screen while there's no internet. Never blocks touches underneath. */
export function OfflineBanner() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (online) {
      setVisible(false);
      return;
    }
    const timeout = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timeout);
  }, [online]);

  if (!visible) return null;

  return (
    <Animated.View
      entering={SlideInUp}
      exiting={SlideOutUp}
      pointerEvents="none"
      style={[styles.root, { paddingTop: insets.top + theme.spacing.xs }]}>
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.row}>
        <Icon color="#FFFFFF" ios="wifi.slash" android="wifi_off" size={16} />
        <TasaText variant="caption" color="#FFFFFF">
          {t('network.offline')}
        </TasaText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: theme.spacing.xs,
    backgroundColor: '#B3261E',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
