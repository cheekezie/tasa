import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { accountService } from '@/lib/api/services/account';

let registeredToken: string | null = null;

/** Tells the API where to push. Never blocks anything: without a push token the in-app feed still works. */
export async function registerPushToken() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (Platform.OS === 'web' || !projectId || registeredToken) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    const status =
      existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    // Android 13+ needs a channel before it will hand out a token.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Tasa',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await accountService.addPushToken(data);
    registeredToken = data;
  } catch (error) {
    console.warn('Push registration failed', error);
  }
}

export async function unregisterPushToken() {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await accountService.removePushToken(token).catch(() => {});
}
