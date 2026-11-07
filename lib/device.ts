// What this device remembers without the server: enough to greet someone on the locked screen.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { UserProfile } from '@/lib/api/mappers';

const STORAGE_KEY = 'tasa.device.v1';

export type RememberedAccount = Pick<UserProfile, 'fullName' | 'username' | 'phone' | 'email' | 'avatarUri'>;

export type DeviceState = {
  hasOnboarded: boolean;
  account: RememberedAccount | null;
  /** Promos closed on this device, so they stay closed. */
  dismissedPromos: string[];
};

export const emptyDeviceState: DeviceState = { hasOnboarded: false, account: null, dismissedPromos: [] };

export async function loadDeviceState(): Promise<DeviceState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? { ...emptyDeviceState, ...JSON.parse(raw) } : emptyDeviceState;
  } catch {
    return emptyDeviceState;
  }
}

export function saveDeviceState(state: DeviceState) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}
