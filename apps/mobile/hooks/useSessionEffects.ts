import { useEffect } from 'react';

import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import { useAccount } from '@/hooks/useAccount';
import { useRecurringBills } from '@/hooks/useSaved';
import { registerPushToken } from '@/lib/push';
import { scheduleBillReminders } from '@/lib/reminders';

/** Background jobs for a signed-in session. Mounted once, by the tab layout. */
export function useSessionEffects() {
  const { profile, walletBalance, balanceKnown, payday } = useAccount();
  const { rememberAccount } = useApp();
  const { data: bills } = useRecurringBills();
  const { shortfallReminders } = useSettings().notifications;

  useEffect(() => {
    registerPushToken();
  }, []);

  // Keep the locked screen current, once the server has answered.
  useEffect(() => {
    if (balanceKnown) rememberAccount(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceKnown, profile.fullName, profile.username, profile.phone, profile.email, profile.avatarUri]);

  useEffect(() => {
    if (!balanceKnown || !bills) return;
    scheduleBillReminders(
      bills.filter((bill) => bill.active),
      walletBalance,
      shortfallReminders ? payday : null,
    );
  }, [balanceKnown, bills, walletBalance, payday, shortfallReminders]);
}
