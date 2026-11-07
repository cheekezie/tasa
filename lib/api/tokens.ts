// Session tokens live in the device keychain/keystore. SecureStore doesn't exist on web, so
// there they stay in memory and a reload signs out, rather than sitting in localStorage.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_KEY = 'tasa.access.v1';
const REFRESH_KEY = 'tasa.refresh.v1';
const persisted = Platform.OS !== 'web';

export type Tokens = { accessToken: string; refreshToken: string };

let current: Tokens | null = null;

/** Reads the saved session into memory. Call once at startup. */
export async function loadTokens() {
  if (!persisted) return current;
  try {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    current = accessToken && refreshToken ? { accessToken, refreshToken } : null;
  } catch {
    current = null;
  }
  return current;
}

export const getTokens = () => current;

export async function saveTokens(tokens: Tokens) {
  current = tokens;
  if (!persisted) return;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens() {
  current = null;
  if (!persisted) return;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
