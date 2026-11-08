import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import i18n, { Language, Translate, deviceLanguage } from '@/lib/i18n';

export type NotificationPreferences = {
  shortfallReminders: boolean;
  paymentReceipts: boolean;
  walletFunding: boolean;
  offers: boolean;
};

type Settings = {
  language: Language;
  notifications: NotificationPreferences;
};

const STORAGE_KEY = 'tasa.settings.v1';

const defaults: Settings = {
  language: deviceLanguage(),
  notifications: {
    shortfallReminders: true,
    paymentReceipts: true,
    walletFunding: true,
    offers: false,
  },
};

type SettingsContextValue = Settings & {
  isReady: boolean;
  setLanguage: (language: Language) => void;
  setNotification: (key: keyof NotificationPreferences, enabled: boolean) => void;
  t: Translate;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaults);
  const t = useTranslation().t as unknown as Translate;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const stored = JSON.parse(raw) as Partial<Settings>;
        setSettings({
          language: stored.language ?? defaults.language,
          notifications: { ...defaults.notifications, ...stored.notifications },
        });
      })
      .catch(() => {})
      .finally(() => setIsReady(true));
  }, []);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [isReady, settings]);

  useEffect(() => {
    if (i18n.language !== settings.language) i18n.changeLanguage(settings.language);
  }, [settings.language]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      isReady,
      setLanguage: (language) => setSettings((current) => ({ ...current, language })),
      setNotification: (key, enabled) =>
        setSettings((current) => ({
          ...current,
          notifications: { ...current.notifications, [key]: enabled },
        })),
      t,
    }),
    [settings, isReady, t],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}

/** Shorthand for components that only need translations. */
export function useT() {
  return useTranslation().t as unknown as Translate;
}
