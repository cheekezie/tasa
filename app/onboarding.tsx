import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconName } from '@/components/ui/Icon';
import { TasaText } from '@/components/ui/Screen';
import { ThemeColors, fontSize, theme } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useT } from '@/context/SettingsContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Slide = {
  icon: IconName;
  tint: keyof ThemeColors;
  title: 'onboarding.slide1Title' | 'onboarding.slide2Title' | 'onboarding.slide3Title';
  body: 'onboarding.slide1Body' | 'onboarding.slide2Body' | 'onboarding.slide3Body';
};

const slides: Slide[] = [
  {
    icon: { ios: 'bolt.fill', android: 'bolt' },
    tint: 'brand',
    title: 'onboarding.slide1Title',
    body: 'onboarding.slide1Body',
  },
  {
    icon: { ios: 'gift.fill', android: 'redeem' },
    tint: 'gift',
    title: 'onboarding.slide2Title',
    body: 'onboarding.slide2Body',
  },
  {
    icon: { ios: 'bell.fill', android: 'notifications' },
    tint: 'accentHot',
    title: 'onboarding.slide3Title',
    body: 'onboarding.slide3Body',
  },
];

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { completeOnboarding } = useApp();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === slides.length - 1;

  const finish = () => {
    completeOnboarding();
    router.replace('/sign-in');
  };

  const goToSlide = (next: number) => {
    scrollRef.current?.scrollTo({ x: next * SCREEN_WIDTH, animated: true });
    setIndex(next);
  };

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setIndex(next);
  };

  return (
    <View style={styles.root}>
      {!isLast && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.skipA11y')}
          onPress={finish}
          style={[styles.skip, { top: insets.top + theme.spacing.sm }]}>
          <TasaText variant="bodyMedium" color={colors.inkMuted}>
            {t('onboarding.skip')}
          </TasaText>
        </Pressable>
      )}

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}>
        {slides.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <View style={[styles.badge, { backgroundColor: `${colors[slide.tint]}1F` }]}>
              <Icon {...slide.icon} color={colors[slide.tint]} size={fontSize(56)} />
            </View>
            <TasaText variant="display" color={colors.heading} style={styles.title}>
              {t(slide.title)}
            </TasaText>
            <TasaText variant="body" color={colors.inkMuted} style={styles.body}>
              {t(slide.body)}
            </TasaText>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <View style={styles.dots}>
          {slides.map((slide, dotIndex) => (
            <View
              key={slide.title}
              style={[styles.dot, dotIndex === index && styles.dotActive]}
            />
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('onboarding.getStarted') : t('onboarding.next')}
          onPress={() => (isLast ? finish() : goToSlide(index + 1))}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
          <TasaText variant="bodyMedium" color="#FFFFFF">
            {isLast ? t('onboarding.getStarted') : t('onboarding.next')}
          </TasaText>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    skip: {
      position: 'absolute',
      right: theme.spacing.screen,
      zIndex: 10,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    slide: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
    },
    badge: {
      width: 128,
      height: 128,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.xl,
    },
    title: {
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    body: {
      textAlign: 'center',
      maxWidth: 320,
    },
    footer: {
      paddingHorizontal: theme.spacing.screen,
      paddingTop: theme.spacing.md,
      gap: theme.spacing.lg,
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
    },
    dotActive: {
      width: 24,
      backgroundColor: colors.brand,
    },
    cta: {
      minHeight: 56,
      borderRadius: theme.radius.lg,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaPressed: {
      opacity: 0.9,
    },
  }),
);
