import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { RecurringBill } from '@/constants/data';
import { formatNaira } from '@/lib/format';
import { Kobo, subtractKobo } from '@/lib/money';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const DAYS_BEFORE_PAYDAY = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function nextPaydayFrom(today: Date, payday: number) {
  const candidate = new Date(today.getFullYear(), today.getMonth(), payday);
  if (candidate.getTime() < today.getTime()) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  // Clamp to the last day of the month if `payday` overshoots (e.g. 31 in February).
  if (candidate.getDate() !== payday) {
    candidate.setDate(0);
  }
  return candidate;
}

export async function scheduleBillReminders(
  bills: RecurringBill[],
  walletBalance: Kobo,
  payday: number | null,
) {
  if (Platform.OS === 'web') return;
  if (payday === null) {
    // Reminders are off (no payday, or disabled in settings): clear anything already scheduled.
    await Notifications.cancelAllScheduledNotificationsAsync();
    return;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let granted = existing === 'granted';
  if (!granted) {
    const { status } = await Notifications.requestPermissionsAsync();
    granted = status === 'granted';
  }
  if (!granted) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('bill-reminders', {
      name: 'Bill reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const paydayDate = nextPaydayFrom(now, payday);

  for (const bill of bills) {
    const dueDate = new Date(bill.nextDate);
    const shortfall = subtractKobo(bill.amount, walletBalance);
    if (shortfall <= 0 || dueDate.getTime() > paydayDate.getTime() + MS_PER_DAY) continue;

    let reminderDate = new Date(paydayDate.getTime() - DAYS_BEFORE_PAYDAY * MS_PER_DAY);
    if (reminderDate.getTime() < now.getTime() + 60_000) {
      reminderDate = new Date(now.getTime() + 60_000);
    }
    if (reminderDate.getTime() >= dueDate.getTime()) continue;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `You'll be short for ${bill.label}`,
        body: `Top up ${formatNaira(shortfall)} before payday to cover this ${formatNaira(bill.amount)} bill.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminderDate },
    });
  }
}
