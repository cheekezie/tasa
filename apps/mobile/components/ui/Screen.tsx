import { onlineManager } from '@tanstack/react-query';
import { ReactNode, useCallback, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, theme } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { queryClient } from '@/lib/queryClient';

// Height of the Prev / Next / Done toolbar rendered above the keyboard in the root layout.
const KEYBOARD_TOOLBAR_HEIGHT = 42;
// A footer holds one full-width button (52) plus its top and bottom padding.
const FOOTER_HEIGHT = 52 + theme.spacing.md * 2;

type ScreenProps = {
  children: ReactNode;
  /** Pinned above the scroll area and padded for the top safe area. */
  header?: ReactNode;
  /**
   * Pinned above the scroll area on screens that already have a navigation bar, so no
   * safe-area padding, e.g. a step indicator that shouldn't scroll away.
   */
  pinned?: ReactNode;
  /**
   * Pinned below the scroll area, e.g. the screen's main button. It rides up with the
   * keyboard so it stays reachable while typing.
   */
  footer?: ReactNode;
  scroll?: boolean;
  /** Pull down to reload whatever this screen is showing. For screens of data, not forms. */
  refreshable?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
};

// A slow network shouldn't leave the spinner up for as long as the requests take to give up.
const REFRESH_LIMIT_MS = 10_000;

export function Screen({ children, header, pinned, footer, scroll = true, refreshable, style, contentStyle }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    // Offline, these would wait for the connection and the spinner would never stop.
    if (!onlineManager.isOnline()) return;
    setRefreshing(true);
    await Promise.race([
      queryClient.refetchQueries({ type: 'active' }),
      new Promise((resolve) => setTimeout(resolve, REFRESH_LIMIT_MS)),
    ]);
    setRefreshing(false);
  }, []);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > 4;
    if (next !== scrolled) setScrolled(next);
  };

  const headerView = header ? (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + theme.spacing.sm },
        scrolled && styles.headerScrolled,
      ]}>
      {header}
    </View>
  ) : pinned ? (
    <View style={[styles.header, { paddingTop: theme.spacing.sm }, scrolled && styles.headerScrolled]}>
      {pinned}
    </View>
  ) : null;

  // Once the keyboard is up the home-indicator padding isn't needed, so drop it and lift
  // the footer clear of the keyboard toolbar instead.
  const footerView = footer ? (
    <KeyboardStickyView
      offset={{ closed: 0, opened: insets.bottom - KEYBOARD_TOOLBAR_HEIGHT }}
      style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.md }]}>
      {footer}
    </KeyboardStickyView>
  ) : null;

  if (scroll) {
    return (
      <View style={[styles.root, style]}>
        {headerView}
        <KeyboardAwareScrollView
          bottomOffset={theme.spacing.lg + KEYBOARD_TOOLBAR_HEIGHT + (footer ? FOOTER_HEIGHT : 0)}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            refreshable ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={colors.brand}
                colors={[colors.brand]}
                progressBackgroundColor={colors.surfaceElevated}
              />
            ) : undefined
          }
          style={styles.root}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: theme.spacing.md,
              // Without a footer, leave room for the floating tab bar.
              paddingBottom: footer ? theme.spacing.lg : insets.bottom + 110,
            },
            contentStyle,
          ]}
          onScroll={header || pinned ? onScroll : undefined}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          {children}
        </KeyboardAwareScrollView>
        {footerView}
      </View>
    );
  }

  return (
    <View style={[styles.root, style]}>
      {headerView}
      <View
        style={[
          styles.root,
          styles.content,
          {
            paddingTop: theme.spacing.md,
            paddingBottom: footer ? theme.spacing.lg : insets.bottom + theme.spacing.lg,
          },
          contentStyle,
        ]}>
        {children}
      </View>
      {footerView}
    </View>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerCopy}>
        {eyebrow && (
          <TasaText variant="caption" color={colors.inkMuted}>
            {eyebrow}
          </TasaText>
        )}
        <TasaText variant="display" color={colors.heading}>
          {title}
        </TasaText>
        {subtitle && (
          <TasaText variant="body" color={colors.inkMuted} style={styles.headerSubtitle}>
            {subtitle}
          </TasaText>
        )}
      </View>
      {right}
    </View>
  );
}

type TasaTextProps = {
  children: ReactNode;
  variant?: 'display' | 'title' | 'subtitle' | 'body' | 'bodyMedium' | 'caption' | 'label';
  color?: string;
  style?: TextStyle;
  /** Clamp to this many lines, ending with an ellipsis. */
  numberOfLines?: number;
};

export function TasaText({ children, variant = 'body', color, style, numberOfLines }: TasaTextProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[styles[variant], { color: color ?? colors.ink }, style]}>
      {children}
    </Text>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <TasaText variant="title" numberOfLines={1} style={styles.sectionTitle}>
        {title}
      </TasaText>
      {action}
    </View>
  );
}

/** Placeholder for a list with nothing in it yet. */
export function EmptyState({ message }: { message: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <TasaText color={colors.inkMuted} style={styles.emptyText}>
        {message}
      </TasaText>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    content: {
      paddingHorizontal: theme.spacing.screen,
    },
    footer: {
      paddingHorizontal: theme.spacing.screen,
      paddingTop: theme.spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    header: {
      paddingHorizontal: theme.spacing.screen,
      paddingBottom: theme.spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'transparent',
    },
    headerScrolled: {
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    headerCopy: {
      flex: 1,
    },
    headerSubtitle: {
      marginTop: theme.spacing.xs,
    },
    display: {
      fontFamily: theme.fonts.display,
      fontSize: fontSize(28),
      lineHeight: fontSize(34),
      letterSpacing: -0.5,
    },
    title: {
      fontFamily: theme.fonts.bodyBold,
      fontSize: fontSize(20),
      lineHeight: fontSize(26),
    },
    subtitle: {
      fontFamily: theme.fonts.bodyMedium,
      fontSize: 16,
      lineHeight: 22,
    },
    body: {
      fontFamily: theme.fonts.body,
      fontSize: 15,
      lineHeight: 22,
    },
    bodyMedium: {
      fontFamily: theme.fonts.bodyMedium,
      fontSize: 15,
      lineHeight: 22,
    },
    caption: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      lineHeight: 18,
    },
    label: {
      fontFamily: theme.fonts.bodyMedium,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
      marginTop: theme.spacing.lg,
    },
    sectionTitle: {
      flexShrink: 1,
    },
    empty: {
      padding: theme.spacing.lg,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
    },
    emptyText: {
      textAlign: 'center',
    },
  }),
);
