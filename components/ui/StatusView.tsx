import { Href, router, useNavigation } from 'expo-router';
import { ReactNode, useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ConfettiBurst } from '@/components/ui/ConfettiBurst';
import { Icon } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { theme } from '@/constants/theme';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/**
 * Hides the header and swipe-back while a success/error screen is showing, and restores
 * them when the screen goes back to its form (e.g. "Send another" or "Edit details").
 */
export function useResultScreen(showingResult: boolean) {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: !showingResult, gestureEnabled: !showingResult });
  }, [navigation, showingResult]);
}

export type StatusAction = {
  label: string;
  /** Runs instead of navigating. */
  onPress?: () => void;
  /** Where to go. Without `href` or `onPress`, the action goes back. */
  href?: Href;
  /**
   * How to reach `href`: `push` adds a screen, `replace` swaps this one, and `dismissTo` pops
   * back to `href` if it is already in the stack (e.g. returning home after a flow).
   * @default 'dismissTo'
   */
  mode?: 'push' | 'replace' | 'dismissTo';
};

type StatusViewProps = {
  variant: 'success' | 'error';
  title: string;
  message?: string;
  /** Optional content between the message and the actions, e.g. a receipt. */
  children?: ReactNode;
  /** @default a translated "Done" button that goes back */
  primaryAction?: StatusAction;
  secondaryAction?: StatusAction;
};

function runAction({ onPress, href, mode = 'dismissTo' }: StatusAction) {
  if (onPress) return onPress();
  if (!href) return router.canGoBack() ? router.back() : router.replace('/');
  if (mode === 'push') return router.push(href);
  if (mode === 'replace') return router.replace(href);
  return router.dismissTo(href);
}

export function StatusView({
  variant,
  title,
  message,
  children,
  primaryAction,
  secondaryAction,
}: StatusViewProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const t = useT();
  const primary = primaryAction ?? { label: t('common.done') };
  const tone = variant === 'success' ? colors.success : colors.danger;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.lg },
      ]}>
      {/* Drawn first so the confetti that stays on screen sits behind the text and buttons. */}
      {variant === 'success' && <ConfettiBurst />}
      <View style={styles.body}>
        <Animated.View
          entering={ZoomIn.springify().damping(14)}
          style={[styles.badgeOuter, { backgroundColor: `${tone}1F` }]}>
          <View style={[styles.badgeInner, { backgroundColor: tone }]}>
            {variant === 'success' ? (
              <Icon color="#FFFFFF" ios="checkmark" android="check" size={34} />
            ) : (
              <Icon color="#FFFFFF" ios="xmark" android="close" size={30} />
            )}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120)} style={styles.copy}>
          <TasaText variant="display" color={colors.heading} style={styles.center}>
            {title}
          </TasaText>
          {message && (
            <TasaText variant="body" color={colors.inkMuted} style={styles.center}>
              {message}
            </TasaText>
          )}
        </Animated.View>

        {children && (
          <Animated.View entering={FadeInDown.delay(200)} style={styles.extra}>
            {children}
          </Animated.View>
        )}
      </View>

      <View style={styles.actions}>
        <Button label={primary.label} onPress={() => runAction(primary)} />
        {secondaryAction && (
          <Button
            label={secondaryAction.label}
            variant="ghost"
            onPress={() => runAction(secondaryAction)}
          />
        )}
      </View>
    </View>
  );
}

export function SuccessView(props: Omit<StatusViewProps, 'variant'>) {
  return <StatusView variant="success" {...props} />;
}

export function ErrorView(props: Omit<StatusViewProps, 'variant'>) {
  return <StatusView variant="error" {...props} />;
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      paddingHorizontal: theme.spacing.screen,
      backgroundColor: colors.surface,
    },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.lg,
    },
    badgeOuter: {
      width: 112,
      height: 112,
      borderRadius: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeInner: {
      width: 76,
      height: 76,
      borderRadius: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: {
      gap: theme.spacing.sm,
      alignItems: 'center',
    },
    center: {
      textAlign: 'center',
    },
    extra: {
      alignSelf: 'stretch',
    },
    actions: {
      gap: theme.spacing.sm,
    },
  }),
);
