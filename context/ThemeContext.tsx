import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { ThemeColors, palettes } from '@/constants/theme';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = 'tasa.theme.v1';

type ThemeContextValue = {
  isReady: boolean;
  scheme: ColorScheme;
  colors: ThemeColors;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [preference, setPreference] = useState<ThemePreference>('system');
  // Follows the OS, or the override applied below via Appearance.setColorScheme.
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreference(stored);
        }
      })
      .catch(() => {})
      .finally(() => setIsReady(true));
  }, []);

  useEffect(() => {
    // Overriding natively also themes alerts, keyboards and pickers.
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
    if (isReady) {
      AsyncStorage.setItem(STORAGE_KEY, preference).catch(() => {});
    }
  }, [isReady, preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ isReady, scheme, colors: palettes[scheme], preference, setPreference }),
    [isReady, scheme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

/**
 * Builds a hook returning styles for the active palette. Styles are created once per palette.
 */
export function makeStyles<T>(factory: (colors: ThemeColors) => T) {
  const cache = new Map<ThemeColors, T>();
  return function useStyles(): T {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = factory(colors);
      cache.set(colors, styles);
    }
    return styles;
  };
}
