import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { setSessionExpiredHandler } from '@/lib/api/client';
import { UserProfile } from '@/lib/api/mappers';
import { authService } from '@/lib/api/services/auth';
import { clearTokens, loadTokens } from '@/lib/api/tokens';
import { DeviceState, emptyDeviceState, loadDeviceState, saveDeviceState } from '@/lib/device';
import { kobo } from '@/lib/money';
import { unregisterPushToken } from '@/lib/push';
import { scheduleBillReminders } from '@/lib/reminders';
import { queryClient } from '@/lib/queryClient';

/** Session and device state only. Wallet, bills and everything else server-owned is in hooks/. */
type AppContextValue = {
  isReady: boolean;
  hasOnboarded: boolean;
  completeOnboarding: () => void;
  isSignedIn: boolean;
  rememberedAccount: DeviceState['account'];
  dismissedPromos: string[];
  dismissPromo: (id: string) => void;
  /** Keeps the locked screen's name and photo up to date. */
  rememberAccount: (profile: UserProfile) => void;
  /** Finishes sign-in once the server session exists. It lasts until they log out or it expires. */
  startSession: (profile: UserProfile) => Promise<void>;
  /** Ends the session and removes the account from this device. Theme and language stay. */
  forgetAccount: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [device, setDevice] = useState<DeviceState>(emptyDeviceState);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadDeviceState(), loadTokens()]).then(([state, tokens]) => {
      if (cancelled) return;
      setDevice(state);
      // Tokens with no remembered account means sign-up was abandoned: start it again.
      setIsSignedIn(!!tokens && !!state.account);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isReady) saveDeviceState(device);
  }, [isReady, device]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      queryClient.clear();
      setIsSignedIn(false);
      // The tabs redirect on their own, but this can fire on a screen pushed above them.
      router.replace('/sign-in');
    });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      isReady,
      hasOnboarded: device.hasOnboarded,
      completeOnboarding: () => setDevice((current) => ({ ...current, hasOnboarded: true })),
      isSignedIn,
      rememberedAccount: device.account,
      dismissedPromos: device.dismissedPromos,
      dismissPromo: (id) =>
        setDevice((current) => ({ ...current, dismissedPromos: [...current.dismissedPromos, id] })),
      rememberAccount: ({ fullName, username, phone, email, avatarUri }) =>
        setDevice((current) => ({
          ...current,
          account: { fullName, username, phone, email, avatarUri },
        })),
      startSession: async (profile) => {
        const { fullName, username, phone, email, avatarUri } = profile;
        // Another account's data must never show up, so switching accounts starts clean.
        const sameAccount =
          device.account &&
          (device.account.phone || device.account.email) === (phone || email);
        if (!sameAccount) queryClient.clear();
        setDevice((current) => ({
          ...current,
          account: { fullName, username, phone, email, avatarUri },
        }));
        setIsSignedIn(true);
      },
      forgetAccount: async () => {
        // No payday means cancel: this device mustn't keep reminding them about these bills.
        await scheduleBillReminders([], kobo(0), null).catch(() => {});
        await unregisterPushToken();
        await authService.logout();
        await clearTokens();
        queryClient.clear();
        setIsSignedIn(false);
        setDevice((current) => ({ ...current, account: null, dismissedPromos: [] }));
      },
    }),
    [isReady, device, isSignedIn],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
